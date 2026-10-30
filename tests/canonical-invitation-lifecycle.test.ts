import assert from "node:assert/strict";
import test from "node:test";
import { buildDuelDraftTerms } from "../src/lib/duel-draft";
import { coreFromDraft, canonicalizeFootballDuelCore } from "../src/lib/football-duel-terms";
import { revalidateCanonicalFixture } from "../src/lib/server/canonical-fixture-revalidation";

const creator = `0x${"1".repeat(64)}`;
const opponent = `0x${"2".repeat(64)}`;
const fixture = { provider: "football-data.org/v4" as const, competitionCode: "PL" as const, competitionName: "Premier League", fixtureId: "42", homeTeam: { id: "1", name: "Home" }, awayTeam: { id: "2", name: "Away" }, kickoffUtc: "2030-01-02T12:00:00.000Z", providerStatus: "TIMED" as const, eligibility: "eligible" as const, retrievedAtUtc: "2030-01-01T00:00:00.000Z" };
const core = () => coreFromDraft(buildDuelDraftTerms({ fixture, creator: { username: "temitope", walletAddress: creator }, opponent: { username: "Virus", walletAddress: opponent }, creatorSelection: "home_win", opponentSelection: "away_win", stakeSui: "0.1", invitationLifetimeMinutes: 15, createdAt: new Date("2030-01-01T00:00:00.000Z") }));

test("acceptance fixture revalidation fails closed when kickoff or teams change", async () => {
  const committed = core();
  await assert.doesNotReject(() => revalidateCanonicalFixture(committed, { timedFixture: async () => fixture }));
  await assert.rejects(() => revalidateCanonicalFixture(committed, { timedFixture: async () => ({ ...fixture, kickoffUtc: "2030-01-02T13:00:00.000Z" }) }), /FIXTURE_CHANGED/);
  await assert.rejects(() => revalidateCanonicalFixture(committed, { timedFixture: async () => ({ ...fixture, awayTeam: { ...fixture.awayTeam, id: "99" } }) }), /FIXTURE_CHANGED/);
});

test("canonical core rejects invalid or unequal stake commitments before persistence", () => {
  const committed = core();
  assert.throws(() => canonicalizeFootballDuelCore({ ...committed, stakeMist: "0" }), /positive MIST/);
  assert.throws(() => canonicalizeFootballDuelCore({ ...committed, stakeMist: "1.5" }), /positive MIST/);
  // Both participants receive the one immutable stake_mist value; a second,
  // unequal stake is not representable in the canonical commitment.
  assert.match(canonicalizeFootballDuelCore(committed), /stakeMist=100000000/);
});
