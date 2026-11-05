import type { FootballDataClient } from "@/lib/server/football-data";
import { getFootballDataClient } from "@/lib/server/football-data";
import { getApiFootballSecondaryClient, type ApiFootballSecondaryClient } from "@/lib/server/football-secondary";
import { getSportmonksSecondaryClient, type SportmonksSecondaryClient } from "@/lib/server/sportmonks-football";
import { verifyFootballResult, type FootballResultEvidence, type ResultCommitment } from "@/lib/server/football-result-verification";
import { ProviderError } from "@/lib/server/errors";

export type CommittedFixture = ResultCommitment & { homeTeam: string; awayTeam: string };
/** Fetches both sources independently. Missing credentials or a failed source becomes
 * unavailable evidence, so it can never be mistaken for a result. */
type SecondaryClient = Pick<ApiFootballSecondaryClient, "result"> | Pick<SportmonksSecondaryClient, "result">;
function configuredSecondary(): SecondaryClient {
  // Never reinterpret Sportmonks credentials as API-Football credentials.
  return process.env.SPORTMONKS_API_TOKEN?.trim() ? getSportmonksSecondaryClient() : getApiFootballSecondaryClient();
}
export async function verifyCommittedFootballFixture(input: CommittedFixture, clients: { primary?: Pick<FootballDataClient, "result">; secondary?: SecondaryClient } = {}) {
  const primary = clients.primary ?? getFootballDataClient(); const secondary = clients.secondary ?? configuredSecondary();
  const primaryEvidence = primary.result(input.competitionCode, input.fixtureId).then((record): FootballResultEvidence => ({ sourceId: `${record.provider}:${record.fixtureId}`, sourceKind: "provider", fixtureId: input.fixtureId, competitionCode: input.competitionCode, kickoffUtc: input.kickoffUtc, status: record.providerStatus === "FINISHED" ? "final" : record.providerStatus === "CANCELLED" ? "cancelled" : record.providerStatus === "POSTPONED" ? "postponed" : record.providerStatus === "SUSPENDED" ? "suspended" : "unavailable", regulationHomeScore: record.providerStatus === "FINISHED" ? record.homeScore : null, regulationAwayScore: record.providerStatus === "FINISHED" ? record.awayScore : null, observedAtUtc: record.retrievedAtUtc, sourceRetrievedAtUtc: record.retrievedAtUtc, provenance: `${record.provider} match ${record.fixtureId}` })).catch((error): FootballResultEvidence => unavailable("football-data.org/v4", input, error));
  const secondaryProvider = process.env.SPORTMONKS_API_TOKEN?.trim() ? "sportmonks/v3" : "api-football/v3";
  const secondaryEvidence = secondary.result(input, { home: input.homeTeam, away: input.awayTeam }).catch((error): FootballResultEvidence => unavailable(secondaryProvider, input, error));
  const evidence = await Promise.all([primaryEvidence, secondaryEvidence]); return { evidence, verification: verifyFootballResult(input, evidence) };
}
function unavailable(sourceId: string, input: ResultCommitment, error: unknown): FootballResultEvidence { const now = new Date().toISOString(); const code = error instanceof ProviderError ? error.code : "UPSTREAM"; return { sourceId, sourceKind: sourceId === "football-data.org/v4" ? "provider" : "licensed_secondary", fixtureId: input.fixtureId, competitionCode: input.competitionCode, kickoffUtc: input.kickoffUtc, status: "unavailable", regulationHomeScore: null, regulationAwayScore: null, observedAtUtc: now, sourceRetrievedAtUtc: now, provenance: `${sourceId} unavailable: ${code}` }; }
