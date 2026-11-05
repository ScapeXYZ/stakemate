import { z } from "zod";
import type { FootballCompetition } from "@/lib/server/football-data";
import type { FootballResultEvidence, ResultCommitment } from "@/lib/server/football-result-verification";
import { ProviderError } from "@/lib/server/errors";

const endpoint = "https://api.sportmonks.com/v3/football";
const timeoutMs = 8_000;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const participantSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  meta: z.object({ location: z.enum(["home", "away"]) }),
});
const scoreSchema = z.object({
  description: z.string().min(1),
  score: z.object({ goals: z.number().int().nonnegative(), participant: z.enum(["home", "away"]) }),
});
const fixtureSchema = z.object({
  id: z.number().int().positive(),
  league_id: z.number().int().positive(),
  season_id: z.number().int().positive(),
  starting_at_timestamp: z.number().int().positive(),
  state: z.object({ state: z.string().min(1) }),
  participants: z.array(participantSchema),
  scores: z.array(scoreSchema),
});
// `/fixtures/date/:date` returns a collection, even when the fixture match is
// unique. Keep that shape explicit so a provider response cannot be mistaken
// for a single, unverified fixture.
const fixtureResponseSchema = z.object({ data: z.array(fixtureSchema) });
const dateResponseSchema = z.object({ data: z.array(z.unknown()) });

const normalized = (value: string) => value.normalize("NFKD").replace(/[^a-z0-9]/giu, "").toLowerCase();
const status = (value: string): FootballResultEvidence["status"] => {
  switch (value) {
    // StakeMate's 1X2 terms use regulation-time scores. AET and FT_PEN are
    // deliberately not treated as a final result until a reviewed market rule
    // explicitly supports them.
    case "FT": return "final";
    case "POSTPONED": return "postponed";
    case "CANCELLED": return "cancelled";
    case "ABANDONED": return "abandoned";
    case "SUSPENDED": case "INTERRUPTED": return "suspended";
    default: return "unavailable";
  }
};

function currentRegulationScore(scores: z.infer<typeof scoreSchema>[]) {
  const current = scores.filter((item) => item.description === "CURRENT");
  const home = current.find((item) => item.score.participant === "home")?.score.goals;
  const away = current.find((item) => item.score.participant === "away")?.score.goals;
  return Number.isInteger(home) && Number.isInteger(away) ? { home, away } : null;
}

/**
 * Independent Sportmonks Football API v3 source. Authentication is sent only
 * to Sportmonks as its documented `api_token` query parameter; it is never put
 * in returned evidence, errors, logs, or browser-visible configuration.
 */
export class SportmonksSecondaryClient {
  constructor(private readonly token: string | undefined, private readonly fetcher: FetchLike = fetch, private readonly now: () => number = Date.now) {}

  private async request(path: string, params: Record<string, string> = {}) {
    if (!this.token?.trim()) throw new ProviderError("Sportmonks secondary football provider is not configured.", "NOT_CONFIGURED");
    const url = new URL(`${endpoint}${path}`);
    url.searchParams.set("api_token", this.token);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let response: Response;
    try { response = await this.fetcher(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" }); }
    catch (error) { if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw new ProviderError("Sportmonks secondary football provider timed out.", "TIMEOUT"); throw new ProviderError("Sportmonks secondary football provider request failed.", "UPSTREAM"); }
    if (response.status === 401 || response.status === 403) throw new ProviderError("Sportmonks secondary football provider credentials or coverage were rejected.", "AUTH", response.status);
    if (response.status === 429) throw new ProviderError("Sportmonks secondary football provider rate limit reached.", "RATE_LIMIT", response.status);
    if (!response.ok) throw new ProviderError("Sportmonks secondary football provider request failed.", "UPSTREAM", response.status);
    const payload = await response.json().catch(() => { throw new ProviderError("Sportmonks secondary football provider returned invalid JSON.", "INVALID_RESPONSE"); });
    return { payload, httpStatus: response.status };
  }

  /** Read-only credential/endpoint diagnostic. It proves authentication only, not league coverage. */
  async health() {
    const date = new Date(this.now()).toISOString().slice(0, 10);
    const response = await this.request(`/fixtures/date/${date}`);
    const payload = dateResponseSchema.safeParse(response.payload);
    if (!payload.success) throw new ProviderError("Sportmonks secondary football provider returned an invalid health response.", "INVALID_RESPONSE");
    return { provider: "sportmonks/v3" as const, authenticated: true as const, httpStatus: response.httpStatus, fixtureCount: payload.data.data.length, checkedAtUtc: new Date(this.now()).toISOString() };
  }

  async result(commitment: ResultCommitment, teams: { home: string; away: string }): Promise<FootballResultEvidence> {
    const response = await this.request(`/fixtures/date/${commitment.kickoffUtc.slice(0, 10)}`, { include: "participants;scores;state" });
    const payload = fixtureResponseSchema.safeParse(response.payload);
    if (!payload.success) throw new ProviderError("Sportmonks secondary football provider returned an invalid fixture response.", "INVALID_RESPONSE");
    const kickoff = Date.parse(commitment.kickoffUtc);
    const candidates = payload.data.data.filter((fixture) => {
      const home = fixture.participants.find((item) => item.meta.location === "home"); const away = fixture.participants.find((item) => item.meta.location === "away");
      return Boolean(home && away && normalized(home.name) === normalized(teams.home) && normalized(away.name) === normalized(teams.away) && Math.abs(fixture.starting_at_timestamp * 1_000 - kickoff) <= 6 * 60 * 60_000);
    });
    if (candidates.length !== 1) throw new ProviderError("Sportmonks could not uniquely match the committed fixture or its subscribed competition coverage.", "INVALID_RESPONSE");
    const fixture = candidates[0]; const evidenceStatus = status(fixture.state.state); const score = evidenceStatus === "final" ? currentRegulationScore(fixture.scores) : null;
    if (evidenceStatus === "final" && !score) throw new ProviderError("Sportmonks final fixture has no complete regulation-time score.", "INVALID_RESPONSE");
    const retrievedAt = new Date(this.now()).toISOString();
    return { sourceId: `sportmonks/v3:${fixture.id}`, sourceKind: "licensed_secondary", fixtureId: commitment.fixtureId, competitionCode: commitment.competitionCode as FootballCompetition, kickoffUtc: commitment.kickoffUtc, status: evidenceStatus, regulationHomeScore: score?.home ?? null, regulationAwayScore: score?.away ?? null, observedAtUtc: retrievedAt, sourceRetrievedAtUtc: retrievedAt, provenance: `sportmonks/v3 fixture ${fixture.id}; league ${fixture.league_id}; season ${fixture.season_id}; matched normalized teams and kickoff within six hours` };
  }
}

export function getSportmonksSecondaryClient() { return new SportmonksSecondaryClient(process.env.SPORTMONKS_API_TOKEN); }
