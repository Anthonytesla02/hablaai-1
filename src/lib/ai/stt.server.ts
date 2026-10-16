/**
 * Provider-independent speech-to-text.
 * Tries Groq Whisper first (when GROQ_API_KEY is set), then falls back to the
 * Lovable AI Gateway transcription endpoint. Returns a discriminated result so
 * callers can keep their existing user-facing error messages.
 */
import { getAiConfig } from "./config.server";
import { classifyProviderError, logProviderException, logProviderFailure, type ProviderErrorKind } from "./errors.server";

export type SttResult =
  | { ok: true; transcript: string }
  | { ok: false; status: number; kind: ProviderErrorKind };

export async function transcribeAudio(opts: {
  bytes: Uint8Array;
  mimeBase: string;
  ext: string;
  /** ISO-639-1 language code, e.g. "es", "fr", "de", "ru" */
  language: string;
}): Promise<SttResult> {
  const config = getAiConfig();

  if (config.groqKey && process.env["AI_STT_PROVIDER"] !== "lovable") {
    const groq = await callGroq(config.groqKey, config.groqSttModel, opts);
    if (groq.ok) return groq;
    // Fall through to the gateway on any Groq failure.
  }

  if (config.lovableDisabled) return { ok: false, status: 503, kind: "unavailable" };
  if (!config.lovableKey) return { ok: false, status: 401, kind: "auth" };
  return callLovableGateway(config.lovableKey, opts);
}

type TranscribeOpts = { bytes: Uint8Array; mimeBase: string; ext: string; language: string };

function buildForm(model: string, opts: TranscribeOpts): FormData {
  const form = new FormData();
  form.append("model", model);
  form.append("file", new Blob([opts.bytes], { type: opts.mimeBase }), `speech.${opts.ext}`);
  form.append("language", opts.language);
  form.append("response_format", "json");
  return form;
}

async function callGroq(apiKey: string, model: string, opts: TranscribeOpts): Promise<SttResult> {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: buildForm(model, opts),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const kind = classifyProviderError(res.status, body);
      logProviderFailure("groq", res.status, kind, body);
      return { ok: false, status: res.status, kind };
    }
    const json = (await res.json().catch(() => null)) as { text?: string } | null;
    return { ok: true, transcript: json?.text?.trim() ?? "" };
  } catch (error) {
    logProviderException("groq", error);
    return { ok: false, status: 0, kind: "unavailable" };
  }
}

async function callLovableGateway(apiKey: string, opts: TranscribeOpts): Promise<SttResult> {
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: buildForm("google/gemini-3.5-transcribe", opts),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const kind = classifyProviderError(res.status, body);
      logProviderFailure("lovable-gateway-stt", res.status, kind, body);
      return { ok: false, status: res.status, kind };
    }
    const type = res.headers.get("content-type") ?? "";
    const transcript = type.includes("event-stream")
      ? await readStream(res)
      : ((await res.json().catch(() => null)) as { text?: string } | null)?.text?.trim() ?? "";
    return { ok: true, transcript };
  } catch (error) {
    logProviderException("lovable-gateway-stt", error);
    return { ok: false, status: 0, kind: "unavailable" };
  }
}

/** Some models answer as a server-sent stream; accumulate the deltas. */
async function readStream(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload) as { type?: string; delta?: string; text?: string };
        if (event.type?.endsWith(".delta") && event.delta) text += event.delta;
        else if (event.text) text = event.text;
      } catch {
        /* ignore partial lines */
      }
    }
  }
  return text.trim();
}
