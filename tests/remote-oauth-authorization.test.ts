import assert from "node:assert/strict";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createJwtRemoteAuthorization, remoteMcpTokenIdentifierHash, type RemoteConsent, type RemoteConsentLookup } from "../src/lib/server/remote-oauth-authorization";

const issuer = "https://issuer.example"; const audience = "https://mcp.example/mcp"; const now = Math.floor(Date.now() / 1000);
const temitope = `0x${"4".repeat(64)}`; const virus = `0x${"5".repeat(64)}`;
type Grant = { subject: string; clientId: string; tokenId: string; consent: RemoteConsent };
const consent = (walletAddress = temitope, scopes: RemoteConsent["scopes"] = ["duels:prepare", "credibility:read", "invitations:read"]): RemoteConsent => ({ authorizationId: "44444444-4444-4444-8444-444444444444", profileId: "55555555-5555-4555-8555-555555555555", walletAddress, scopes, revokedAt: null, expiresAt: new Date((now + 600) * 1000).toISOString() });

function grantLookup(grants: Grant[]): RemoteConsentLookup {
  return { activeConsent: async (input) => grants.find((grant) => grant.subject === input.subject && grant.clientId === input.clientId && remoteMcpTokenIdentifierHash(grant.tokenId) === input.tokenIdHash && input.requiredScopes.every((scope) => grant.consent.scopes.includes(scope)))?.consent ?? null };
}

async function setup(lookup: RemoteConsentLookup = grantLookup([{ subject: "provider-user", clientId: "claude-web", tokenId: "token-1", consent: consent() }])) {
  const { privateKey, publicKey } = await generateKeyPair("RS256"); const jwk = await exportJWK(publicKey); jwk.kid = "test";
  const token = async (claims: Record<string, unknown> = {}) => new SignJWT({ scope: "duels:prepare credibility:read invitations:read", azp: "claude-web", ...claims }).setProtectedHeader({ alg: "RS256", kid: "test" }).setIssuer(typeof claims.issuerOverride === "string" ? claims.issuerOverride : issuer).setAudience(typeof claims.audienceOverride === "string" ? claims.audienceOverride : audience).setSubject(typeof claims.subjectOverride === "string" ? claims.subjectOverride : "provider-user").setIssuedAt(now).setExpirationTime(typeof claims.expirationOverride === "number" ? claims.expirationOverride : now + 300).setJti(typeof claims.tokenIdOverride === "string" ? claims.tokenIdOverride : "token-1").sign(privateKey);
  const auth = createJwtRemoteAuthorization({ issuer, audience, jwksUri: "https://jwks.example/keys", consent: lookup, now: () => new Date(now * 1000) });
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
  return { auth, token };
}

const requestFor = (token: string) => new Request(audience, { headers: { authorization: `Bearer ${token}` } });

test("remote OAuth rejects forged, wrong issuer/audience, expired, missing-consent, and revoked tokens", async () => {
  const { auth, token } = await setup(); assert.ok(await auth.verify(requestFor(await token())));
  assert.equal(await auth.verify(requestFor("forged")), null);
  assert.equal(await auth.verify(requestFor(await token({ issuerOverride: "https://wrong.example" }))), null);
  assert.equal(await auth.verify(requestFor(await token({ audienceOverride: "https://other.example/mcp" }))), null);
  assert.equal(await auth.verify(requestFor(await token({ expirationOverride: now - 1 }))), null);
  const missing = await setup(grantLookup([])); assert.equal(await missing.auth.verify(requestFor(await missing.token())), null);
  const revoked = consent(); revoked.revokedAt = new Date(now * 1000).toISOString(); const denied = await setup(grantLookup([{ subject: "provider-user", clientId: "claude-web", tokenId: "token-1", consent: revoked }])); assert.equal(await denied.auth.verify(requestFor(await denied.token())), null);
});

test("remote OAuth fails closed for cross-wallet, client, token, scope, and lookup failures", async () => {
  const otherWalletGrant = await setup(grantLookup([{ subject: "other-user", clientId: "claude-web", tokenId: "token-1", consent: consent(virus) }]));
  assert.equal(await otherWalletGrant.auth.verify(requestFor(await otherWalletGrant.token())), null, "a different OAuth subject cannot receive another wallet principal");
  const clientMismatch = await setup(grantLookup([{ subject: "provider-user", clientId: "other-client", tokenId: "token-1", consent: consent() }]));
  assert.equal(await clientMismatch.auth.verify(requestFor(await clientMismatch.token())), null);
  const tokenMismatch = await setup(grantLookup([{ subject: "provider-user", clientId: "claude-web", tokenId: "other-token", consent: consent() }]));
  assert.equal(await tokenMismatch.auth.verify(requestFor(await tokenMismatch.token())), null);
  const missingScope = await setup(grantLookup([{ subject: "provider-user", clientId: "claude-web", tokenId: "token-1", consent: consent(temitope, ["duels:prepare"]) }]));
  assert.equal(await missingScope.auth.verify(requestFor(await missingScope.token({ scope: "duels:prepare invitations:read" }))), null);
  const unavailable = await setup({ activeConsent: async () => { throw new Error("database unavailable"); } });
  assert.equal(await unavailable.auth.verify(requestFor(await unavailable.token())), null);
});

test("remote OAuth grants only the approved token scopes to the MCP principal", async () => {
  const scoped = await setup(grantLookup([{ subject: "provider-user", clientId: "claude-web", tokenId: "token-1", consent: consent(temitope, ["invitations:read"]) }]));
  const principal = await scoped.auth.verify(requestFor(await scoped.token({ scope: "invitations:read" })));
  assert.deepEqual(principal?.scopes, ["invitations:read"]);
  assert.equal(principal?.walletAddress, temitope);
});
