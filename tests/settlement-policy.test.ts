import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_TYPE, ESCROW_DEPLOYMENT } from "../src/lib/escrow-config";
import type { EscrowChallenge } from "../src/lib/escrow-discovery";
import { SimulationSettlementPipeline, settlementSigningEnabled, simulateSettlementPolicy, type SettlementPolicyInput } from "../src/lib/server/settlement-policy";

const creator = `0x${"11".repeat(32)}`; const opponent = `0x${"22".repeat(32)}`; const authority = `0x${"33".repeat(32)}`; const challengeId = `0x${"44".repeat(32)}`; const termsHash = `0x${"ab".repeat(32)}`;
const now = new Date("2030-01-01T03:00:00.000Z"); const kickoff = "2030-01-01T00:00:00.000Z";
const challenge: EscrowChallenge = { id: challengeId, creator, opponent, stakeMist: BigInt(100_000_000), termsHashHex: termsHash, fundingDeadlineMs: BigInt(Date.parse("2030-01-01T01:00:00.000Z")), outcomeDeadlineMs: BigInt(Date.parse("2030-01-02T00:00:00.000Z")), outcomeAuthority: authority, state: 1 };
const evidence = [
  { sourceId: "provider-final", sourceKind: "provider" as const, fixtureId: "42", competitionCode: "PL" as const, kickoffUtc: kickoff, status: "final" as const, regulationHomeScore: 2, regulationAwayScore: 1, observedAtUtc: "2030-01-01T01:00:00.000Z", sourceRetrievedAtUtc: "2030-01-01T01:01:00.000Z", provenance: "provider receipt" },
  { sourceId: "licensed-final", sourceKind: "licensed_secondary" as const, fixtureId: "42", competitionCode: "PL" as const, kickoffUtc: kickoff, status: "final" as const, regulationHomeScore: 2, regulationAwayScore: 1, observedAtUtc: "2030-01-01T01:05:00.000Z", sourceRetrievedAtUtc: "2030-01-01T01:06:00.000Z", provenance: "licensed receipt" },
];
const input = (): SettlementPolicyInput => ({ acceptedChallengeHash: termsHash, expectedChallengeId: challengeId, expectedOutcomeAuthority: authority, onChainObjectType: CHALLENGE_TYPE, knownChallengeIdsForAcceptedTerms: [challengeId], fundingConfirmation: { challengeId, packageId: ESCROW_DEPLOYMENT.packageId, fundingTransactionDigest: "funding-tx", confirmedAtUtc: "2030-01-01T00:10:00.000Z" }, onChainChallenge: challenge, commitment: { fixtureId: "42", competitionCode: "PL", kickoffUtc: kickoff, creatorSelection: "home_win", opponentSelection: "away_win", unselectedOutcome: "draw" }, evidence, now });

test("simulation policy binds exact funding, package, terms, evidence, and outcome before an unsigned preview", async () => {
  const decision = simulateSettlementPolicy(input());
  assert.equal(decision.approved, true); assert.equal(decision.expectedOutcome, 1); assert.ok(decision.preview); assert.equal(settlementSigningEnabled, false);
  const pipeline = await new SimulationSettlementPipeline().process({ ...input(), duelId: "simulation-duel" });
  assert.equal(pipeline.policy.approved, true); assert.equal(pipeline.job?.state, "prepared"); assert.match(pipeline.job?.lastError ?? "", /DISABLED/);
});

test("forged, stale, mismatched, premature, duplicate, and changed-authority cases cannot produce a preview", () => {
  const rejected = [
    { ...input(), evidence: [evidence[0]] },
    { ...input(), evidence: evidence.map((item) => ({ ...item, fixtureId: "99" })) },
    { ...input(), evidence: evidence.map((item) => ({ ...item, observedAtUtc: "2029-12-31T23:59:00.000Z" })) },
    { ...input(), acceptedChallengeHash: `0x${"cd".repeat(32)}` },
    { ...input(), expectedOutcomeAuthority: `0x${"55".repeat(32)}` },
    { ...input(), onChainObjectType: `0x${"99".repeat(32)}::challenge_escrow::Challenge` },
    { ...input(), fundingConfirmation: { ...input().fundingConfirmation!, packageId: `0x${"66".repeat(32)}` } },
    { ...input(), knownChallengeIdsForAcceptedTerms: [challengeId, `0x${"77".repeat(32)}`] },
    { ...input(), now: new Date("2030-01-01T01:30:00.000Z") },
    { ...input(), onChainChallenge: { ...challenge, outcomeDeadlineMs: BigInt(Date.parse("2030-01-01T02:00:00.000Z")) } },
  ];
  for (const item of rejected) { const decision = simulateSettlementPolicy(item); assert.equal(decision.approved, false); assert.equal(decision.preview, null); }
});

test("two declared sources are necessary but cannot prove providers did not collude", () => {
  const colluding = input();
  colluding.evidence = evidence.map((item) => ({ ...item, provenance: "separate identity; external independence not cryptographically provable" }));
  const decision = simulateSettlementPolicy(colluding);
  assert.equal(decision.approved, true); // residual provider-collusion risk is operational, not on-chain.
});

test("malicious operator-shaped input is rejected before the simulation worker receives a job", async () => {
  const pipeline = new SimulationSettlementPipeline();
  const result = await pipeline.process({ ...input(), duelId: "untrusted-request", onChainChallenge: { ...challenge, state: 0 } });
  assert.equal(result.policy.approved, false); assert.equal(result.job, null); assert.equal(result.policy.preview, null);
});
