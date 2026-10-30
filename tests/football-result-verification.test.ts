import assert from "node:assert/strict";
import test from "node:test";
import { defaultCorrectionWindowMs, settlementOutcome, verifyFootballResult, type FootballResultEvidence, type ResultCommitment } from "../src/lib/server/football-result-verification";
import { SettlementWorker, settlementAutomationEnabled } from "../src/lib/server/settlement-worker";

const now = new Date("2031-01-02T12:00:00.000Z"); const commitment: ResultCommitment = { fixtureId: "42", competitionCode: "PL", kickoffUtc: "2031-01-01T12:00:00.000Z", creatorSelection: "home_win", opponentSelection: "away_win", unselectedOutcome: "draw" };
function evidence(sourceId: string, sourceKind: FootballResultEvidence["sourceKind"], home: number | null, away: number | null, status: FootballResultEvidence["status"] = "final", observed = "2031-01-02T10:00:00.000Z"): FootballResultEvidence { return { sourceId, sourceKind, fixtureId: "42", competitionCode: "PL", kickoffUtc: commitment.kickoffUtc, status, regulationHomeScore: home, regulationAwayScore: away, observedAtUtc: observed, sourceRetrievedAtUtc: observed, provenance: `${sourceId}:read-only` }; }
function funded(verification = verifyFootballResult(commitment, [evidence("provider-a", "provider", 2, 1), evidence("licensed-b", "licensed_secondary", 2, 1)], now)): Parameters<SettlementWorker["process"]>[0] { return { id: "duel-1", challengeId: `0x${"1".repeat(64)}`, state: "funded", commitment, verification, outcomeAuthority: `0x${"3".repeat(64)}` }; }

test("result verification requires independent exact regulation-time evidence and correction window", () => {
  const early = verifyFootballResult(commitment, [evidence("provider-a", "provider", 2, 1), evidence("licensed-b", "licensed_secondary", 2, 1)], new Date("2031-01-02T10:30:00.000Z"));
  assert.equal(early.state, "awaiting_correction"); assert.equal(settlementOutcome(commitment, early), null);
  const verified = verifyFootballResult(commitment, [evidence("provider-a", "provider", 2, 1), evidence("licensed-b", "licensed_secondary", 2, 1)], now);
  assert.equal(verified.state, "verified"); assert.equal(settlementOutcome(commitment, verified), 1); assert.equal(verified.finalizeAfterUtc, new Date(Date.parse("2031-01-02T10:00:00.000Z") + defaultCorrectionWindowMs).toISOString());
  assert.equal(verifyFootballResult(commitment, [evidence("provider-a", "provider", 2, 1), evidence("provider-a-copy", "provider", 2, 1)], now).state, "pending_evidence");
  assert.equal(verifyFootballResult(commitment, [evidence("provider-a", "provider", 2, 1), evidence("licensed-b", "licensed_secondary", 1, 2)], now).state, "disputed");
});

test("corrections, outages, and fixture lifecycle exceptions fail closed", () => {
  assert.equal(verifyFootballResult(commitment, [evidence("provider-a", "provider", 1, 1, "corrected"), evidence("licensed-b", "licensed_secondary", 1, 1)], now).state, "disputed");
  assert.equal(verifyFootballResult(commitment, [evidence("provider-a", "provider", null, null, "unavailable")], now).state, "unavailable");
  assert.equal(verifyFootballResult(commitment, [evidence("provider-a", "provider", null, null, "cancelled")], now).state, "void_pending");
  assert.equal(verifyFootballResult(commitment, [{ ...evidence("provider-a", "provider", 1, 0), fixtureId: "43" }, evidence("licensed-b", "licensed_secondary", 1, 0)], now).state, "disputed");
});

test("worker prepares only unsigned settlement intents for creator, opponent, and third-outcome refund", async () => {
  assert.equal(settlementAutomationEnabled, false); const worker = new SettlementWorker();
  const creator = await worker.process(funded()); assert.deepEqual({ state: creator.state, outcome: creator.settlementOutcome, error: creator.lastError }, { state: "prepared", outcome: 1, error: "AUTOMATION_SIGNING_AND_BROADCAST_DISABLED" });
  const opponentCommitment = { ...commitment, creatorSelection: "home_win" as const, opponentSelection: "draw" as const, unselectedOutcome: "away_win" as const }; const opponentVerification = verifyFootballResult(opponentCommitment, [evidence("provider-a", "provider", 0, 0), evidence("licensed-b", "licensed_secondary", 0, 0)], now);
  const opponent = await new SettlementWorker().process({ ...funded(opponentVerification), id: "duel-2", commitment: opponentCommitment }); assert.equal(opponent.settlementOutcome, 2);
  const voidVerification = verifyFootballResult(commitment, [evidence("provider-a", "provider", 1, 1), evidence("licensed-b", "licensed_secondary", 1, 1)], now);
  const voided = await new SettlementWorker().process({ ...funded(voidVerification), id: "duel-3" }); assert.equal(voided.settlementOutcome, 0);
});

test("worker is replay-safe, concurrent-safe, and paused without signing or broadcast", async () => {
  const worker = new SettlementWorker(); const duel = funded(); const [first, second] = await Promise.all([worker.process(duel), worker.process(duel)]); assert.equal(first.idempotencyKey, second.idempotencyKey); assert.equal(first.state, "prepared"); assert.equal(second.state, "prepared");
  const paused = await new SettlementWorker(() => true).process(funded()); assert.equal(paused.state, "paused"); assert.equal(paused.lastError, "EMERGENCY_PAUSE");
});
