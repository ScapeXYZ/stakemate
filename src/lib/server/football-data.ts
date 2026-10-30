import { z } from "zod";
import { ProviderError } from "@/lib/server/errors";

export const footballCompetitions = ["PL", "PD", "CL"] as const;
export type FootballCompetition = (typeof footballCompetitions)[number];
export const FOOTBALL_DATA_PROVIDER = "football-data.org/v4";
const endpoint = "https://api.football-data.org/v4";
const cacheTtlMs = 45_000;
// The documented free tier allows 10 requests/minute. One request per 6.5s
// leaves headroom for retries performed manually after an error.
const minimumRequestIntervalMs = 6_500;
const timeoutMs = 8_000;
const exactFixtureCacheTtlMs = 10_000;

const matchSchema = z.object({
  id: z.number().int().positive(),
  utcDate: z.string().min(1),
  status: z.enum(["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED", "EXTRA_TIME", "PENALTY_SHOOTOUT", "FINISHED", "SUSPENDED", "POSTPONED", "CANCELLED", "AWARDED"]),
  competition: z.object({ code: z.string().min(1), name: z.string().min(1) }),
  homeTeam: z.object({ id: z.number().int().positive(), name: z.string().min(1) }),
  awayTeam: z.object({ id: z.number().int().positive(), name: z.string().min(1) }),
});
const matchesResponseSchema = z.object({ matches: z.array(matchSchema) });

export type FootballFixture = {
  provider: typeof FOOTBALL_DATA_PROVIDER;
  competitionCode: FootballCompetition;
  competitionName: string;
  fixtureId: string;
  homeTeam: { id: string; name: string };
  awayTeam: { id: string; name: string };
  kickoffUtc: string;
  providerStatus: "TIMED" | "SCHEDULED";
  eligibility: "eligible" | "display_only";
  retrievedAtUtc: string;
};
export type FootballFixturesResponse = { provider: typeof FOOTBALL_DATA_PROVIDER; competition: FootballCompetition; retrievedAtUtc: string; attribution: string; fixtures: readonly FootballFixture[] };
export type FootballResultRecord = { provider: typeof FOOTBALL_DATA_PROVIDER; competition: FootballCompetition; fixtureId: string; providerStatus: string; retrievedAtUtc: string; homeScore: number | null; awayScore: number | null; settlementEnabled: false };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type Clock = () => number;

function assertCompetition(value: string): asserts value is FootballCompetition { if (!footballCompetitions.includes(value as FootballCompetition)) throw new ProviderError("Unsupported football competition.", "INVALID_RESPONSE"); }
function utcDate(value: number) { return new Date(value).toISOString().slice(0, 10); }
function toUtcIso(value: string) { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new ProviderError("Football provider returned an invalid kickoff time.", "INVALID_RESPONSE"); return new Date(parsed).toISOString(); }
function retryAfterFromResponse(response: Response, now: number) { const value = response.headers.get("retry-after")?.trim(); if (!value) return minimumRequestIntervalMs; if (/^\d+$/u.test(value)) return Math.min(Number(value) * 1_000, 60_000); const at = Date.parse(value); return Number.isFinite(at) && at > now ? Math.min(at - now, 60_000) : minimumRequestIntervalMs; }
function fixtureFromMatch(match: z.infer<typeof matchSchema>, competition: FootballCompetition, retrievedAtUtc: string, now: number): FootballFixture | null {
  if (match.competition.code !== competition || match.homeTeam.id === match.awayTeam.id || match.homeTeam.name === match.awayTeam.name) throw new ProviderError("Football provider returned mismatched fixture data.", "INVALID_RESPONSE");
  const kickoffUtc = toUtcIso(match.utcDate); const kickoff = Date.parse(kickoffUtc);
  if (kickoff <= now) return null;
  // TIMED has an exact kickoff; SCHEDULED may only have a provisional date and
  // therefore is intentionally never eligible for invitation creation.
  if (match.status !== "TIMED" && match.status !== "SCHEDULED") return null;
  return { provider: FOOTBALL_DATA_PROVIDER, competitionCode: competition, competitionName: match.competition.name, fixtureId: String(match.id), homeTeam: { id: String(match.homeTeam.id), name: match.homeTeam.name }, awayTeam: { id: String(match.awayTeam.id), name: match.awayTeam.name }, kickoffUtc, providerStatus: match.status, eligibility: match.status === "TIMED" ? "eligible" : "display_only", retrievedAtUtc };
}

