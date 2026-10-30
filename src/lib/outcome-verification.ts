export type VerifiedFixture = { provider: string; fixtureId: string; league: string; homeTeam: string; awayTeam: string; scheduledKickoffUtc: string; status: "scheduled" | "timed"; verifiedAtUtc: string };
export type SportsResult = { source: string; fixtureId: string; status: "final" | "postponed" | "cancelled" | "abandoned"; homeScore?: number; awayScore?: number; observedAtUtc: string };
export type CryptoObservation = { source: string; pair: string; quoteCurrency: string; observedAtUtc: string; price: number };

export function validateUpcomingFixture(fixture: VerifiedFixture, nowMs = Date.now()): string | undefined {
  if (!fixture.provider || !fixture.fixtureId || !fixture.league || !fixture.homeTeam || !fixture.awayTeam) return "Fixture provider ID, league, and teams are required.";
  if (fixture.homeTeam === fixture.awayTeam) return "Fixture teams must be distinct.";
  if (!["scheduled", "timed"].includes(fixture.status)) return "Fixture is not an eligible upcoming status.";
  const kickoff = Date.parse(fixture.scheduledKickoffUtc);
  if (!Number.isFinite(kickoff) || kickoff <= nowMs) return "Fixture kickoff must be a verified future UTC time.";
  return undefined;
}

export function resolveSportsMarket(market: "home_win" | "draw" | "away_win", results: readonly SportsResult[]): { state: "settle"; winner: "creator" | "opponent" } | { state: "void_refund"; reason: string } | { state: "dispute"; reason: string } {
  if (results.some((result) => ["postponed", "cancelled", "abandoned"].includes(result.status))) return { state: "void_refund", reason: "Fixture was postponed, cancelled, or abandoned." };
  const finals = results.filter((result) => result.status === "final" && Number.isInteger(result.homeScore) && Number.isInteger(result.awayScore));
  if (finals.length < 2) return { state: "dispute", reason: "Two independent final-result sources are required." };
  const distinct = new Set(finals.map((result) => `${result.homeScore}:${result.awayScore}`));
  if (distinct.size !== 1) return { state: "dispute", reason: "Final-result sources conflict." };
  const [home, away] = [finals[0].homeScore!, finals[0].awayScore!];
  const actual = home > away ? "home_win" : home < away ? "away_win" : "draw";
  return { state: "settle", winner: actual === market ? "creator" : "opponent" };
}

export function resolveCryptoThreshold(direction: "above" | "at_or_above" | "below" | "at_or_below", threshold: number, observations: readonly CryptoObservation[], maxAgeMs: number, nowMs = Date.now()): { state: "settle"; conditionMet: boolean } | { state: "void_refund" | "dispute"; reason: string } {
  if (!Number.isFinite(threshold) || observations.length < 2) return { state: "dispute", reason: "Two valid price observations are required." };
  const valid = observations.filter((observation) => Number.isFinite(observation.price) && nowMs - Date.parse(observation.observedAtUtc) <= maxAgeMs);
  if (valid.length < 2) return { state: "void_refund", reason: "Price feed is stale or unavailable." };
  if (new Set(valid.map((observation) => `${observation.pair}/${observation.quoteCurrency}`)).size !== 1) return { state: "dispute", reason: "Price feed markets conflict." };
  const values = new Set(valid.map((observation) => observation.price));
  if (values.size !== 1) return { state: "dispute", reason: "Price feed observations conflict." };
  const price = valid[0].price;
  const conditionMet = direction === "above" ? price > threshold : direction === "at_or_above" ? price >= threshold : direction === "below" ? price < threshold : price <= threshold;
  return { state: "settle", conditionMet };
}
