import assert from "node:assert/strict";
import test from "node:test";
import { exportJWK, generateKeyPair, jwtVerify } from "jose";
import { issueWalletNativeAccessToken, validateWalletNativeAuthorizationRequest, walletNativeAccessTokenLifetimeSeconds, walletNativeAuthorizationServerMetadata, walletNativeJwks, walletNativeMcpResource, walletNativeOAuthIssuer, walletNativePkceS256 } from "../src/lib/server/wallet-native-oauth";

const callback = "https://claude.example.test/oauth/callback";
const client = { clientId: "documented-test-client", redirectUris: [callback], allowedScopes: ["duels:prepare", "credibility:read", "invitations:read"] as const, tokenEndpointAuthMethod: "none" as const };
const query = (changes: Record<string, string> = {}) => new URLSearchParams({ response_type: "code", client_id: client.clientId, redirect_uri: callback, state: "state-binding-value-123", scope: "invitations:read", code_challenge: "a".repeat(43), code_challenge_method: "S256", resource: walletNativeMcpResource, ...changes });

test("wallet-native authorization accepts only exact public client, redirect, resource, scopes, and S256", () => {
  assert.equal(validateWalletNativeAuthorizationRequest(query(), [client]).ok, true);
  assert.deepEqual(validateWalletNativeAuthorizationRequest(query({ redirect_uri: `${callback}?next=attacker` }), [client]), { ok: false, error: "unauthorized_client" });
  assert.deepEqual(validateWalletNativeAuthorizationRequest(query({ resource: "https://attacker.invalid/mcp" }), [client]), { ok: false, error: "invalid_target" });
  assert.deepEqual(validateWalletNativeAuthorizationRequest(query({ code_challenge_method: "plain" }), [client]), { ok: false, error: "invalid_request" });
  assert.deepEqual(validateWalletNativeAuthorizationRequest(query({ scope: "invitations:read wallet:write" }), [client]), { ok: false, error: "invalid_scope" });
  const duplicated = query(); duplicated.append("state", "attacker-state"); assert.deepEqual(validateWalletNativeAuthorizationRequest(duplicated, [client]), { ok: false, error: "invalid_request" });
});

test("wallet-native metadata is code-only, S256-only, resource-bound, and has no dynamic registration endpoint", () => {
  const metadata = walletNativeAuthorizationServerMetadata();
  assert.equal(metadata.issuer, walletNativeOAuthIssuer); assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]); assert.equal("registration_endpoint" in metadata, false); assert.equal(metadata.resource_indicators_supported, true);
  assert.equal(walletNativePkceS256("A".repeat(43)).length, 43);
});

test("wallet-native token uses a server-side asymmetric key and exact issuer/audience/scope", async () => {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true }); const privateJwk = await exportJWK(privateKey); privateJwk.kid = "sandbox-k1";
  const token = await issueWalletNativeAccessToken({ signingJwk: JSON.stringify(privateJwk), subject: "wallet-profile:111", clientId: client.clientId, scopes: ["invitations:read"], tokenId: "one-time-jti", now: new Date("2030-01-01T00:00:00Z") });
  const { payload } = await jwtVerify(token, publicKey, { issuer: walletNativeOAuthIssuer, audience: walletNativeMcpResource, algorithms: ["ES256"], currentDate: new Date("2030-01-01T00:01:00Z") });
  assert.equal(payload.sub, "wallet-profile:111"); assert.equal(payload.jti, "one-time-jti"); assert.equal(payload.scope, "invitations:read"); assert.equal(payload.exp! - payload.iat!, walletNativeAccessTokenLifetimeSeconds);
  const jwks = await walletNativeJwks(JSON.stringify(privateJwk)); assert.equal(jwks?.keys[0].d, undefined, "private signing material never appears in JWKS");
  await assert.rejects(() => issueWalletNativeAccessToken({ signingJwk: "not-json", subject: "wallet-profile:111", clientId: client.clientId, scopes: ["invitations:read"] }));
});