export class FootballDataClient {
  private cache = new Map<string, { expiresAt: number; value: FootballFixturesResponse }>();
  private exactFixtureCache = new Map<string, { expiresAt: number; value: FootballFixture }>();
  private inFlight = new Map<string, Promise<unknown>>();
  private nextRequestAt = 0;
  constructor(private readonly token: string | undefined, private readonly fetcher: FetchLike = fetch, private readonly now: Clock = Date.now) {}

  async upcoming(competition: FootballCompetition, horizonDays = 7): Promise<FootballFixturesResponse> {
    assertCompetition(competition);
    if (!this.token?.trim()) throw new ProviderError("Football fixture provider is not configured.", "NOT_CONFIGURED");
    if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 7) throw new ProviderError("Fixture horizon must be between one and seven days.", "INVALID_RESPONSE");
    const now = this.now(); const from = utcDate(now); const to = utcDate(now + horizonDays * 24 * 60 * 60_000); const key = `${competition}:${from}:${to}`;
    const cached = this.cache.get(key); if (cached && cached.expiresAt > now) return cached.value;
    const inFlight = this.inFlight.get(`upcoming:${key}`) as Promise<FootballFixturesResponse> | undefined; if (inFlight) return inFlight;
    const request = this.fetchUpcoming(competition, horizonDays, key, now); this.inFlight.set(`upcoming:${key}`, request);
    try { return await request; } finally { this.inFlight.delete(`upcoming:${key}`); }
  }
  private async fetchUpcoming(competition: FootballCompetition, horizonDays: number, key: string, now: number): Promise<FootballFixturesResponse> {
    this.assertPaced(now, "Football provider request is rate limited locally; use cached data or retry shortly.");
    const from = utcDate(now); const to = utcDate(now + horizonDays * 24 * 60 * 60_000);
    const url = new URL(`${endpoint}/competitions/${competition}/matches`); url.searchParams.set("dateFrom", from); url.searchParams.set("dateTo", to);
    let response: Response;
    try { response = await this.fetcher(url.toString(), { headers: { "X-Auth-Token": this.token!, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" }); }
    catch (error) { if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw new ProviderError("Football provider request timed out.", "TIMEOUT"); throw new ProviderError("Football provider request failed.", "UPSTREAM"); }
    if (response.status === 401 || response.status === 403) throw new ProviderError("Football provider credentials or competition access were rejected.", "AUTH", response.status);
    if (response.status === 429) throw new ProviderError("Football provider rate limit reached.", "RATE_LIMIT", response.status, retryAfterFromResponse(response, now));
    if (!response.ok) throw new ProviderError("Football provider request failed.", "UPSTREAM", response.status);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new ProviderError("Football provider returned invalid JSON.", "INVALID_RESPONSE"); }
    const parsed = matchesResponseSchema.safeParse(payload); if (!parsed.success) throw new ProviderError("Football provider returned an invalid fixture response.", "INVALID_RESPONSE");
    const retrievedAtUtc = new Date(now).toISOString(); const fixtures = parsed.data.matches.map((match) => fixtureFromMatch(match, competition, retrievedAtUtc, now)).filter((fixture): fixture is FootballFixture => fixture !== null).sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc));
    const value: FootballFixturesResponse = { provider: FOOTBALL_DATA_PROVIDER, competition, retrievedAtUtc, attribution: "Fixture data provided by football-data.org", fixtures };
    this.cache.set(key, { expiresAt: now + cacheTtlMs, value }); return value;
  }

  /** Exact-fixture revalidation for a draft. Only a future TIMED fixture qualifies. */
  async timedFixture(competition: FootballCompetition, fixtureId: string): Promise<FootballFixture> {
    assertCompetition(competition); if (!this.token?.trim()) throw new ProviderError("Football fixture provider is not configured.", "NOT_CONFIGURED"); if (!/^\d+$/u.test(fixtureId)) throw new ProviderError("Invalid fixture ID.", "INVALID_RESPONSE");
    const now = this.now(); const key = `${competition}:${fixtureId}`; const cached = this.exactFixtureCache.get(key); if (cached && cached.expiresAt > now && Date.parse(cached.value.kickoffUtc) > now) return cached.value;
    const inFlight = this.inFlight.get(`fixture:${key}`) as Promise<FootballFixture> | undefined; if (inFlight) return inFlight;
    const request = this.fetchTimedFixture(competition, fixtureId, key, now); this.inFlight.set(`fixture:${key}`, request);
    try { return await request; } finally { this.inFlight.delete(`fixture:${key}`); }
  }
  private async fetchTimedFixture(competition: FootballCompetition, fixtureId: string, key: string, now: number): Promise<FootballFixture> {
    this.assertPaced(now, "Football provider request is rate limited locally; retry shortly.");
    let response: Response;
    try { response = await this.fetcher(`${endpoint}/matches/${fixtureId}`, { headers: { "X-Auth-Token": this.token!, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" }); }
    catch (error) { if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw new ProviderError("Football provider request timed out.", "TIMEOUT"); throw new ProviderError("Football provider request failed.", "UPSTREAM"); }
    if (response.status === 401 || response.status === 403) throw new ProviderError("Football provider credentials or competition access were rejected.", "AUTH", response.status);
    if (response.status === 429) throw new ProviderError("Football provider rate limit reached.", "RATE_LIMIT", response.status, retryAfterFromResponse(response, now));
    if (!response.ok) throw new ProviderError("Football provider request failed.", "UPSTREAM", response.status);
    const raw = await response.json().catch(() => { throw new ProviderError("Football provider returned invalid JSON.", "INVALID_RESPONSE"); }); const match = matchSchema.safeParse(raw); if (!match.success || String(match.data.id) !== fixtureId) throw new ProviderError("Football provider returned an invalid fixture response.", "INVALID_RESPONSE");
    const fixture = fixtureFromMatch(match.data, competition, new Date(now).toISOString(), now); if (!fixture || fixture.providerStatus !== "TIMED") throw new ProviderError("Fixture is no longer an eligible TIMED future fixture.", "INVALID_RESPONSE"); this.exactFixtureCache.set(key, { expiresAt: now + exactFixtureCacheTtlMs, value: fixture }); return fixture;
  }

  /** Read-only evidence retrieval. It never evaluates a winner or triggers settlement. */
  async result(competition: FootballCompetition, fixtureId: string): Promise<FootballResultRecord> {
    assertCompetition(competition); if (!this.token?.trim()) throw new ProviderError("Football fixture provider is not configured.", "NOT_CONFIGURED"); if (!/^\d+$/u.test(fixtureId)) throw new ProviderError("Invalid fixture ID.", "INVALID_RESPONSE");
    const now = this.now(); this.assertPaced(now, "Football provider request is rate limited locally; retry shortly.");
    let response: Response;
    try { response = await this.fetcher(`${endpoint}/matches/${fixtureId}`, { headers: { "X-Auth-Token": this.token, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" }); }
    catch (error) { if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw new ProviderError("Football provider request timed out.", "TIMEOUT"); throw new ProviderError("Football provider request failed.", "UPSTREAM"); }
    if (response.status === 401 || response.status === 403) throw new ProviderError("Football provider credentials or competition access were rejected.", "AUTH", response.status);
    if (response.status === 429) throw new ProviderError("Football provider rate limit reached.", "RATE_LIMIT", response.status, retryAfterFromResponse(response, now));
    if (!response.ok) throw new ProviderError("Football provider request failed.", "UPSTREAM", response.status);
    const raw = await response.json().catch(() => { throw new ProviderError("Football provider returned invalid JSON.", "INVALID_RESPONSE"); }); const match = matchSchema.safeParse(raw); if (!match.success || match.data.competition.code !== competition || String(match.data.id) !== fixtureId) throw new ProviderError("Football provider returned an invalid result response.", "INVALID_RESPONSE");
    const score = z.object({ fullTime: z.object({ home: z.number().int().nullable().optional(), away: z.number().int().nullable().optional() }).optional() }).safeParse(raw); return { provider: FOOTBALL_DATA_PROVIDER, competition, fixtureId, providerStatus: match.data.status, retrievedAtUtc: new Date(now).toISOString(), homeScore: score.success ? score.data.fullTime?.home ?? null : null, awayScore: score.success ? score.data.fullTime?.away ?? null : null, settlementEnabled: false };
  }
  private assertPaced(now: number, message: string) { if (this.nextRequestAt > now) throw new ProviderError(message, "RATE_LIMIT", undefined, this.nextRequestAt - now); this.nextRequestAt = now + minimumRequestIntervalMs; }
}

let configuredClient: FootballDataClient | undefined;
export function getFootballDataClient() { configuredClient ??= new FootballDataClient(process.env.FOOTBALL_DATA_API_TOKEN); return configuredClient; }
