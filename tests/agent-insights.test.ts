import assert from "node:assert/strict";
import test from "node:test";
import { analyzeAgentMemories, AgentInsightsRateLimiter, memoryDigest, recordsForCanonicalInvitations, recordsForWallet, receiptVerifiedEvidence } from "../src/lib/server/agent-insights";
import { MemoryReceiptStore, WalrusMemoryService } from "../src/lib/server/walrus-memory";
import { invitationMemoryEvents } from "../src/lib/server/invitation-memory-events";
import type { CanonicalInvitation } from "../src/lib/server/canonical-invitation-persistence";

const prediction = { id: "11111111-1111-4111-8111-111111111111", occurredAt: "2026-10-30T00:00:00.000Z", challengeId: "duel-1", actorId: "wallet:a", type: "player.prediction" as const, playerId: "wallet:a", fixtureId: "fixture-1", competitionCode: "PL", selection: "home_win" as const, confidence: .5 };
const outcome = { id: "22222222-2222-4222-8222-222222222222", occurredAt: "2026-10-30T01:00:00.000Z", challengeId: "result-1", actorId: "football-data", type: "match.result" as const, fixtureId: "fixture-1", competitionCode: "PL", homeScore: 1, awayScore: 0, result: "home_win" as const, evidenceRef: "fixture:fixture-1" };
async function completed(store: MemoryReceiptStore, record: typeof prediction | typeof outcome, blobId = "blob-1") { const digest = memoryDigest(record); await store.put({ recordId: record.id, digest, preparedAt: "2026-10-30T00:00:00.000Z", completedAt: "2026-10-30T00:01:00.000Z", status: "completed", blobId }); }
const canonicalInvitation = (id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", creatorProfileId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", recipientProfileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", coreHash = `0x${"a".repeat(64)}`): CanonicalInvitation => ({
  id, status: "accepted", creatorProfileId, recipientProfileId, creatorWalletAddress: `0x${"1".repeat(64)}`, recipientWalletAddress: `0x${"2".repeat(64)}`,
  core: { version: "stakemate.football-1x2-duel.v2", provider: "football-data.org/v4", competitionCode: "PL", competitionName: "Premier League", fixtureId: "fixture-1", homeTeamId: "home", homeTeam: "Home", awayTeamId: "away", awayTeam: "Away", kickoffUtc: "2030-01-02T12:00:00.000Z", creatorAddress: `0x${"1".repeat(64)}`, opponentAddress: `0x${"2".repeat(64)}`, creatorSelection: "home_win", opponentSelection: "away_win", unselectedOutcome: "draw", stakeMist: "100", invitationLifetimeMinutes: 15, voidRule: "full_principal_refund_for_unselected_outcome_or_provider_failure" },
  coreBytes: "canonical", coreHash, invitationExpiresAtUtc: "2030-01-01T00:15:00.000Z", createdAtUtc: "2030-01-01T00:00:00.000Z", statusChangedAtUtc: "2030-01-01T00:02:00.000Z", outcomeDeadlineUtc: "2030-01-03T00:00:00.000Z", acceptedChallenge: null, acceptedChallengeBytes: null, acceptedChallengeHash: null, acceptedWalletAddress: null, fundingDeadlineAtUtc: null,
});

test("only exact completed receipt-backed recalled records influence deterministic analysis", async () => {
  const store = new MemoryReceiptStore(); await completed(store, prediction);
  const result = await analyzeAgentMemories([prediction], store);
  assert.equal(result.evidence.length, 1); assert.equal(result.categories.predictions, 1); assert.equal(result.categories.verifiedOutcomes, 0); assert.equal(result.recommendation, "insufficient_verified_evidence"); assert.notEqual(result.comparison.withMemory, result.comparison.withoutMemory);
});
test("forged or mismatched recalled records are rejected", async () => {
  const store = new MemoryReceiptStore(); const digest = memoryDigest(prediction); await store.put({ recordId: "wrong-id", digest, preparedAt: "2026-10-30T00:00:00.000Z", completedAt: "2026-10-30T00:01:00.000Z", status: "completed", blobId: "blob-1" });
  assert.equal((await receiptVerifiedEvidence([prediction], store)).length, 0);
});
test("wallet isolation excludes another wallet's private prediction", () => {
  const other = { ...prediction, id: "33333333-3333-4333-8333-333333333333", actorId: "wallet:b", playerId: "wallet:b" };
  assert.deepEqual(recordsForWallet([prediction, other], "wallet:a"), [prediction]);
});
test("canonical invitation evidence matches records for its authenticated profile binding", () => {
  const invitation = canonicalInvitation(); const records = invitationMemoryEvents(invitation);
  assert.deepEqual(recordsForCanonicalInvitations(records, [invitation]), records);
});
test("canonical invitation evidence excludes records for an unrelated wallet's invitation", () => {
  const ownerInvitation = canonicalInvitation(); const unrelatedInvitation = canonicalInvitation("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "ffffffff-ffff-4fff-8fff-ffffffffffff", `0x${"b".repeat(64)}`);
  assert.deepEqual(recordsForCanonicalInvitations(invitationMemoryEvents(ownerInvitation), [unrelatedInvitation]), []);
});
test("a database/profile mismatch cannot claim a historical record even when the invitation ID collides", () => {
  const historical = canonicalInvitation(); const currentDatabaseRow = canonicalInvitation(historical.id, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", `0x${"b".repeat(64)}`);
  assert.deepEqual(recordsForCanonicalInvitations(invitationMemoryEvents(historical), [currentDatabaseRow]), []);
});
test("a verified result qualifies evidence without claiming prediction accuracy", async () => {
  const store = new MemoryReceiptStore(); await completed(store, outcome);
  const result = await analyzeAgentMemories([outcome], store);
  assert.equal(result.recommendation, "outcomes_available_no_accuracy_claim"); assert.match(result.reasoning, /does not calculate prediction accuracy/);
});
test("rate limiting is subject isolated and expires", () => {
  const limiter = new AgentInsightsRateLimiter(1, 100); assert.equal(limiter.allow("wallet-a", 0), true); assert.equal(limiter.allow("wallet-a", 1), false); assert.equal(limiter.allow("wallet-b", 1), true); assert.equal(limiter.allow("wallet-a", 101), true);
});
test("provider recall failure does not create local evidence or a recommendation", async () => {
  const service = new WalrusMemoryService(async () => ({ health: async () => ({}), remember: async () => ({ job_id: "unused" }), waitForRememberJob: async () => ({ id: "unused", blob_id: "unused" }), recall: async () => { throw new Error("provider unavailable"); } }), new MemoryReceiptStore(), false);
  await assert.rejects(() => service.recallValidatedRecords("StakeMate football memories", 1), /provider unavailable/);
});
