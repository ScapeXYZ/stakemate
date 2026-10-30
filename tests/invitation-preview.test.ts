import assert from "node:assert/strict";
import test from "node:test";
import { availableOpponentSelections, outcomeLabels, previewFundingMessage } from "../src/lib/invitation-preview";

test("preview UX permits only a distinct opponent 1X2 selection and never describes escrow", () => {
  assert.deepEqual(availableOpponentSelections("home_win"), ["draw", "away_win"]);
  assert.equal(outcomeLabels.draw, "Draw");
  assert.match(previewFundingMessage(), /not started/); assert.match(previewFundingMessage(), /not itself escrow funds/);
});
