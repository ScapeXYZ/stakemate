import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import postgres from "postgres";
import { createMcpPairing, consumeMcpPairing, mcpAuthorizationIsActive, revokeMcpAuthorizationsForSession } from "../src/lib/server/mcp-authorization";
import { PostgresInvitationStore, type Session } from "../src/lib/server/postgres-invitations";

const databaseUrl = process.env.STAKEMATE_TEST_DATABASE_URL;
const disposable = (() => { try { const url = new URL(databaseUrl ?? ""); return process.env.STAKEMATE_MCP_BROKER_INTEGRATION_DISPOSABLE === "1" && url.hostname === "127.0.0.1" && url.port === "55435"; } catch { return false; } })();
const skip = disposable ? undefined : "requires STAKEMATE_MCP_BROKER_INTEGRATION_DISPOSABLE=1 and localhost STAKEMATE_TEST_DATABASE_URL";
const wallet = (digit: string) => normalizeSuiAddress(`0x${digit.repeat(64)}`).toLowerCase();

test("isolated MCP broker binds one-use pairings to their session and wallet, rejects replay/expiry, and revokes immediately", { skip }, async () => {
  const sql = postgres(databaseUrl!, { prepare: false, max: 1, ssl: false }); const store = new PostgresInvitationStore(databaseUrl!); const suffix = randomUUID().slice(0, 8); const first = wallet("a"); const second = wallet("b");
  const firstSession: Session = { id: randomUUID(), tokenHash: `mcp-${randomUUID()}`, walletAddress: first, expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: null, createdAt: new Date().toISOString() };
  const secondSession: Session = { id: randomUUID(), tokenHash: `mcp-${randomUUID()}`, walletAddress: second, expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: null, createdAt: new Date().toISOString() };
  try {
    const [firstProfile, secondProfile] = await Promise.all([store.claimUsername(first, `mcpa${suffix}`, new Date()), store.claimUsername(second, `mcpb${suffix}`, new Date())]);
    await Promise.all([store.createSession(firstSession), store.createSession(secondSession)]);
    const [firstPairing, secondPairing] = await Promise.all([createMcpPairing(firstSession, firstProfile), createMcpPairing(secondSession, secondProfile)]);
    assert.notEqual(firstPairing.pairingCode, secondPairing.pairingCode);
    const authorization = await consumeMcpPairing(firstPairing.pairingCode);
    await assert.rejects(() => consumeMcpPairing(firstPairing.pairingCode), /invalid, expired, already consumed, or revoked/);
    assert.equal(await mcpAuthorizationIsActive(authorization.id, first), true);
    assert.equal(await mcpAuthorizationIsActive(authorization.id, second), false);
    await revokeMcpAuthorizationsForSession(firstSession);
    assert.equal(await mcpAuthorizationIsActive(authorization.id, first), false);
    await assert.rejects(() => consumeMcpPairing(secondPairing.pairingCode, new Date(Date.now() + 10 * 60_000)), /invalid, expired, already consumed, or revoked/);
  } finally {
    await sql`delete from stakemate_mcp_authorizations where session_id in (${firstSession.id}, ${secondSession.id})`;
    await sql`delete from stakemate_sessions where id in (${firstSession.id}, ${secondSession.id})`;
    await sql`delete from stakemate_profiles where wallet_address in (${first}, ${second})`;
    await store.close(); await sql.end({ timeout: 2 });
  }
});
