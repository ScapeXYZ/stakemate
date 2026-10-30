import type { RemoteAuthorization } from "@/lib/server/remote-mcp";
import { createJwtRemoteAuthorization, type RemoteConsentLookup } from "@/lib/server/remote-oauth-authorization";

export type ManagedOAuthProvider = "workos-connect" | "clerk" | "auth0";
export type ManagedOAuthProviderAdapterOptions = { provider: ManagedOAuthProvider; issuer: string; audience: string; jwksUri: string; consent: RemoteConsentLookup; now?: () => Date };

function secureUrl(value: string) {
  try { const parsed = new URL(value); return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash && !parsed.search; } catch { return false; }
}

/**
 * Resource-server adapter only. The selected authorization server owns client
 * registration, consent, code/token issuance, revocation, and metadata. This
 * adapter never exchanges a code or mints a token; it verifies provider JWTs
 * and then rechecks StakeMate's revocable wallet-bound consent.
 */
export function createManagedOAuthProviderAdapter(options: ManagedOAuthProviderAdapterOptions): RemoteAuthorization {
  if (!secureUrl(options.issuer) || !secureUrl(options.audience) || !secureUrl(options.jwksUri)) return { verify: async () => null };
  return createJwtRemoteAuthorization({ issuer: options.issuer, audience: options.audience, jwksUri: options.jwksUri, consent: options.consent, now: options.now });
}
