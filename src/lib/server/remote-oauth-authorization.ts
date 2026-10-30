import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import type { McpAuthContext } from "@/lib/server/mcp-auth-context";
import type { RemoteAuthorization } from "@/lib/server/remote-mcp";

export const remoteMcpPrivateScopes = ["duels:prepare", "credibility:read", "invitations:read"] as const;
export type RemoteMcpPrivateScope = (typeof remoteMcpPrivateScopes)[number];
export type RemoteConsent = { authorizationId: string; profileId: string; walletAddress: string; scopes: RemoteMcpPrivateScope[]; revokedAt: string | null; expiresAt: string };
export type RemoteConsentLookup = { activeConsent(input: { subject: string; clientId: string; tokenIdHash: string; requiredScopes: RemoteMcpPrivateScope[] }): Promise<RemoteConsent | null> };
export type JwtRemoteAuthorizationOptions = { issuer: string; audience: string; jwksUri: string; consent: RemoteConsentLookup; now?: () => Date };
export function remoteMcpTokenIdentifierHash(tokenId: string) { return createHash("sha256").update(`stakemate.remote-mcp.token-id.v1\n${tokenId}`, "utf8").digest("hex"); }
function canonicalWallet(value: string) { try { const normalized = normalizeSuiAddress(value).toLowerCase(); return /^0x[0-9a-f]{64}$/.test(normalized) ? normalized : null; } catch { return null; } }

/** Resource-server verifier: OAuth identity alone never becomes a StakeMate wallet identity. */
export function createJwtRemoteAuthorization(options: JwtRemoteAuthorizationOptions): RemoteAuthorization {
  const jwks = createRemoteJWKSet(new URL(options.jwksUri));
  return {
    async verify(request) {
      const header = request.headers.get("authorization");
      if (!header?.startsWith("Bearer ")) return null;
      try {
        const { payload } = await jwtVerify(header.slice(7), jwks, { issuer: options.issuer, audience: options.audience, algorithms: ["RS256", "ES256"] });
        const subject = typeof payload.sub === "string" ? payload.sub : null;
        const clientId = typeof payload.azp === "string" ? payload.azp : typeof payload.client_id === "string" ? payload.client_id : null;
        const tokenId = typeof payload.jti === "string" && payload.jti.trim() ? payload.jti : null;
        const rawScopes = typeof payload.scope === "string" && payload.scope.trim() === payload.scope && !payload.scope.includes("  ") ? payload.scope.split(" ") : [];
        const requestedScopes = rawScopes.filter((scope): scope is RemoteMcpPrivateScope => remoteMcpPrivateScopes.includes(scope as RemoteMcpPrivateScope));
        if (!subject || !clientId || !tokenId || requestedScopes.length === 0 || requestedScopes.length !== rawScopes.length || new Set(requestedScopes).size !== requestedScopes.length) return null;
        const consent = await options.consent.activeConsent({ subject, clientId, tokenIdHash: remoteMcpTokenIdentifierHash(tokenId), requiredScopes: requestedScopes });
        const now = options.now?.() ?? new Date();
        const walletAddress = consent ? canonicalWallet(consent.walletAddress) : null;
        if (!consent || !walletAddress || consent.revokedAt || Date.parse(consent.expiresAt) <= now.getTime() || !requestedScopes.every((scope) => consent.scopes.includes(scope))) return null;
        return { authorizationId: consent.authorizationId, walletAddress, scopes: requestedScopes, issuedAt: new Date((payload.iat ?? Math.floor(now.getTime() / 1000)) * 1000).toISOString(), expiresAt: new Date(Math.min((payload.exp ?? 0) * 1000, Date.parse(consent.expiresAt))).toISOString() } satisfies McpAuthContext;
      } catch { return null; }
    },
  };
}
