export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_CONFIGURED" | "TIMEOUT" | "UPSTREAM" | "INVALID_RESPONSE" | "WRITES_DISABLED" | "AUTH" | "RATE_LIMIT",
    public readonly status?: number,
    /** A server-derived delay; never treated as a provider-data freshness signal. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function publicProviderStatus(error: unknown): { ok: false; code: string; retryAfterSeconds?: number } {
  if (error instanceof ProviderError) return { ok: false, code: error.code, ...(error.retryAfterMs ? { retryAfterSeconds: Math.max(1, Math.ceil(error.retryAfterMs / 1_000)) } : {}) };
  return { ok: false, code: "UNAVAILABLE" };
}

export function providerRetryHeaders(error: unknown): Record<string, string> { return error instanceof ProviderError && error.retryAfterMs ? { "Retry-After": String(Math.max(1, Math.ceil(error.retryAfterMs / 1_000))), "Cache-Control": "no-store" } : { "Cache-Control": "no-store" }; }
