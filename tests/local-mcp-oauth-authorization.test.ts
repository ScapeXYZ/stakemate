import assert from "node:assert/strict";
import test from "node:test";
import { createLocalAuthorizationConsentPreview, localMcpOAuthClients, validateLocalAuthorizationRequest } from "../src/lib/server/local-mcp-oauth-authorization";
import type { Profile } from "../src/lib/server/invitations";

const redirectUri = "http://127.0.0.1:3001/mcp/local-oauth-callback";
const challenge = "a".repeat(43);
const profile: Profile = { id: "11111111-1111-4111-8111-111111111111", walletAddress: `0x${"a".repeat(64)}`, username: "preview_owner", usernameNormalized: "preview_owner", createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z" };
const request = (overrides: Record<string, string> = {}) => new URLSearchParams({ response_type: "code", client_id: "stakemate-local-mcp-preview", redirect_uri: redirectUri, state: "state-binding-value-123", scope: "invitations:read", code_challenge: challenge, code_challenge_method: "S256", ...overrides });

test("local OAuth registry accepts only exact client, redirect URI, read scopes, and PKCE S256", () => {
  const valid = validateLocalAuthorizationRequest(request()); assert.equal(valid.ok, true);
  assert.equal(localMcpOAuthClients.length, 1);
  assert.deepEqual(validateLocalAuthorizationRequest(request({ client_id: "unknown-client" })), { ok: false, error: "unauthorized_client" });
  assert.deepEqual(validateLocalAuthorizationRequest(request({ redirect_uri: `${redirectUri}?next=https://attacker.invalid` })), { ok: false, error: "unauthorized_client" });
  assert.deepEqual(validateLocalAuthorizationRequest(request({ redirect_uri: "http://127.0.0.1:3001/mcp/local-oauth-callback/" })), { ok: false, error: "unauthorized_client" });
  assert.deepEqual(validateLocalAuthorizationRequest(request({ code_challenge_method: "plain" })), { ok: false, error: "invalid_request" });
  assert.deepEqual(validateLocalAuthorizationRequest(request({ response_type: "token" })), { ok: false, error: "invalid_request" });
  assert.deepEqual(validateLocalAuthorizationRequest(request({ scope: "invitations:read wallet:write" })), { ok: false, error: "invalid_scope" });
});

test("local OAuth validation rejects duplicate and substituted state, client, and PKCE parameters", () => {
  const duplicate = request(); duplicate.append("state", "attacker-state-123");
  assert.deepEqual(validateLocalAuthorizationRequest(duplicate), { ok: false, error: "invalid_request" });
  assert.deepEqual(validateLocalAuthorizationRequest(request({ state: "short" })), { ok: false, error: "invalid_request" });
  assert.deepEqual(validateLocalAuthorizationRequest(request({ code_challenge: "not-a-s256-challenge" })), { ok: false, error: "invalid_request" });
  const duplicateClient = request(); duplicateClient.append("client_id", "attacker-client");
  assert.deepEqual(validateLocalAuthorizationRequest(duplicateClient), { ok: false, error: "invalid_request" });
});

test("preview handoff binds a caller state hash and PKCE data without retaining raw OAuth state", async () => {
  const previous = process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE; process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE = "false";
  const first = validateLocalAuthorizationRequest(request()); const second = validateLocalAuthorizationRequest(request({ state: "different-state-binding-456" }));
  assert.equal(first.ok, true); assert.equal(second.ok, true); if (!first.ok || !second.ok) return;
  const captured: unknown[] = [];
  const store = { create: async (input: unknown) => { captured.push(input); return { id: "22222222-2222-4222-8222-222222222222", clientId: "stakemate-local-mcp-preview", requestedScopes: ["invitations:read"] as ("invitations:read")[], expiresAt: "2030-01-01T00:10:00.000Z", state: "internal-state", csrfToken: "internal-csrf" }; } };
  try {
    await createLocalAuthorizationConsentPreview(first.request, profile, store);
    await createLocalAuthorizationConsentPreview(second.request, profile, store);
    const one = captured[0] as { oauthSubject: string; oauthRequest: { stateHash: string; redirectUri: string; codeChallenge: string; codeChallengeMethod: string } };
    const two = captured[1] as typeof one;
    assert.equal(one.oauthSubject, `local-preview-profile:${profile.id}`);
    assert.equal(one.oauthRequest.redirectUri, redirectUri);
    assert.equal(one.oauthRequest.codeChallenge, challenge);
    assert.equal(one.oauthRequest.codeChallengeMethod, "S256");
    assert.match(one.oauthRequest.stateHash, /^[0-9a-f]{64}$/);
    assert.notEqual(one.oauthRequest.stateHash, two.oauthRequest.stateHash, "substituted caller state has a different immutable binding");
  } finally { if (previous === undefined) delete process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE; else process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE = previous; }
});
