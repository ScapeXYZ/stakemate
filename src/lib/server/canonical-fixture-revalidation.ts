import type { FootballDuelCoreTerms } from "@/lib/football-duel-terms";
import { getFootballDataClient, type FootballDataClient, type FootballFixture } from "@/lib/server/football-data";

/**
 * Re-reads the exact provider fixture from the commitment, never from browser
 * input. This is used immediately before an invitation is acknowledged.
 */
export async function revalidateCanonicalFixture(core: FootballDuelCoreTerms, client: Pick<FootballDataClient, "timedFixture"> = getFootballDataClient()): Promise<FootballFixture> {
  const fixture = await client.timedFixture(core.competitionCode, core.fixtureId);
  if (fixture.provider !== core.provider || fixture.competitionCode !== core.competitionCode || fixture.competitionName !== core.competitionName || fixture.fixtureId !== core.fixtureId || fixture.kickoffUtc !== core.kickoffUtc || fixture.homeTeam.id !== core.homeTeamId || fixture.homeTeam.name !== core.homeTeam || fixture.awayTeam.id !== core.awayTeamId || fixture.awayTeam.name !== core.awayTeam || fixture.providerStatus !== "TIMED" || fixture.eligibility !== "eligible") {
    throw new Error("FIXTURE_CHANGED");
  }
  return fixture;
}
