/**
 * Provider-independent text-to-speech.
 * Tries Google AI Studio's Gemini TTS directly (when GOOGLE_API_KEY is set),
 * then falls back to the Lovable AI Gateway. Both paths yield one SSE stream in
 * the shape the browser player expects: {type:"speech.audio.delta", audio} events
 * of base64 16-bit PCM at 24 kHz, closed by {type:"speech.audio.done"}.
 */
import { createParser } from "eventsource-parser";
import { getAiConfig } from "./config.server";
import { classifyProviderError, logProviderException, logProviderFailure } from "./errors.server";

export type TtsUpstream = { body: ReadableStream<Uint8Array> | null; contentType: string; status: number };

export async function openTtsStream(opts: {
  prompt: string;
  voiceName: string;
  signal: AbortSignal;
}): Promise<TtsUpstream | null> {
  const config = getAiConfig();

  if (config.googleKey && process.env["AI_TTS_PROVIDER"] !== "lovable") {
    const google = await callGoogle(config.googleKey, config.geminiTtsModel, opts);
    if (google) return google;
  }

  if (config.lovableDisabled) return null;
  if (!config.lovableKey) return null;
  return callLovableGateway(config.lovableKey, opts);
}

type TtsOpts = { prompt: string; voiceName: string; signal: AbortSignal };

function geminiBody(voiceName: string, prompt: string) {
  return JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  });
}

async function callGoogle(apiKey: string, model: string, opts: TtsOpts): Promise<TtsUpstream | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: geminiBody(opts.voiceName, opts.prompt),
        signal: opts.signal,
      },
    );
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      logProviderFailure("google-tts", res.status, classifyProviderError(res.status, body), body);
      return null;
    }
    return { body: res.body.pipeThrough(transformGeminiSse()), contentType: "text/event-stream", status: 200 };
  } catch (error) {
    if (!opts.signal.aborted) logProviderException("google-tts", error);
    return null;
  }
}

async function callLovableGateway(apiKey: string, opts: TtsOpts): Promise<TtsUpstream | null> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3.1-flash-tts-preview",
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voiceName } } },
      },
      stream_format: "sse",
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    logProviderFailure("lovable-gateway-tts", res.status, classifyProviderError(res.status, body), body);
    return null;
  }
  return { body: res.body, contentType: res.headers.get("content-type") ?? "text/event-stream", status: res.status };
}

/**
 * Convert Gemini's native streamGenerateContent events
 * ({candidates:[{content:{parts:[{inlineData:{data}}]}}]}) into the app's
 * speech.audio.delta / speech.audio.done event shape.
 */
function transformGeminiSse(): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let controllerRef: TransformStreamDefaultController<Uint8Array> | null = null;
  let doneEmitted = false;
  const emit = (payload: unknown) => {
    controllerRef?.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  };
  const emitDone = () => {
    if (doneEmitted) return;
    doneEmitted = true;
    emit({ type: "speech.audio.done" });
  };
  const parser = createParser({
    onEvent(event) {
      if (!event.data || event.data === "[DONE]") return;
      try {
        const chunk = JSON.parse(event.data) as {
          candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] }; finishReason?: string }[];
          error?: unknown;
        };
        if (chunk.error) {
          emit({ type: "error" });
          return;
        }
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.inlineData?.data) emit({ type: "speech.audio.delta", audio: part.inlineData.data });
        }
        if (chunk.candidates?.[0]?.finishReason) emitDone();
      } catch {
        /* ignore partial events */
      }
    },
  });
  return new TransformStream({
    start(controller) {
      controllerRef = controller;
    },
    transform(chunk) {
      parser.feed(decoder.decode(chunk, { stream: true }));
    },
    flush() {
      parser.reset({ consume: true });
      emitDone();
    },
  });
}
