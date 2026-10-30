import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalInvitationPersistenceAdapter } from "../src/lib/server/canonical-invitation-persistence";
import { DurableSettlementWorker } from "../src/lib/server/durable-settlement-worker";
import { maintenanceWriteFreezeStatus } from "../src/lib/server/maintenance-write-freeze";
import { PostgresInvitationStore } from "../src/lib/server/postgres-invitations";
import { WalrusMemoryService } from "../src/lib/server/walrus-memory";
import { PostgresRemoteConsentLookup } from "../src/lib/server/remote-mcp-consent-store";
import { PostgresRemoteMcpConsentRequestStore } from "../src/lib/server/remote-mcp-consent-requests";
import { createLocalAuthorizationConsentPreview, validateLocalAuthorizationRequest } from "../src/lib/server/local-mcp-oauth-authorization";
import { PostgresRemoteMcpAuthorizationCodeStore } from "../src/lib/server/remote-mcp-authorization-codes";

const unavailable = /Application writes are temporarily unavailable/;
const testUrl = "postgres://test:test@127.0.0.1:1/test";

test("maintenance write freeze is disabled by default and blocks every server mutation before database or provider access", async () => {
  const previous = process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE;
  delete process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE;
  assert.deepEqual(maintenanceWriteFreezeStatus(), { applicationWritesFrozen: false });
  process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE = "true";
  const store = new PostgresInvitationStore(testUrl);
  const canonical = new CanonicalInvitationPersistenceAdapter(testUrl, { enabledForIntegrationTest: true, ssl: false });
  const worker = new DurableSettlementWorker(testUrl, { enabledForIntegrationTest: true, ssl: false });
  const remoteConsent = new PostgresRemoteConsentLookup(testUrl);
  const remoteRequests = new PostgresRemoteMcpConsentRequestStore(testUrl);
  const authorizationCodes = new PostgresRemoteMcpAuthorizationCodeStore(testUrl);
  const walrus = new WalrusMemoryService(async () => { throw new Error("provider should not be reached"); }, undefined, true);
  try {
    assert.deepEqual(maintenanceWriteFreezeStatus(), { applicationWritesFrozen: true });
    await assert.rejects(() => store.cleanupExpired(), unavailable);
    await assert.rejects(() => store.createNonce({ nonce: "nonce", walletAddress: "0x" + "1".repeat(64), message: "message", expiresAt: new Date(Date.now() + 60_000).toISOString(), usedAt: null }), unavailable);
    await assert.rejects(() => store.consumeNonce("nonce", "0x" + "1".repeat(64), new Date()), unavailable);
    await assert.rejects(() => store.claimUsername("0x" + "1".repeat(64), "freeze_test", new Date()), unavailable);
    await assert.rejects(() => store.createSession({ id: "00000000-0000-4000-8000-000000000001", tokenHash: "hash", walletAddress: "0x" + "1".repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: null, createdAt: new Date().toISOString() }), unavailable);
    await assert.rejects(() => store.revokeSession("hash", new Date()), unavailable);
    await assert.rejects(() => canonical.create({ authenticatedCreatorWallet: "0x" + "1".repeat(64), recipientWalletAddress: "0x" + "2".repeat(64), core: {} as never, outcomeDeadlineUtc: new Date().toISOString(), idempotencyKey: "a".repeat(16) }), unavailable);
    await assert.rejects(() => canonical.respond({ invitationId: "00000000-0000-4000-8000-000000000002", authenticatedWallet: "0x" + "2".repeat(64), action: "accept", outcomeAuthority: "0x" + "3".repeat(64), idempotencyKey: "b".repeat(16) }), unavailable);
    await assert.rejects(() => canonical.expire("00000000-0000-4000-8000-000000000003"), unavailable);
    await assert.rejects(() => worker.claim("freeze-worker"), unavailable);
    await assert.rejects(() => worker.recoverExpiredLeases(), unavailable);
    await assert.rejects(() => worker.reconcileMockReceipt("00000000-0000-4000-8000-000000000004", "not_found"), unavailable);
    await assert.rejects(() => walrus.write({}), unavailable);
    await assert.rejects(() => walrus.reconcileAccepted({}), unavailable);
    await assert.rejects(() => remoteConsent.grant({ oauthSubject: "subject", clientId: "client", profileId: "00000000-0000-4000-8000-000000000005", walletAddress: "0x" + "1".repeat(64), scopes: ["invitations:read"], tokenIdentifier: "test", expiresAt: new Date(Date.now() + 60_000).toISOString() }), unavailable);
    await assert.rejects(() => remoteConsent.revoke("00000000-0000-4000-8000-000000000005"), unavailable);
    await assert.rejects(() => remoteRequests.create({ oauthSubject: "subject", clientId: "client", requestedScopes: ["invitations:read"] }), unavailable);
    const localRequest = validateLocalAuthorizationRequest(new URLSearchParams({ response_type: "code", client_id: "stakemate-local-mcp-preview", redirect_uri: "http://127.0.0.1:3001/mcp/local-oauth-callback", state: "state-binding-value-123", scope: "invitations:read", code_challenge: "a".repeat(43), code_challenge_method: "S256" }));
    assert.equal(localRequest.ok, true); if (localRequest.ok) await assert.rejects(() => createLocalAuthorizationConsentPreview(localRequest.request, { id: "00000000-0000-4000-8000-000000000005", walletAddress: "0x" + "1".repeat(64), username: "freeze_user", usernameNormalized: "freeze_user", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, remoteRequests), unavailable);
    await assert.rejects(() => remoteRequests.decide({ id: "00000000-0000-4000-8000-000000000006", state: "state", csrfToken: "csrf", decision: "approved", profileId: "00000000-0000-4000-8000-000000000005", walletAddress: "0x" + "1".repeat(64) }), unavailable);
    await assert.rejects(() => remoteRequests.revokeConnection("00000000-0000-4000-8000-000000000005", "00000000-0000-4000-8000-000000000005", "0x" + "1".repeat(64)), unavailable);
    await assert.rejects(() => authorizationCodes.issue({ authorizationId: "00000000-0000-4000-8000-000000000005", clientId: "client", redirectUri: "http://127.0.0.1/callback", profileId: "00000000-0000-4000-8000-000000000005", walletAddress: "0x" + "1".repeat(64), scopes: ["invitations:read"], codeChallenge: "a".repeat(43), codeChallengeMethod: "S256" }), unavailable);
    await assert.rejects(() => authorizationCodes.consume({ code: "code", clientId: "client", redirectUri: "http://127.0.0.1/callback", codeVerifier: "a".repeat(43) }), unavailable);
  } finally {
    await Promise.all([store.close(), canonical.close(), worker.close(), remoteConsent.close(), remoteRequests.close(), authorizationCodes.close()]);
    if (previous === undefined) delete process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE;
    else process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE = previous;
  }
});
