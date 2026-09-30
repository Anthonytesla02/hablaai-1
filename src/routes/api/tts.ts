import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const requestSchema = z.object({
  text: z.string().trim().min(1).max(1800),
  locale: z.string().trim().min(2).max(24).default("es-ES"),
  rate: z.number().min(0.7).max(1.25).default(1),
  voice: z.enum(["female", "male"]).default("female"),
  mood: z
    .enum(["warm", "encouraging", "playful", "corrective", "celebratory", "empathetic", "dramatic"])
    .default("warm"),
});

const VOICES = { female: "Kore", male: "Puck" } as const;

function deliveryPrompt(input: z.infer<typeof requestSchema>) {
  const pace = input.rate < 0.9 ? "unhurried" : input.rate > 1.08 ? "energetic" : "natural";
  const language = input.locale.toLowerCase().startsWith("es") ? "authentic conversational Spanish" : "natural English";
  return [
    `Speak in ${language}.`,
    `Sound ${input.mood}, emotionally present, and genuinely human.`,
    `Use a ${pace} conversational pace, expressive intonation, subtle breaths, and meaningful pauses.`,
    "Never sound like an announcer, recording, or synthetic assistant.",
    `Say: ${input.text}`,
  ].join(" ");
}

/** One expressive, streamed speech source for every tutor line in Hablaa. */
export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = requestSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ message: "That speech request is not valid." }, { status: 400 });
        }

        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) {
          return Response.json({ message: "Expressive speech is not configured." }, { status: 401 });
        }

        try {
          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3.1-flash-tts-preview",
              contents: [{ role: "user", parts: [{ text: deliveryPrompt(parsed.data) }] }],
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: VOICES[parsed.data.voice] },
                  },
                },
              },
              stream_format: "sse",
            }),
            signal: request.signal,
          });

          return new Response(upstream.body, {
            status: upstream.status,
            headers: {
              "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
              "Cache-Control": "no-cache, no-store",
            },
          });
        } catch (error) {
          if (request.signal.aborted) {
            return Response.json({ message: "Speech stopped." }, { status: 499 });
          }
          console.error("Speech request failed", error);
          return Response.json({ message: "The tutor voice is temporarily unavailable." }, { status: 502 });
        }
      },
    },
  },
});