import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { PostgresRemoteMcpAuthorizationCodeStore, remoteMcpAuthorizationCodeHash, remoteMcpPkceS256 } from "../src/lib/server/remote-mcp-authorization-codes";

const databaseUrl = process.env.STAKEMATE_TEST_DATABASE_URL;
const disposable = (() => { try { const url = new URL(databaseUrl ?? ""); return process.env.STAKEMATE_REMOTE_MCP_CONSENT_INTEGRATION_DISPOSABLE === "1" && url.hostname === "127.0.0.1" && url.port === "55435" && url.pathname === "/stakemate_integration17"; } catch { return false; } })();
const skip = disposable ? undefined : "requires STAKEMATE_REMOTE_MCP_CONSENT_INTEGRATION_DISPOSABLE=1 and localhost STAKEMATE_TEST_DATABASE_URL";
const wallet = (id: string) => `0x${id.replaceAll("-", "").padEnd(64, "a")}`;
const verifier = "A".repeat(43);
const redirectUri = "http://127.0.0.1:3001/mcp/local-oauth-callback";

test("disposable authorization-code lifecycle is hashed, PKCE-bound, atomic, revocable, and rollback-safe", { skip }, async () => {
  const sql = postgres(databaseUrl!, { prepare: false, max: 4, ssl: false }); const store = new PostgresRemoteMcpAuthorizationCodeStore(databaseUrl!); const id = randomUUID(); const authorizationId = randomUUID(); const walletAddress = wallet(id); const suffix = randomUUID().slice(0, 8); const start = new Date("2030-02-01T00:00:00.000Z"); const expiresAt = new Date(start.getTime() + 60 * 60_000).toISOString();
  const previousFreeze = process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE; process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE = "false";
  try {
    await sql`insert into stakemate_profiles (id, wallet_address, username, username_normalized, created_at, updated_at) values (${id}, ${walletAddress}, ${`code_${suffix}`}, ${`code_${suffix}`}, ${start.toISOString()}, ${start.toISOString()})`;
    await sql`insert into stakemate_remote_mcp_authorizations (id, oauth_subject, oauth_client_id, profile_id, wallet_address, approved_scopes, token_id_hash, authorized_at, expires_at) values (${authorizationId}, 'local-preview-subject', 'stakemate-local-mcp-preview', ${id}, ${walletAddress}, ${["invitations:read"]}, ${"4".repeat(64)}, ${start.toISOString()}, ${expiresAt})`;
    const issued = await store.issue({ authorizationId, clientId: "stakemate-local-mcp-preview", redirectUri, profileId: id, walletAddress, scopes: ["invitations:read"], codeChallenge: remoteMcpPkceS256(verifier), codeChallengeMethod: "S256" }, start);
    const [stored] = await sql`select code_hash from stakemate_remote_mcp_authorization_codes where id = ${issued.id}`;
    assert.equal(stored.code_hash, remoteMcpAuthorizationCodeHash(issued.code)); assert.notEqual(stored.code_hash, issued.code, "plaintext code is never persisted");
    assert.equal(await store.consume({ code: issued.code, clientId: "wrong-client", redirectUri, codeVerifier: verifier }, start), null, "client mismatch");
    assert.equal(await store.consume({ code: issued.code, clientId: "stakemate-local-mcp-preview", redirectUri: `${redirectUri}/changed`, codeVerifier: verifier }, start), null, "redirect mismatch");
    assert.equal(await store.consume({ code: issued.code, clientId: "stakemate-local-mcp-preview", redirectUri, codeVerifier: "B".repeat(43) }, start), null, "invalid verifier");
    const consumed = await store.consume({ code: issued.code, clientId: "stakemate-local-mcp-preview", redirectUri, codeVerifier: verifier }, start);
    assert.equal(consumed?.profileId, id); assert.equal(consumed?.walletAddress, walletAddress);
    assert.equal(await store.consume({ code: issued.code, clientId: "stakemate-local-mcp-preview", redirectUri, codeVerifier: verifier }, start), null, "replay rejected");

    const concurrent = await store.issue({ authorizationId, clientId: "stakemate-local-mcp-preview", redirectUri, profileId: id, walletAddress, scopes: ["invitations:read"], codeChallenge: remoteMcpPkceS256(verifier), codeChallengeMethod: "S256" }, start);
    const results = await Promise.all(Array.from({ length: 8 }, () => store.consume({ code: concurrent.code, clientId: "stakemate-local-mcp-preview", redirectUri, codeVerifier: verifier }, start)));
    assert.equal(results.filter(Boolean).length, 1, "only one concurrent exchange may consume a code");

    const expired = await store.issue({ authorizationId, clientId: "stakemate-local-mcp-preview", redirectUri, profileId: id, walletAddress, scopes: ["invitations:read"], codeChallenge: remoteMcpPkceS256(verifier), codeChallengeMethod: "S256", expiresAt: new Date(start.getTime() + 1_000).toISOString() }, start);
    assert.equal(await store.consume({ code: expired.code, clientId: "stakemate-local-mcp-preview", redirectUri, codeVerifier: verifier }, new Date(start.getTime() + 2_000)), null, "expired code rejected");

    const rollbackCode = "rollback-code-never-stored";
    await assert.rejects(() => sql.begin(async (transaction) => { await transaction`insert into stakemate_remote_mcp_authorization_codes (id, authorization_id, oauth_client_id, redirect_uri, profile_id, wallet_address, approved_scopes, code_hash, pkce_code_challenge, pkce_code_challenge_method, issued_at, expires_at) values (${randomUUID()}, ${authorizationId}, 'stakemate-local-mcp-preview', ${redirectUri}, ${id}, ${walletAddress}, ${["invitations:read"]}, ${remoteMcpAuthorizationCodeHash(rollbackCode)}, ${remoteMcpPkceS256(verifier)}, 'S256', ${start.toISOString()}, ${new Date(start.getTime() + 1_000).toISOString()})`; throw new Error("rollback test"); }), /rollback test/);
    assert.equal((await sql`select count(*)::int as count from stakemate_remote_mcp_authorization_codes where code_hash = ${remoteMcpAuthorizationCodeHash(rollbackCode)}`)[0].count, 0, "rolled-back code absent");

    const revocable = await store.issue({ authorizationId, clientId: "stakemate-local-mcp-preview", redirectUri, profileId: id, walletAddress, scopes: ["invitations:read"], codeChallenge: remoteMcpPkceS256(verifier), codeChallengeMethod: "S256" }, start);
    await sql`update stakemate_remote_mcp_authorizations set revoked_at = ${start.toISOString()} where id = ${authorizationId}`;
    assert.equal(await store.consume({ code: revocable.code, clientId: "stakemate-local-mcp-preview", redirectUri, codeVerifier: verifier }, start), null, "revoked consent rejected");
    await assert.rejects(() => sql`insert into stakemate_remote_mcp_authorization_codes (id, authorization_id, oauth_client_id, redirect_uri, profile_id, wallet_address, approved_scopes, code_hash, pkce_code_challenge, pkce_code_challenge_method, issued_at, expires_at) values (${randomUUID()}, ${authorizationId}, 'stakemate-local-mcp-preview', ${redirectUri}, ${id}, ${`0x${"b".repeat(64)}`}, ${["invitations:read"]}, ${"5".repeat(64)}, ${remoteMcpPkceS256(verifier)}, 'S256', ${start.toISOString()}, ${new Date(start.getTime() + 1_000).toISOString()})`, /binding mismatch/, "wallet/profile mismatch rejected");

    const [rls] = await sql`select relrowsecurity as enabled from pg_class where oid = 'stakemate_remote_mcp_authorization_codes'::regclass`; assert.equal(rls.enabled, true);
  } finally {
    if (previousFreeze === undefined) delete process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE; else process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE = previousFreeze;
    await sql`delete from stakemate_remote_mcp_authorization_codes where profile_id = ${id}`;
    await sql`delete from stakemate_remote_mcp_authorizations where id = ${authorizationId}`;
    await sql`delete from stakemate_profiles where id = ${id}`;
    await store.close(); await sql.end({ timeout: 5 });
  }
});

test("authorization-code database failures do not produce a redemption", { skip }, async () => {
  const previousFreeze = process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE; process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE = "false";
  const unavailable = new PostgresRemoteMcpAuthorizationCodeStore("postgres://test:test@127.0.0.1:1/test");
  try { await assert.rejects(() => unavailable.consume({ code: "unavailable-code", clientId: "stakemate-local-mcp-preview", redirectUri, codeVerifier: verifier })); }
  finally { await unavailable.close(); if (previousFreeze === undefined) delete process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE; else process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE = previousFreeze; }
});
