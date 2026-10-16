/**
 * Central AI provider configuration.
 * Read per request (env is injected at request time on the server runtime) — never at module scope.
 *
 * Provider selection per capability:
 * - text:  MISTRAL_API_KEY (model MISTRAL_MODEL, default mistral-small-latest) → Lovable AI Gateway
 * - stt:   GROQ_API_KEY (model GROQ_STT_MODEL, default whisper-large-v3-turbo) → Lovable AI Gateway
 * - tts:   GOOGLE_API_KEY (model GEMINI_TTS_MODEL, default gemini-3.1-flash-tts) → Lovable AI Gateway
 *
 * Set AI_DISABLE_LOVABLE=true to stop falling back to the Lovable AI Gateway entirely
 * (for running fully on your own provider accounts).
 */

export type AiConfig = {
  mistralKey?: string;
  mistralModel: string;
  groqKey?: string;
  groqSttModel: string;
  googleKey?: string;
  geminiTtsModel: string;
  lovableKey?: string;
  lovableDisabled: boolean;
};

export function getAiConfig(): AiConfig {
  return {
    mistralKey: process.env["MISTRAL_API_KEY"] || undefined,
    mistralModel: process.env["MISTRAL_MODEL"] || "mistral-small-latest",
    groqKey: process.env["GROQ_API_KEY"] || undefined,
    groqSttModel: process.env["GROQ_STT_MODEL"] || "whisper-large-v3-turbo",
    googleKey: process.env["GOOGLE_API_KEY"] || undefined,
    geminiTtsModel: process.env["GEMINI_TTS_MODEL"] || "gemini-3.1-flash-tts",
    lovableKey: process.env["LOVABLE_API_KEY"] || undefined,
    lovableDisabled: process.env["AI_DISABLE_LOVABLE"] === "true",
  };
}
