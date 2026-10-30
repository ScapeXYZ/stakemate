import assert from "node:assert/strict";
import test from "node:test";
import { recommendFromCredibilityMemories } from "../src/lib/memory/recommendations";

const player = "wallet:player-a";
const score = { id: "bb2f1c1a-9041-4947-b4cc-3779453f1daa", occurredAt: "2026-10-30T00:00:00.000Z", challengeId: "credibility-a", actorId: "agent:score", type: "player.credibility_score" as const, playerId: player, score: 82, sampleSize: 7, methodology: "verified completed duel outcomes" };

test("retrieved credibility memory changes a future challenge recommendation", () => {
  const result = recommendFromCredibilityMemories(player, [score], "2026-10-30T01:00:00.000Z");
  assert.equal(result.recommendation, "eligible");
  assert.equal(result.score, 82);
  assert.deepEqual(result.provenance.recordIds, [score.id]);
});

test("missing or untrusted memory does not personalize a recommendation", () => {
  const result = recommendFromCredibilityMemories(player, [{ type: "player.credibility_score", playerId: player, score: 100 }]);
  assert.equal(result.recommendation, "needs_more_history");
  assert.equal(result.score, null);
});
