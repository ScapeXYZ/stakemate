import { z } from "zod";
import type { FootballCompetition } from "@/lib/server/football-data";
import type { FootballResultEvidence, ResultCommitment } from "@/lib/server/football-result-verification";
import { ProviderError } from "@/lib/server/errors";

const endpoint = "https://v3.football.api-sports.io";
const timeoutMs = 8_000;
const responseSchema = z.object({ response: z.array(z.object({ fixture: z.object({ id: z.number().int().positive(), date: z.string(), status: z.object({ short: z.string() }) }), league: z.object({ name: z.string(), type: z.string() }), teams: z.object({ home: z.object({ name: z.string() }), away: z.object({ name: z.string() }) }), score: z.object({ fulltime: z.object({ home: z.number().int().nullable(), away: z.number().int().nullable() }) }) })) });
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SecondaryFixture = { id: string; kickoffUtc: string; homeTeam: string; awayTeam: string; status: string; homeScore: number | null; awayScore: number | null; leagueType: string };
const normalized = (value: string) => value.normalize("NFKD").replace(/[^a-z0-9]/giu, "").toLowerCase();
const status = (value: string): FootballResultEvidence["status"] => value === "FT" || value === "AET" || value === "PEN" ? "final" : value === "PST" ? "postponed" : value === "CANC" ? "cancelled" : value === "ABD" ? "abandoned" : value === "SUSP" || value === "INT" ? "suspended" : "unavailable";

/** Independent API-Football adapter. It is intentionally unavailable without its own key. */
export class ApiFootballSecondaryClient {
  constructor(private readonly token: string | undefined, private readonly fetcher: FetchLike = fetch, private readonly now: () => number = Date.now) {}
  async result(commitment: ResultCommitment, teams: { home: string; away: string }): Promise<FootballResultEvidence> {
    if (!this.token?.trim()) throw new ProviderError("Secondary football result provider is not configured.", "NOT_CONFIGURED");
    const date = commitment.kickoffUtc.slice(0, 10); const url = new URL(`${endpoint}/fixtures`); url.searchParams.set("date", date); url.searchParams.set("timezone", "UTC");
    let response: Response;
    try { response = await this.fetcher(url.toString(), { headers: { "x-apisports-key": this.token, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" }); }
    catch { throw new ProviderError("Secondary football result provider request failed.", "UPSTREAM"); }
    if (response.status === 401 || response.status === 403) throw new ProviderError("Secondary football result provider credentials were rejected.", "AUTH", response.status);
    if (response.status === 429) throw new ProviderError("Secondary football result provider rate limit reached.", "RATE_LIMIT", response.status);
    if (!response.ok) throw new ProviderError("Secondary football result provider request failed.", "UPSTREAM", response.status);
    const parsed = responseSchema.safeParse(await response.json().catch(() => null)); if (!parsed.success) throw new ProviderError("Secondary football result provider returned an invalid response.", "INVALID_RESPONSE");
    const matches = parsed.data.response.map((item): SecondaryFixture => ({ id: String(item.fixture.id), kickoffUtc: new Date(item.fixture.date).toISOString(), homeTeam: item.teams.home.name, awayTeam: item.teams.away.name, status: item.fixture.status.short, homeScore: item.score.fulltime.home, awayScore: item.score.fulltime.away, leagueType: item.league.type }));
    const kickoff = Date.parse(commitment.kickoffUtc); const matched = matches.filter((item) => item.leagueType === "League" && normalized(item.homeTeam) === normalized(teams.home) && normalized(item.awayTeam) === normalized(teams.away) && Math.abs(Date.parse(item.kickoffUtc) - kickoff) <= 6 * 60 * 60_000);
    if (matched.length !== 1) throw new ProviderError("Secondary provider could not uniquely match the committed fixture.", "INVALID_RESPONSE");
    const item = matched[0]; const evidenceStatus = status(item.status); const final = evidenceStatus === "final";
    if (final && (!Number.isInteger(item.homeScore) || !Number.isInteger(item.awayScore) || item.homeScore! < 0 || item.awayScore! < 0)) throw new ProviderError("Secondary provider final result has no regulation score.", "INVALID_RESPONSE");
    const retrievedAt = new Date(this.now()).toISOString();
    return { sourceId: `api-football/v3:${item.id}`, sourceKind: "licensed_secondary", fixtureId: commitment.fixtureId, competitionCode: commitment.competitionCode as FootballCompetition, kickoffUtc: commitment.kickoffUtc, status: evidenceStatus, regulationHomeScore: final ? item.homeScore : null, regulationAwayScore: final ? item.awayScore : null, observedAtUtc: retrievedAt, sourceRetrievedAtUtc: retrievedAt, provenance: `api-football/v3 fixture ${item.id}; matched normalized teams and kickoff within six hours` };
  }
}
export function getApiFootballSecondaryClient() { return new ApiFootballSecondaryClient(process.env.API_FOOTBALL_API_KEY); }
