import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { PostgresRemoteMcpConsentRequestStore } from "../src/lib/server/remote-mcp-consent-requests";

const databaseUrl = process.env.STAKEMATE_TEST_DATABASE_URL;
const disposable = (() => { try { const url = new URL(databaseUrl ?? ""); return process.env.STAKEMATE_REMOTE_MCP_CONSENT_INTEGRATION_DISPOSABLE === "1" && url.hostname === "127.0.0.1" && url.port === "55435" && url.pathname === "/stakemate_integration17"; } catch { return false; } })();
const skip = disposable ? undefined : "requires STAKEMATE_REMOTE_MCP_CONSENT_INTEGRATION_DISPOSABLE=1 and localhost STAKEMATE_TEST_DATABASE_URL";
const wallet = (id: string, fill: string) => `0x${id.replaceAll("-", "").padEnd(64, fill)}`;

test("disposable remote MCP migration enforces consent replay, scope, wallet, RLS, and immutable grant constraints", { skip }, async () => {
  const sql = postgres(databaseUrl!, { prepare: false, max: 1, ssl: false }); const store = new PostgresRemoteMcpConsentRequestStore(databaseUrl!); const suffix = randomUUID().slice(0, 8); const firstId = randomUUID(); const secondId = randomUUID(); const firstWallet = wallet(firstId, "a"); const secondWallet = wallet(secondId, "b"); const start = new Date("2030-01-01T00:00:00.000Z");
  const previousFreeze = process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE; process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE = "false";
  try {
    await sql`insert into stakemate_profiles (id, wallet_address, username, username_normalized, created_at, updated_at) values (${firstId}, ${firstWallet}, ${`consent_a_${suffix}`}, ${`consent_a_${suffix}`}, ${start.toISOString()}, ${start.toISOString()}), (${secondId}, ${secondWallet}, ${`consent_b_${suffix}`}, ${`consent_b_${suffix}`}, ${start.toISOString()}, ${start.toISOString()})`;
    await assert.rejects(() => store.create({ oauthSubject: "oauth-subject", clientId: "claude-web", requestedScopes: ["invitations:read", "wallet:write"] as never }, start), /REMOTE_MCP_CONSENT_REQUEST_INVALID/, "scope escalation request refused");
    const request = await store.create({ oauthSubject: "oauth-subject", clientId: "claude-web", requestedScopes: ["invitations:read"], oauthRequest: { stateHash: "3".repeat(64), redirectUri: "http://127.0.0.1:3001/mcp/local-oauth-callback", codeChallenge: "a".repeat(43), codeChallengeMethod: "S256" } }, start);
    await assert.rejects(() => sql`update stakemate_remote_mcp_consent_requests set requested_scopes = ${["credibility:read"]} where id = ${request.id}`, /immutable/, "stored requested scopes cannot be escalated");
    await assert.rejects(() => sql`update stakemate_remote_mcp_consent_requests set pkce_code_challenge = ${"b".repeat(43)} where id = ${request.id}`, /immutable/, "stored PKCE challenge cannot be substituted");
    assert.deepEqual((await store.review(request.id, request.state, start))?.requestedScopes, ["invitations:read"]);
    assert.equal(await store.review(request.id, "forged-state", start), null, "forged state refused");
    assert.equal(await store.decide({ id: request.id, state: request.state, csrfToken: request.csrfToken, decision: "approved", profileId: secondId, walletAddress: firstWallet }, start), null, "cross-wallet decision refused");
    assert.equal(await store.decide({ id: request.id, state: request.state, csrfToken: "forged-csrf", decision: "approved", profileId: firstId, walletAddress: firstWallet }, start), null, "forged CSRF refused");
    assert.equal(await store.decide({ id: request.id, state: request.state, csrfToken: request.csrfToken, decision: "approved", profileId: firstId, walletAddress: firstWallet }, start), "approved");
    assert.equal(await store.decide({ id: request.id, state: request.state, csrfToken: request.csrfToken, decision: "denied", profileId: firstId, walletAddress: firstWallet }, start), null, "decision replay refused");
    assert.equal(await store.review(request.id, request.state, start), null, "used request cannot be reviewed again");
    const expired = await store.create({ oauthSubject: "oauth-subject", clientId: "claude-web", requestedScopes: ["duels:prepare"] }, start);
    assert.equal(await store.decide({ id: expired.id, state: expired.state, csrfToken: expired.csrfToken, decision: "approved", profileId: firstId, walletAddress: firstWallet }, new Date(start.getTime() + 11 * 60_000)), null, "expired request refused");
    const authorizationId = randomUUID();
    await sql`insert into stakemate_remote_mcp_authorizations (id, oauth_subject, oauth_client_id, profile_id, wallet_address, approved_scopes, token_id_hash, authorized_at, expires_at) values (${authorizationId}, 'oauth-subject', 'claude-web', ${firstId}, ${firstWallet}, ${["invitations:read"]}, ${"1".repeat(64)}, ${start.toISOString()}, ${new Date(start.getTime() + 60 * 60_000).toISOString()})`;
    assert.equal(await store.revokeConnection(authorizationId, secondId, secondWallet, start), false, "another wallet cannot revoke a connection");
    assert.equal((await sql`select revoked_at from stakemate_remote_mcp_authorizations where id = ${authorizationId}`)[0].revoked_at, null);
    await assert.rejects(() => sql`update stakemate_remote_mcp_authorizations set approved_scopes = ${["duels:prepare"]} where id = ${authorizationId}`, /immutable/);
    await assert.rejects(() => sql`insert into stakemate_remote_mcp_authorizations (id, oauth_subject, oauth_client_id, profile_id, wallet_address, approved_scopes, token_id_hash, authorized_at, expires_at) values (${randomUUID()}, 'other', 'claude-web', ${firstId}, ${secondWallet}, ${["invitations:read"]}, ${"2".repeat(64)}, ${start.toISOString()}, ${new Date(start.getTime() + 60 * 60_000).toISOString()})`, /binding mismatch/);
    const [rls] = await sql`select relrowsecurity as enabled from pg_class where oid = 'stakemate_remote_mcp_authorizations'::regclass`; assert.equal(rls.enabled, true);
    const [requestRls] = await sql`select relrowsecurity as enabled from pg_class where oid = 'stakemate_remote_mcp_consent_requests'::regclass`; assert.equal(requestRls.enabled, true);
    assert.equal(await store.revokeConnection(authorizationId, firstId, firstWallet, start), true);
  } finally {
    if (previousFreeze === undefined) delete process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE; else process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE = previousFreeze;
    await sql`delete from stakemate_remote_mcp_consent_requests where decision_profile_id in (${firstId}, ${secondId}) or oauth_subject = 'oauth-subject'`;
    await sql`delete from stakemate_remote_mcp_authorizations where profile_id in (${firstId}, ${secondId})`;
    await sql`delete from stakemate_profiles where id in (${firstId}, ${secondId})`;
    await store.close(); await sql.end({ timeout: 5 });
  }
});
