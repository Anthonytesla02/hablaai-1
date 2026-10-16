/**
 * Shared error classification for external AI providers.
 * Every adapter classifies failures the same way so fallback decisions are consistent.
 * Never log request bodies, keys, or learner content here — only status, kind and a short provider message.
 */

export type ProviderErrorKind =
  | "quota" // credits/quota exhausted — stop retrying this provider until it resets
  | "rate_limit" // temporary throttle — safe to try the next provider
  | "auth" // bad/missing key — configuration error, do not retry
  | "invalid_request" // our request is wrong for this provider
  | "unavailable" // provider-side 5xx / network failure
  | "unknown";

export function classifyProviderError(status: number, body: string): ProviderErrorKind {
  if (status === 402) return "quota";
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) {
    return /quota|billing|credit|limit exceeded|insufficient/i.test(body) ? "quota" : "auth";
  }
  if (status === 400 || status === 404 || status === 422) return "invalid_request";
  if (status >= 500 || status === 0) return "unavailable";
  return "unknown";
}

/** Log a provider failure without ever touching keys or learner content. */
export function logProviderFailure(provider: string, status: number, kind: ProviderErrorKind, body: string) {
  console.warn(`[ai] ${provider} request failed (status ${status}, ${kind}): ${body.slice(0, 200)}`);
}

export function logProviderException(provider: string, error: unknown) {
  console.warn(`[ai] ${provider} request threw:`, error instanceof Error ? error.message : "unknown error");
}
