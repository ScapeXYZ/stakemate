import assert from "node:assert/strict";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createManagedOAuthProviderAdapter } from "../src/lib/server/managed-oauth-provider-adapter";
import { remoteMcpTokenIdentifierHash, type RemoteConsent, type RemoteConsentLookup } from "../src/lib/server/remote-oauth-authorization";

const issuer = "https://mock-authkit.example"; const audience = "https://stakemate.example/api/mcp"; const now = Math.floor(Date.now() / 1000); const wallet = `0x${"a".repeat(64)}`;
const consent = (overrides: Partial<RemoteConsent> = {}): RemoteConsent => ({ authorizationId: "11111111-1111-4111-8111-111111111111", profileId: "22222222-2222-4222-8222-222222222222", walletAddress: wallet, scopes: ["invitations:read"], revokedAt: null, expiresAt: new Date((now + 600) * 1000).toISOString(), ...overrides });

async function setup(lookup?: RemoteConsentLookup) {
  const { privateKey, publicKey } = await generateKeyPair("RS256"); const jwk = await exportJWK(publicKey); jwk.kid = "mock-workos-key";
  const active = lookup ?? { activeConsent: async (input) => input.subject === "provider-subject" && input.clientId === "claude-client" && input.tokenIdHash === remoteMcpTokenIdentifierHash("mock-token") && input.requiredScopes.every((scope) => consent().scopes.includes(scope)) ? consent() : null } satisfies RemoteConsentLookup;
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
  const auth = createManagedOAuthProviderAdapter({ provider: "workos-connect", issuer, audience, jwksUri: `${issuer}/oauth2/jwks`, consent: active, now: () => new Date(now * 1000) });
  const token = (claims: Record<string, unknown> = {}) => new SignJWT({ scope: "invitations:read", client_id: "claude-client", ...claims }).setProtectedHeader({ alg: "RS256", kid: "mock-workos-key" }).setIssuer(typeof claims.issuerOverride === "string" ? claims.issuerOverride : issuer).setAudience(typeof claims.audienceOverride === "string" ? claims.audienceOverride : audience).setSubject("provider-subject").setJti("mock-token").setIssuedAt(now).setExpirationTime(typeof claims.expirationOverride === "number" ? claims.expirationOverride : now + 300).sign(privateKey);
  return { auth, token };
}

const request = (token: string) => new Request(audience, { headers: { authorization: `Bearer ${token}` } });

test("mock managed-provider adapter fails closed unless issuer, audience, scopes, client, and wallet-bound consent all match", async () => {
  const { auth, token } = await setup(); assert.equal((await auth.verify(request(await token())))?.walletAddress, wallet);
  assert.equal(await auth.verify(request(await token({ scope: "invitations:read wallet:write" }))), null, "unknown scope rejected rather than filtered");
  assert.equal(await auth.verify(request(await token({ issuerOverride: "https://other.example" }))), null);
  assert.equal(await auth.verify(request(await token({ audienceOverride: "https://other.example/api/mcp" }))), null);
  assert.equal(await auth.verify(request(await token({ expirationOverride: now - 1 }))), null);
  const clientMismatch = await setup({ activeConsent: async () => null }); assert.equal(await clientMismatch.auth.verify(request(await clientMismatch.token())), null);
  const revoked = await setup({ activeConsent: async () => consent({ revokedAt: new Date(now * 1000).toISOString() }) }); assert.equal(await revoked.auth.verify(request(await revoked.token())), null);
  const walletMismatch = await setup({ activeConsent: async () => null }); assert.equal(await walletMismatch.auth.verify(request(await walletMismatch.token())), null, "no provider subject can select another wallet");
  const malformedWallet = await setup({ activeConsent: async () => consent({ walletAddress: "not-a-wallet" }) }); assert.equal(await malformedWallet.auth.verify(request(await malformedWallet.token())), null, "malformed wallet/profile evidence fails closed");
});

test("managed-provider adapter fails closed for invalid provider configuration and JWKS outage", async () => {
  const invalid = createManagedOAuthProviderAdapter({ provider: "workos-connect", issuer: "http://issuer.invalid", audience, jwksUri: `${issuer}/oauth2/jwks`, consent: { activeConsent: async () => consent() } });
  assert.equal(await invalid.verify(request("anything")), null);
  const { auth, token } = await setup(); globalThis.fetch = async () => { throw new Error("provider unavailable"); };
  assert.equal(await auth.verify(request(await token())), null, "JWKS outage cannot authenticate a caller");
});
