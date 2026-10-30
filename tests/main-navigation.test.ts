import assert from "node:assert/strict";
import test from "node:test";
import { isCrossPageSafeNavigationHref, mainNavigationLinks } from "../src/lib/main-navigation";

test("main navigation works from pages other than home", () => {
  assert.deepEqual(mainNavigationLinks.map(({ href }) => href), ["/#prepare-duel", "/#invitations", "/#ai-agent", "/activity"]);
  assert.ok(mainNavigationLinks.every(({ href }) => isCrossPageSafeNavigationHref(href)));
});
