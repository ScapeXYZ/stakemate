import assert from "node:assert/strict";
import test from "node:test";
import { rankFeaturedFixtures } from "../src/lib/featured-fixtures";
import type { FootballFixture } from "../src/lib/server/football-data";

const now = Date.parse("2030-01-01T00:00:00.000Z");
function fixture(id: string, home: string, away: string, kickoff = "2030-01-02T12:00:00.000Z", status: "TIMED" | "SCHEDULED" = "TIMED"): FootballFixture { return { provider: "football-data.org/v4", competitionCode: "PD", competitionName: "La Liga", fixtureId: id, homeTeam: { id: `${id}1`, name: home }, awayTeam: { id: `${id}2`, name: away }, kickoffUtc: kickoff, providerStatus: status, eligibility: status === "TIMED" ? "eligible" : "display_only", retrievedAtUtc: "2030-01-01T00:00:00.000Z" }; }

test("featured ranking is deterministic, editorial, bounded, and keeps scheduled fixtures display-only", () => {
  const ranked = rankFeaturedFixtures([fixture("4", "Other", "Other B"), fixture("2", "Real Madrid CF", "FC Barcelona"), fixture("3", "FC Barcelona", "Other"), fixture("1", "Atletico de Madrid", "Real Madrid CF"), fixture("5", "Other C", "Other D", "2030-01-03T12:00:00.000Z", "SCHEDULED"), fixture("past", "Real Madrid CF", "FC Barcelona", "2029-12-31T00:00:00.000Z")], now);
  assert.deepEqual(ranked.map((item) => item.fixtureId), ["1", "2", "3", "4", "5"]);
  assert.match(ranked[0].featuredReason, /reviewed rivalry/); assert.equal(ranked.find((item) => item.fixtureId === "5")?.eligibility, "display_only");
});

test("featured ranking excludes stale or malformed-time fixtures and returns fewer than five", () => {
  const stale = { ...fixture("stale", "FC Barcelona", "Real Madrid CF"), retrievedAtUtc: "2029-12-31T23:54:59.999Z" }; const malformed = { ...fixture("bad", "FC Barcelona", "Real Madrid CF"), kickoffUtc: "not-a-date" };
  assert.deepEqual(rankFeaturedFixtures([stale, malformed], now), []);
});
