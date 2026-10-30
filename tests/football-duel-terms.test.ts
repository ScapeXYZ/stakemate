import assert from "node:assert/strict";
import test from "node:test";
import { buildFootballDuelCreateChallenge } from "../src/lib/escrow-transactions";
import { canonicalizeFootballDuelChallenge, coreFromDraft, hashFootballDuelChallenge, hashFootballDuelCore, moveHashBytes } from "../src/lib/football-duel-terms";
import { buildDuelDraftTerms } from "../src/lib/duel-draft";

const creator = `0x${"11".repeat(32)}`; const opponent = `0x${"22".repeat(32)}`; const authority = `0x${"33".repeat(32)}`; const now = new Date("2030-01-01T00:00:00.000Z");
function draft() { return buildDuelDraftTerms({ fixture: { provider: "football-data.org/v4", competitionCode: "PL", competitionName: "Premier League", fixtureId: "42", homeTeam: { id: "1", name: "Arsenal FC" }, awayTeam: { id: "2", name: "Tottenham Hotspur FC" }, kickoffUtc: "2030-01-02T12:00:00.000Z", providerStatus: "TIMED", eligibility: "eligible", retrievedAtUtc: now.toISOString() }, creator: { username: "alice", walletAddress: creator }, opponent: { username: "bob", walletAddress: opponent }, creatorSelection: "home_win", opponentSelection: "away_win", stakeSui: "0.1", invitationLifetimeMinutes: 15, createdAt: now }); }
function accepted() { return { ...coreFromDraft(draft()), invitationExpiresAtUtc: "2030-01-01T00:15:00.000Z", fundingDeadlineUtc: "2030-01-01T00:20:00.000Z", outcomeDeadlineUtc: "2030-01-03T00:00:00.000Z", outcomeAuthority: authority } as const; }

test("v2 core and accepted Move challenge have deterministic, explicitly different hashes", () => {
  const core = coreFromDraft(draft()); const coreHash = hashFootballDuelCore(core); const challenge = accepted(); const moveHash = hashFootballDuelChallenge(challenge);
  assert.match(coreHash, /^[0-9a-f]{64}$/); assert.match(moveHash, /^0x[0-9a-f]{64}$/); assert.equal(moveHash, hashFootballDuelChallenge(accepted())); assert.notEqual(coreHash, moveHash.slice(2)); assert.match(canonicalizeFootballDuelChallenge(challenge), /^stakemate\.challenge-terms\.v1\n/); assert.equal(moveHash, "0x913b839bc9f0c1058a6e003c292ac7afeffd5cedcd2589e3c9cbccfc49cc7285"); assert.equal(moveHashBytes(moveHash).length, 32);
});

test("core tampering and acceptance-only deadline tampering are separately detected", () => {
  const core = coreFromDraft(draft()); assert.notEqual(hashFootballDuelCore({ ...core, stakeMist: "100000001" }), hashFootballDuelCore(core)); assert.notEqual(hashFootballDuelCore({ ...core, creatorSelection: "draw", unselectedOutcome: "home_win" }), hashFootballDuelCore(core)); assert.notEqual(hashFootballDuelCore({ ...core, opponentAddress: authority }), hashFootballDuelCore(core));
  const challenge = accepted(); assert.notEqual(hashFootballDuelChallenge({ ...challenge, fundingDeadlineUtc: "2030-01-01T00:21:00.000Z" }), hashFootballDuelChallenge(challenge)); assert.throws(() => hashFootballDuelChallenge({ ...challenge, fundingDeadlineUtc: challenge.outcomeDeadlineUtc }), /strictly increase/);
});

test("core creation rejects stale fixtures, self-wallets, and malformed accepted terms", () => {
  const stale = draft();
  assert.throws(() => coreFromDraft({ ...stale, fixture: { ...stale.fixture, kickoffUtc: "2020-01-01T00:00:00.000Z" } }), /future/);
  assert.throws(() => coreFromDraft({ ...stale, opponent: { ...stale.opponent, walletAddress: creator } }), /cannot duel itself/);
  assert.throws(() => moveHashBytes("0x12"), /32-byte/);
});

test("accepted canonical terms map exactly to unsigned Move arguments in MIST and milliseconds", () => {
  const challenge = accepted(); const mapped = buildFootballDuelCreateChallenge(challenge); assert.equal(mapped.termsHashHex, hashFootballDuelChallenge(challenge)); assert.equal(mapped.preview.stakeMist, BigInt(100000000)); assert.deepEqual(mapped.preview.deadlines, [BigInt(1893457200000), BigInt(1893628800000)]); assert.throws(() => buildFootballDuelCreateChallenge({ ...challenge, opponentAddress: creator }), /self/);
});
