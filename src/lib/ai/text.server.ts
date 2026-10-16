/**
 * Provider-independent text generation.
 * Tries Mistral first (when MISTRAL_API_KEY is set), then falls back to the
 * Lovable AI Gateway. Returns the raw message content, or null when every
 * provider failed — callers keep their existing safe fallbacks.
 */
import { getAiConfig } from "./config.server";
import { classifyProviderError, logProviderException, logProviderFailure } from "./errors.server";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function aiChat(opts: { messages: ChatMessage[]; json?: boolean }): Promise<string | null> {
  const config = getAiConfig();

  if (config.mistralKey && process.env["AI_TEXT_PROVIDER"] !== "lovable") {
    const text = await callMistral(config.mistralKey, config.mistralModel, opts);
    if (text !== null) return text;
  }

  if (config.lovableDisabled) return null;
  if (!config.lovableKey) return null;
  return callLovableGateway(config.lovableKey, opts);
}

async function callMistral(apiKey: string, model: string, opts: { messages: ChatMessage[]; json?: boolean }): Promise<string | null> {
  try {
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        messages: opts.messages,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logProviderFailure("mistral", res.status, classifyProviderError(res.status, body), body);
      return null;
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    logProviderException("mistral", error);
    return null;
  }
}

async function callLovableGateway(apiKey: string, opts: { messages: ChatMessage[]; json?: boolean }): Promise<string | null> {
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "google/gemini-3.8-flash",
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        messages: opts.messages,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logProviderFailure("lovable-gateway", res.status, classifyProviderError(res.status, body), body);
      return null;
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    logProviderException("lovable-gateway", error);
    return null;
  }
}

/** Extract the first JSON object from a model's raw reply, or null. */
export function extractJson<T>(raw: string): T | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
