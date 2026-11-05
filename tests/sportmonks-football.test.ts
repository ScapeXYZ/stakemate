import assert from "node:assert/strict";
import test from "node:test";
import { SportmonksSecondaryClient } from "../src/lib/server/sportmonks-football";

const commitment = { fixtureId: "42", competitionCode: "PL" as const, kickoffUtc: "2031-01-02T12:00:00.000Z", creatorSelection: "home_win" as const, opponentSelection: "away_win" as const, unselectedOutcome: "draw" as const };
const fixture = (state = "FT", score = true) => ({ data: [{ id: 9, league_id: 8, season_id: 10, starting_at_timestamp: Date.parse(commitment.kickoffUtc) / 1_000, state: { state }, participants: [{ id: 1, name: "Arsenal FC", meta: { location: "home" } }, { id: 2, name: "Chelsea FC", meta: { location: "away" } }], scores: score ? [{ description: "CURRENT", score: { goals: 2, participant: "home" } }, { description: "CURRENT", score: { goals: 1, participant: "away" } }] : [] }] });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("Sportmonks v3 matches committed teams and kickoff, returning only FT regulation score evidence", async () => {
  const client = new SportmonksSecondaryClient("token", async (url) => { assert.match(String(url), /api_token=token/); assert.match(String(url), /include=participants%3Bscores%3Bstate/); return response(fixture()); }, () => Date.parse("2031-01-02T14:00:00.000Z"));
  const evidence = await client.result(commitment, { home: "Arsenal FC", away: "Chelsea FC" });
  assert.deepEqual({ sourceId: evidence.sourceId, status: evidence.status, home: evidence.regulationHomeScore, away: evidence.regulationAwayScore }, { sourceId: "sportmonks/v3:9", status: "final", home: 2, away: 1 });
  assert.match(evidence.provenance, /league 8; season 10/);
});
test("Sportmonks fails closed for coverage/matching failures and unsupported final formats", async () => {
  const badMatch = new SportmonksSecondaryClient("token", async () => response(fixture()), () => Date.parse("2031-01-02T14:00:00.000Z"));
  await assert.rejects(() => badMatch.result(commitment, { home: "Other", away: "Chelsea FC" }), /could not uniquely match/);
  const aET = new SportmonksSecondaryClient("token", async () => response(fixture("AET")), () => Date.parse("2031-01-02T14:00:00.000Z"));
  assert.equal((await aET.result(commitment, { home: "Arsenal FC", away: "Chelsea FC" })).status, "unavailable");
  const missingScore = new SportmonksSecondaryClient("token", async () => response(fixture("FT", false)), () => Date.parse("2031-01-02T14:00:00.000Z"));
  await assert.rejects(() => missingScore.result(commitment, { home: "Arsenal FC", away: "Chelsea FC" }), /no complete regulation-time score/);
});
test("Sportmonks health uses a read-only documented fixtures-by-date endpoint without returning the token", async () => {
  const client = new SportmonksSecondaryClient("token", async (url) => { assert.match(String(url), /fixtures\/date\/2031-01-02/); return response({ data: [] }); }, () => Date.parse("2031-01-02T14:00:00.000Z"));
  assert.deepEqual(await client.health(), { provider: "sportmonks/v3", authenticated: true, httpStatus: 200, fixtureCount: 0, checkedAtUtc: "2031-01-02T14:00:00.000Z" });
});
