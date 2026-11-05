import assert from "node:assert/strict";
import test from "node:test";
import { settlementRuntimeRoleDiagnosticResponse } from "../src/lib/settlement-runtime-role-diagnostic-response";

const metadata = {
  currentDatabase: "production",
  currentUser: "runtime_role",
  sessionUser: "runtime_role",
  bypassRls: false,
  ownsPublicSchema: false,
  canCreatePublicSchema: false,
  migrationRoleMembership: null,
};

test("runtime role diagnostic rejects missing or incorrect cron authentication before loading metadata", async () => {
  let calls = 0;
  const load = async () => { calls += 1; return metadata; };
  for (const request of [new Request("https://example.test"), new Request("https://example.test", { headers: { authorization: "Bearer wrong" } })]) {
    const response = await settlementRuntimeRoleDiagnosticResponse(request, "expected", load);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { code: "UNAUTHORIZED" });
  }
  assert.equal(calls, 0);
});

test("runtime role diagnostic returns only the approved role metadata after authentication", async () => {
  const response = await settlementRuntimeRoleDiagnosticResponse(new Request("https://example.test", { headers: { authorization: "Bearer expected" } }), "expected", async () => metadata);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), metadata);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("runtime role diagnostic fails closed when the SELECT-only loader is unavailable", async () => {
  const response = await settlementRuntimeRoleDiagnosticResponse(new Request("https://example.test", { headers: { authorization: "Bearer expected" } }), "expected", async () => { throw new Error("database unavailable"); });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: "SETTLEMENT_RUNTIME_ROLE_DIAGNOSTIC_UNAVAILABLE" });
});
