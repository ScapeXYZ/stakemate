import assert from "node:assert/strict";
import test from "node:test";
import { FootballDataClient, getFootballDataClient } from "../src/lib/server/football-data";
import { ProviderError, publicProviderStatus } from "../src/lib/server/errors";

const current = Date.parse("2030-01-01T12:00:00.000Z");
function payload(status = "TIMED", utcDate = "2030-01-02T15:00:00Z") { return { matches: [{ id: 42, utcDate, status, competition: { code: "PL", name: "Premier League" }, homeTeam: { id: 1, name: "Home" }, awayTeam: { id: 2, name: "Away" } }] }; }
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }

test("football adapter sends only server token header, documented filters, and maps real response shape", async () => {
  let request = ""; let headers: Headers | undefined;
  const client = new FootballDataClient("token-not-to-be-logged", async (url, init) => { request = url; headers = new Headers(init?.headers); return response(payload()); }, () => current);
  const result = await client.upcoming("PL");
  assert.match(request, /\/v4\/competitions\/PL\/matches\?dateFrom=2030-01-01&dateTo=2030-01-09/); assert.equal(headers?.get("X-Auth-Token"), "token-not-to-be-logged");
  assert.equal(result.fixtures[0].eligibility, "eligible"); assert.equal(result.fixtures[0].kickoffUtc, "2030-01-02T15:00:00.000Z");
});

test("scheduled fixtures are display-only and live or past fixtures are not returned", async () => {
  const body = { matches: [payload("SCHEDULED").matches[0], payload("IN_PLAY").matches[0], { ...payload().matches[0], id: 43, utcDate: "2029-12-31T15:00:00Z" }] };
  const client = new FootballDataClient("token", async () => response(body), () => current); const result = await client.upcoming("PL");
  assert.deepEqual(result.fixtures.map((fixture) => [fixture.fixtureId, fixture.eligibility]), [["42", "display_only"]]);
});

test("football adapter enforces exact UTC horizon timestamps for one and seven days", async () => {
  const at = Date.parse("2030-01-01T23:30:00.000Z");
  const match = (id: number, utcDate: string, status = "TIMED") => ({ id, utcDate, status, competition: { code: "PL", name: "Premier League" }, homeTeam: { id: id * 10, name: `Home ${id}` }, awayTeam: { id: id * 10 + 1, name: `Away ${id}` } });
  const body = { matches: [
    match(1, "2030-01-01T23:29:59.999Z"), // past
    match(2, "2030-01-01T23:30:00.000Z"), // inclusive start
    match(3, "2030-01-02T23:29:59.999Z"), // one-day final millisecond
    match(4, "2030-01-02T23:30:00.000Z"), // one-day exclusive end
    match(5, "2030-01-08T23:29:59.999Z"), // seven-day final millisecond
    match(6, "2030-01-08T23:30:00.000Z"), // seven-day exclusive end
    match(7, "2030-01-03T12:00:00.000Z", "POSTPONED"),
    match(8, "2030-01-03T12:00:00.000Z", "CANCELLED"),
  ] };
  const oneDay = new FootballDataClient("token", async () => response(body), () => at);
  const sevenDays = new FootballDataClient("token", async () => response(body), () => at);
  assert.deepEqual((await oneDay.upcoming("PL", 1)).fixtures.map((fixture) => fixture.fixtureId), ["2", "3"]);
  assert.deepEqual((await sevenDays.upcoming("PL", 7)).fixtures.map((fixture) => fixture.fixtureId), ["2", "3", "4", "5"]);
});

