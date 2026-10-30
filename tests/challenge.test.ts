import assert from "node:assert/strict";
import test from "node:test";
import { validateChallenge } from "../src/lib/challenge";

const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);
test("accepts a complete demo challenge", () => {
  assert.deepEqual(validateChallenge({ fixture: "Demo FC vs Example United", market: "Home win", stake: "2", opponent: "@sam", deadline: future }), {});
});
test("requires all challenge fields and a positive stake", () => {
  const errors = validateChallenge({ fixture: "", market: "", stake: "0", opponent: "", deadline: "" });
  assert.ok(errors.fixture && errors.market && errors.stake && errors.opponent && errors.deadline);
});
test("rejects past deadlines", () => {
  const errors = validateChallenge({ fixture: "Fixture", market: "Draw", stake: "1", opponent: "@sam", deadline: "2020-01-01T12:00" });
  assert.equal(errors.deadline, "Deadline must be in the future.");
});
