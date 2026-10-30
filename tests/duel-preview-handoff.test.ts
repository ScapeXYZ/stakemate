import assert from "node:assert/strict";
import test from "node:test";
import { assertPreviewFixtureEligible, fixtureHandoffKey, samePreviewFixture, type DuelPreviewFixture } from "../src/lib/duel-preview-handoff";

const future = new Date(Date.now() + 60 * 60_000).toISOString();
const fixture: DuelPreviewFixture = { fixtureId: "42", competitionCode: "PL", competitionName: "Premier League", homeTeam: { id: "1", name: "Home" }, awayTeam: { id: "2", name: "Away" }, kickoffUtc: future, providerStatus: "TIMED", eligibility: "eligible" };

test("fixture handoff uses a competition-qualified identity and accepts only an eligible future TIMED fixture", () => {
  assert.equal(fixtureHandoffKey(fixture), "PL:42");
  assert.deepEqual(assertPreviewFixtureEligible(fixture), fixture);
  assert.throws(() => assertPreviewFixtureEligible({ ...fixture, eligibility: "display_only", providerStatus: "SCHEDULED" }), /no longer eligible/);
  assert.throws(() => assertPreviewFixtureEligible({ ...fixture, kickoffUtc: new Date(Date.now() - 1).toISOString() }), /no longer eligible/);
});

test("handoff consistency rejects fixture, team, kickoff, and eligibility drift before review", () => {
  assert.equal(samePreviewFixture(fixture, { ...fixture }), true);
  assert.equal(samePreviewFixture(fixture, { ...fixture, fixtureId: "43" }), false);
  assert.equal(samePreviewFixture(fixture, { ...fixture, kickoffUtc: new Date(Date.now() + 2 * 60 * 60_000).toISOString() }), false);
  assert.equal(samePreviewFixture(fixture, { ...fixture, homeTeam: { ...fixture.homeTeam, id: "9" } }), false);
  assert.equal(samePreviewFixture(fixture, { ...fixture, eligibility: "display_only" }), false);
});
