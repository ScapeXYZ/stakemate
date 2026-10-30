import assert from "node:assert/strict";
import test from "node:test";
import { assertFixtureUnchanged, buildDuelDraftTerms, canonicalizeDuelDraftTerms, hashDuelDraftTerms, suiToMist } from "../src/lib/duel-draft";

const creator = { username: "Creator", walletAddress: "0x1111111111111111111111111111111111111111111111111111111111111111" };
const opponent = { username: "Opponent", walletAddress: "0x2222222222222222222222222222222222222222222222222222222222222222" };
const fixture = { provider: "football-data.org/v4" as const, competitionCode: "PL" as const, competitionName: "Premier League", fixtureId: "42", homeTeam: { id: "1", name: "Home" }, awayTeam: { id: "2", name: "Away" }, kickoffUtc: "2030-01-02T15:00:00.000Z", providerStatus: "TIMED" as const, eligibility: "eligible" as const, retrievedAtUtc: "2030-01-01T12:00:00.000Z" };
const createdAt = new Date("2030-01-01T12:00:00.000Z");
function draft() { return buildDuelDraftTerms({ fixture, creator, opponent, creatorSelection: "home_win", opponentSelection: "away_win", stakeSui: "0.123456789", invitationLifetimeMinutes: 15, createdAt }); }

test("SUI stake conversion uses exact integer MIST and rejects floats, zero, and excess precision", () => {
  assert.equal(suiToMist("1"), "1000000000"); assert.equal(suiToMist("0.000000001"), "1"); assert.equal(suiToMist("0.123456789"), "123456789");
  for (const value of ["0", "1e-1", "0.0000000001", "-1", "1."]) assert.throws(() => suiToMist(value));
});

test("1X2 terms make both selections and the third unselected outcome explicit", () => {
  const terms = draft(); assert.equal(terms.unselectedOutcome, "draw"); assert.equal(terms.totalPotMist, "246913578"); assert.equal(terms.invitationExpiresAtUtc, "2030-01-01T12:15:00.000Z");
  assert.match(terms.outcomeRule, /unselectedOutcome voids/); assert.throws(() => buildDuelDraftTerms({ fixture, creator, opponent, creatorSelection: "draw", opponentSelection: "draw", stakeSui: "1", invitationLifetimeMinutes: 15, createdAt }));
});

test("canonical draft hash changes on terms tampering", () => {
  const terms = draft(); const hash = hashDuelDraftTerms(terms); assert.equal(hash, hashDuelDraftTerms(draft())); assert.match(canonicalizeDuelDraftTerms(terms), /market=1X2/);
  assert.notEqual(hash, hashDuelDraftTerms({ ...terms, stakeMist: "123456790" }));
  assert.notEqual(hash, hashDuelDraftTerms({ ...terms, fixture: { ...terms.fixture, fixtureId: "43" } }));
  assert.throws(() => hashDuelDraftTerms({ ...terms, opponent: { ...terms.opponent, walletAddress: creator.walletAddress } }), /cannot duel itself/);
});

test("draft refuses self challenges and fixtures that are no longer eligible", () => {
  assert.throws(() => buildDuelDraftTerms({ fixture, creator, opponent: creator, creatorSelection: "home_win", opponentSelection: "away_win", stakeSui: "1", invitationLifetimeMinutes: 10, createdAt }));
  assert.throws(() => buildDuelDraftTerms({ fixture: { ...fixture, providerStatus: "SCHEDULED", eligibility: "display_only" }, creator, opponent, creatorSelection: "home_win", opponentSelection: "away_win", stakeSui: "1", invitationLifetimeMinutes: 10, createdAt }));
});

test("revalidation fails closed when fixture teams, kickoff, or status changes", () => {
  const reference = { fixtureId: "42", kickoffUtc: fixture.kickoffUtc, homeTeamId: "1", awayTeamId: "2", providerStatus: "TIMED" as const };
  assert.doesNotThrow(() => assertFixtureUnchanged(reference, fixture));
  assert.throws(() => assertFixtureUnchanged(reference, { ...fixture, kickoffUtc: "2030-01-02T16:00:00.000Z" }));
  assert.throws(() => assertFixtureUnchanged(reference, { ...fixture, homeTeam: { ...fixture.homeTeam, id: "9" } }));
  assert.throws(() => assertFixtureUnchanged(reference, { ...fixture, providerStatus: "SCHEDULED", eligibility: "display_only" }));
});