test("football adapter fails closed for missing token, malformed response, access denial, rate limit, and timeout", async () => {
  await assert.rejects(() => new FootballDataClient(undefined, async () => response({})).upcoming("PL"), (error: unknown) => error instanceof ProviderError && error.code === "NOT_CONFIGURED");
  await assert.rejects(() => new FootballDataClient("token", async () => response({ bad: true }), () => current).upcoming("PL"), (error: unknown) => error instanceof ProviderError && error.code === "INVALID_RESPONSE");
  for (const status of [401, 403]) await assert.rejects(() => new FootballDataClient("token", async () => response({}, status), () => current).upcoming("PL"), (error: unknown) => error instanceof ProviderError && error.code === "AUTH" && error.status === status);
  await assert.rejects(() => new FootballDataClient("token", async () => response({}, 429), () => current).upcoming("PL"), (error: unknown) => error instanceof ProviderError && error.code === "RATE_LIMIT" && error.retryAfterMs === 6_500);
  await assert.rejects(() => new FootballDataClient("token", async () => { throw new DOMException("timeout", "TimeoutError"); }, () => current).upcoming("PL"), (error: unknown) => error instanceof ProviderError && error.code === "TIMEOUT");
});

test("provider retry delays and concurrent cache misses are deterministic", async () => {
  const limited = new FootballDataClient("token", async () => response({}, 429), () => current);
  await assert.rejects(() => limited.upcoming("PL"), (error: unknown) => error instanceof ProviderError && error.retryAfterMs === 6_500 && publicProviderStatus(error).retryAfterSeconds === 7);
  let calls = 0; let resolveFetch: ((value: Response) => void) | undefined;
  const client = new FootballDataClient("token", async () => { calls += 1; return await new Promise<Response>((resolve) => { resolveFetch = resolve; }); }, () => current);
  const first = client.upcoming("PL"); const second = client.upcoming("PL"); assert.equal(calls, 1);
  resolveFetch!(response(payload())); assert.equal((await first).fixtures.length, 1); assert.equal((await second).fixtures.length, 1);
});

test("exact fixture revalidation deduplicates rapid previews and has a bounded cache", async () => {
  let now = current; let calls = 0; const client = new FootballDataClient("token", async () => { calls += 1; return response(payload().matches[0]); }, () => now);
  const [first, second] = await Promise.all([client.timedFixture("PL", "42"), client.timedFixture("PL", "42")]); assert.equal(first.fixtureId, "42"); assert.equal(second.fixtureId, "42"); assert.equal(calls, 1);
  await client.timedFixture("PL", "42"); assert.equal(calls, 1, "fresh exact fixture cache is reused");
  now += 10_001; await client.timedFixture("PL", "42"); assert.equal(calls, 2, "expired exact fixture cache is not reused");
});

test("football adapter caches only briefly, rate-limits uncached calls, and rejects invalid competition", async () => {
  let now = current; let calls = 0; const client = new FootballDataClient("token", async () => { calls += 1; return response(payload()); }, () => now);
  await client.upcoming("PL"); await client.upcoming("PL"); assert.equal(calls, 1);
  await assert.rejects(() => client.upcoming("PD"), (error: unknown) => error instanceof ProviderError && error.code === "RATE_LIMIT");
  now += 46_000; await client.upcoming("PL"); assert.equal(calls, 2);
  await assert.rejects(() => client.upcoming("BL1" as never), (error: unknown) => error instanceof ProviderError && error.code === "INVALID_RESPONSE");
});

test("live football-data.org approved-scope smoke test is opt-in and read-only", { skip: process.env.RUN_FOOTBALL_DATA_SMOKE === "true" && process.env.FOOTBALL_DATA_API_TOKEN?.trim() ? false : "set RUN_FOOTBALL_DATA_SMOKE=true with FOOTBALL_DATA_API_TOKEN" }, async () => {
  for (const competition of ["PL", "PD", "CL"] as const) {
    const result = await getFootballDataClient().upcoming(competition);
    assert.equal(result.provider, "football-data.org/v4"); assert.equal(result.competition, competition);
    // The free plan limit is 10/minute; wait beyond the adapter's conservative
    // local interval before querying the next approved competition.
    await new Promise((resolve) => setTimeout(resolve, 6_600));
  }
});
