import assert from "node:assert/strict";
import test from "node:test";
import { resolveCryptoThreshold, resolveSportsMarket, validateUpcomingFixture } from "../src/lib/outcome-verification";

const now = Date.parse("2026-10-29T12:00:00.000Z");
test("requires an independently identified upcoming fixture", () => {
  assert.equal(validateUpcomingFixture({ provider: "licensed-api", fixtureId: "42", league: "League", homeTeam: "Home", awayTeam: "Away", scheduledKickoffUtc: "2026-10-30T12:00:00.000Z", status: "scheduled", verifiedAtUtc: "2026-10-29T12:00:00.000Z" }, now), undefined);
  assert.ok(validateUpcomingFixture({ provider: "", fixtureId: "", league: "", homeTeam: "Demo", awayTeam: "Example", scheduledKickoffUtc: "2020-01-01T00:00:00.000Z", status: "scheduled", verifiedAtUtc: "" }, now));
  assert.ok(validateUpcomingFixture({ provider: "api", fixtureId: "1", league: "L", homeTeam: "A", awayTeam: "B", scheduledKickoffUtc: "2026-10-28T11:00:00.000Z", status: "scheduled", verifiedAtUtc: "" }, now));
});
test("sports draws settle and cancellations/conflicts void or dispute", () => {
  assert.deepEqual(resolveSportsMarket("draw", [{ source: "a", fixtureId: "1", status: "final", homeScore: 1, awayScore: 1, observedAtUtc: "" }, { source: "b", fixtureId: "1", status: "final", homeScore: 1, awayScore: 1, observedAtUtc: "" }]), { state: "settle", winner: "creator" });
  assert.equal(resolveSportsMarket("home_win", [{ source: "a", fixtureId: "1", status: "postponed", observedAtUtc: "" }]).state, "void_refund");
  assert.equal(resolveSportsMarket("home_win", [{ source: "a", fixtureId: "1", status: "final", homeScore: 1, awayScore: 0, observedAtUtc: "" }, { source: "b", fixtureId: "1", status: "final", homeScore: 0, awayScore: 1, observedAtUtc: "" }]).state, "dispute");
});
test("crypto boundaries, stale data, and conflicts are deterministic", () => {
  const observations = [{ source: "a", pair: "BTC", quoteCurrency: "USD", observedAtUtc: "2026-10-29T11:59:00.000Z", price: 100 }, { source: "b", pair: "BTC", quoteCurrency: "USD", observedAtUtc: "2026-10-29T11:59:00.000Z", price: 100 }];
  assert.deepEqual(resolveCryptoThreshold("at_or_above", 100, observations, 120_000, now), { state: "settle", conditionMet: true });
  const strict = resolveCryptoThreshold("above", 100, observations, 120_000, now); assert.equal(strict.state, "settle"); if (strict.state === "settle") assert.equal(strict.conditionMet, false);
  assert.equal(resolveCryptoThreshold("above", 100, observations.map((item) => ({ ...item, observedAtUtc: "2026-10-29T10:00:00.000Z" })), 120_000, now).state, "void_refund");
  assert.equal(resolveCryptoThreshold("above", 100, [{ ...observations[0], price: 101 }, observations[1]], 120_000, now).state, "dispute");
});
