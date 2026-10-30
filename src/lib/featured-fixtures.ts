import type { FootballCompetition, FootballFixture, FootballFixturesResponse } from "@/lib/server/football-data";

export type FeaturedFixture = FootballFixture & { prominenceScore: number; featuredReason: string };

// Reviewed editorial inputs, deliberately small and deterministic. They are not odds,
// audience measurements, or a claim that any fixture is objectively important.
const prominentTeams = new Set(["arsenal fc", "chelsea fc", "liverpool fc", "manchester city fc", "manchester united fc", "tottenham hotspur fc", "fc barcelona", "real madrid cf", "atletico de madrid", "athletic club", "bayern munich", "borussia dortmund", "paris saint-germain fc", "inter milan", "juventus fc", "ac milan"]);
const rivalries = new Set(["arsenal fc|tottenham hotspur fc", "fc barcelona|real madrid cf", "atletico de madrid|real madrid cf", "inter milan|ac milan", "manchester city fc|manchester united fc", "liverpool fc|manchester united fc"]);
const competitionWeight: Record<FootballCompetition, number> = { PL: 30, PD: 30, CL: 40 };
const key = (name: string) => name.normalize("NFC").trim().toLowerCase();

function rivalry(home: string, away: string) { const pair = [key(home), key(away)].sort().join("|"); return rivalries.has(pair); }

/** Stable editorial selection: competition weight + 10 per reviewed prominent team + 25 rivalry bonus. */
export function featuredReason(fixture: FootballFixture) {
  const teams = [fixture.homeTeam.name, fixture.awayTeam.name]; const prominent = teams.filter((team) => prominentTeams.has(key(team))).length; const isRivalry = rivalry(teams[0], teams[1]);
  const score = competitionWeight[fixture.competitionCode] + prominent * 10 + (isRivalry ? 25 : 0);
  const reasons = [`${fixture.competitionCode} competition weight`]; if (prominent) reasons.push(`${prominent} reviewed prominent team${prominent === 1 ? "" : "s"}`); if (isRivalry) reasons.push("reviewed rivalry pairing");
  return { score, reason: reasons.join(" · ") };
}

export function rankFeaturedFixtures(fixtures: readonly FootballFixture[], nowMs = Date.now(), limit = 5): FeaturedFixture[] {
  return fixtures.filter((fixture) => fixture.eligibility === "eligible" || fixture.eligibility === "display_only").filter((fixture) => ["TIMED", "SCHEDULED"].includes(fixture.providerStatus)).filter((fixture) => Date.parse(fixture.kickoffUtc) > nowMs && Number.isFinite(Date.parse(fixture.retrievedAtUtc)) && nowMs - Date.parse(fixture.retrievedAtUtc) <= 5 * 60_000).map((fixture) => ({ ...fixture, prominenceScore: featuredReason(fixture).score, featuredReason: featuredReason(fixture).reason })).sort((a, b) => b.prominenceScore - a.prominenceScore || Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc) || a.fixtureId.localeCompare(b.fixtureId)).slice(0, Math.min(Math.max(limit, 0), 5));
}

export function rankFeaturedByLeague(responses: readonly FootballFixturesResponse[], nowMs = Date.now()) { return Object.fromEntries(responses.map((response) => [response.competition, { provider: response.provider, attribution: response.attribution, retrievedAtUtc: response.retrievedAtUtc, fixtures: rankFeaturedFixtures(response.fixtures, nowMs) }])) as Record<FootballCompetition, { provider: string; attribution: string; retrievedAtUtc: string; fixtures: FeaturedFixture[] }>; }
