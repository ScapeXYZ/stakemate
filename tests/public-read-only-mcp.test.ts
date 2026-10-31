import assert from "node:assert/strict";
import test from "node:test";
import { MemoryInvitationStore, type InvitationStore } from "../src/lib/server/invitations";
import { createPublicReadOnlyMcpHandler, PublicMcpRateLimiter, remoteMcpPublicReadOnlyEnabled } from "../src/lib/server/remote-mcp";
import type { FootballFixture } from "../src/lib/server/football-data";
import { ProviderError } from "../src/lib/server/errors";

const endpoint = "https://stakemate.isholadigital.tech/api/mcp";
const fixture: FootballFixture = { provider: "football-data.org/v4", competitionCode: "PL", competitionName: "Premier League", fixtureId: "42", homeTeam: { id: "10", name: "Arsenal FC" }, awayTeam: { id: "20", name: "Chelsea FC" }, kickoffUtc: "2030-01-02T12:00:00.000Z", providerStatus: "TIMED", eligibility: "eligible", retrievedAtUtc: "2030-01-01T00:00:00.000Z" };

function request(body: string | Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request(endpoint, {
    method: "POST",
    headers: { Host: "stakemate.isholadigital.tech", Origin: "https://claude.ai", Accept: "application/json, text/event-stream", "Content-Type": "application/json", "x-vercel-forwarded-for": "198.51.100.10", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function noOriginRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request(endpoint, {
    method: "POST",
    headers: { Host: "stakemate.isholadigital.tech", Accept: "application/json, text/event-stream", "Content-Type": "application/json", "x-vercel-forwarded-for": "198.51.100.10", ...headers },
    body: JSON.stringify(body),
  });
}

async function publicHandler(options: Parameters<typeof createPublicReadOnlyMcpHandler>[1] = {}) {
  const store = new MemoryInvitationStore();
  await store.claimUsername(`0x${"1".repeat(64)}`, "alice", new Date("2030-01-01T00:00:00.000Z"));
  return createPublicReadOnlyMcpHandler({
    store: () => store,
    football: () => ({ upcoming: async () => ({ provider: "football-data.org/v4" as const, competition: "PL" as const, retrievedAtUtc: fixture.retrievedAtUtc, attribution: "test", fixtures: [fixture] }), timedFixture: async () => fixture }),
  }, options);
}

const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } } };

test("public Streamable HTTP MCP negotiates protocol and exposes exactly two public tools", async () => {
  const handler = await publicHandler({ limiter: new PublicMcpRateLimiter() });
  const initialized = await handler.fetch(request(initialize));
  assert.equal(initialized.status, 200);
  const initializedBody = await initialized.json() as { result?: { protocolVersion?: string; capabilities?: { tools?: unknown } } };
  assert.equal(initializedBody.result?.protocolVersion, "2025-03-26");
  assert.ok(initializedBody.result?.capabilities?.tools);
  assert.equal(initialized.headers.get("mcp-session-id"), null, "the anonymous endpoint is stateless");

  const listed = await handler.fetch(noOriginRequest({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, { "mcp-protocol-version": "2025-03-26" }));
  assert.equal(listed.status, 200);
  const listedBody = await listed.json() as { result?: { tools?: Array<{ name: string }> } };
  assert.deepEqual(listedBody.result?.tools?.map((tool) => tool.name).sort(), ["stakemate_get_verified_fixtures", "stakemate_resolve_username"]);

  const resolved = await handler.fetch(request({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "stakemate_resolve_username", arguments: { username: "@alice" } } }));
  const resolvedBody = await resolved.json() as { result?: { content?: Array<{ text?: string }> } };
  assert.equal(JSON.parse(resolvedBody.result?.content?.[0]?.text ?? "{}").username, "alice");
});

test("public username lookup returns only a public handle and fails closed", async () => {
  const handler = await publicHandler({ limiter: new PublicMcpRateLimiter() });
  const valid = await handler.fetch(request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "stakemate_resolve_username", arguments: { username: "@ALICE" } } }));
  const validBody = await valid.json() as { result?: { content?: Array<{ text?: string }> } };
  assert.deepEqual(JSON.parse(validBody.result?.content?.[0]?.text ?? "{}"), { username: "alice" }, "wallet addresses and all non-public profile data stay private");

  const unknown = await handler.fetch(request({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "stakemate_resolve_username", arguments: { username: "@nobody" } } }));
  const unknownBody = await unknown.json() as { result?: { content?: Array<{ text?: string }> } };
  assert.deepEqual(JSON.parse(unknownBody.result?.content?.[0]?.text ?? "{}"), { code: "USERNAME_NOT_FOUND", message: "No registered StakeMate username matches this handle." });

  const invalid = await handler.fetch(request({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "stakemate_resolve_username", arguments: { username: "@bad-handle" } } }));
  const invalidBody = await invalid.json() as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
  assert.equal(invalidBody.result?.isError, true, "invalid handles are rejected by the public schema before lookup");

  let databaseCalls = 0;
  const unavailable = createPublicReadOnlyMcpHandler({
    store: () => ({ profileForUsername: async () => { databaseCalls += 1; throw new Error("database connection unavailable"); } }) as unknown as InvitationStore,
    football: () => ({ upcoming: async () => ({ provider: "football-data.org/v4" as const, competition: "PL" as const, retrievedAtUtc: fixture.retrievedAtUtc, attribution: "test", fixtures: [fixture] }), timedFixture: async () => fixture }),
  }, { limiter: new PublicMcpRateLimiter() });
  await unavailable.fetch(request({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "stakemate_resolve_username", arguments: { username: "@bad-handle" } } }));
  assert.equal(databaseCalls, 0, "invalid handles never reach storage");
  const failed = await unavailable.fetch(request({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "stakemate_resolve_username", arguments: { username: "alice" } } }));
  const failedBody = await failed.json() as { result?: { content?: Array<{ text?: string }> } };
  assert.deepEqual(JSON.parse(failedBody.result?.content?.[0]?.text ?? "{}"), { code: "PROFILE_LOOKUP_UNAVAILABLE", message: "Public username lookup is unavailable." });
});

test("public MCP rejects private tools and strips caller credentials before protocol handling", async () => {
  const handler = await publicHandler({ limiter: new PublicMcpRateLimiter() });
  const authorization = "Bearer untrusted-client-value";
  const cookie = "stakemate_session=private-session-value";
  const privateCall = await handler.fetch(request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "stakemate_get_my_invitations", arguments: {} } }, { Authorization: authorization, Cookie: cookie }));
  assert.equal(privateCall.status, 200);
  const privateText = await privateCall.text();
  assert.equal(privateText.includes(authorization), false);
  assert.equal(privateText.includes(cookie), false);
  const privateBody = JSON.parse(privateText) as { error?: { code?: number } };
  assert.equal(privateBody.error?.code, -32602, "an unadvertised private tool is rejected before any tool handler runs");

  const malformed = await handler.fetch(request("not json"));
  const malformedBody = await malformed.json() as { error?: { code?: number } };
  assert.equal(malformedBody.error?.code, -32700);

  const secretShapedPayload = "client-secret-must-not-echo";
  const secretError = await handler.fetch(request(secretShapedPayload));
  assert.equal((await secretError.text()).includes(secretShapedPayload), false, "parse failures never reflect request content");
});

test("public fixture lookup returns a safe provider category, status, or genuine empty window", async () => {
  const unavailable = createPublicReadOnlyMcpHandler({
    store: () => new MemoryInvitationStore(),
    football: () => ({
      upcoming: async () => { throw new ProviderError("provider rejected credential", "AUTH", 403); },
      timedFixture: async () => fixture,
    }),
  }, { limiter: new PublicMcpRateLimiter() });
  const unavailableResponse = await unavailable.fetch(request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "stakemate_get_verified_fixtures", arguments: { competition: "PL" } } }));
  const unavailableBody = await unavailableResponse.json() as { result?: { content?: Array<{ text?: string }> } };
  assert.deepEqual(JSON.parse(unavailableBody.result?.content?.[0]?.text ?? "{}"), {
    code: "FIXTURE_LOOKUP_UNAVAILABLE",
    message: "Verified fixture data is unavailable; do not infer a fixture.",
    providerErrorCategory: "AUTH",
    providerHttpStatus: 403,
  });

  const empty = createPublicReadOnlyMcpHandler({
    store: () => new MemoryInvitationStore(),
    football: () => ({
      upcoming: async () => ({ provider: "football-data.org/v4" as const, competition: "PL" as const, retrievedAtUtc: fixture.retrievedAtUtc, attribution: "test", fixtures: [] }),
      timedFixture: async () => fixture,
    }),
  }, { limiter: new PublicMcpRateLimiter() });
  const emptyResponse = await empty.fetch(request({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "stakemate_get_verified_fixtures", arguments: { competition: "PL" } } }));
  const emptyBody = await emptyResponse.json() as { result?: { content?: Array<{ text?: string }> } };
  assert.deepEqual(JSON.parse(emptyBody.result?.content?.[0]?.text ?? "{}"), { provider: "football-data.org/v4", fixtures: [], fixtureWindow: "empty" });
});

test("public MCP applies origin, method, media-type, payload-size, rate, and timeout guards", async () => {
  const handler = await publicHandler({ limiter: new PublicMcpRateLimiter() });
  assert.equal((await handler.fetch(request(initialize, { Origin: "https://attacker.example" }))).status, 403);
  assert.equal((await handler.fetch(request(initialize, { Host: "stakemate-preview.vercel.app" }))).status, 421, "Vercel preview and deployment hosts cannot serve the canonical public connector");
  const wrongUrl = new Request("https://stakemate-preview.vercel.app/api/mcp", { method: "POST", headers: { Host: "stakemate.isholadigital.tech", Origin: "https://claude.ai", Accept: "application/json, text/event-stream", "Content-Type": "application/json" }, body: JSON.stringify(initialize) });
  assert.equal((await handler.fetch(wrongUrl)).status, 421);
  const get = new Request(endpoint, { headers: { Host: "stakemate.isholadigital.tech" } });
  assert.equal((await handler.fetch(get)).status, 405);
  assert.equal((await handler.fetch(request(initialize, { "Content-Type": "text/plain" }))).status, 415);
  assert.equal((await handler.fetch(request("x".repeat(64 * 1024 + 1)))).status, 413);
  const chunkedOversizeOptions = {
    method: "POST",
    headers: { Host: "stakemate.isholadigital.tech", Origin: "https://claude.ai", Accept: "application/json, text/event-stream", "Content-Type": "application/json", "x-vercel-forwarded-for": "198.51.100.11" },
    body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(64 * 1024 + 1))); controller.close(); } }),
    duplex: "half",
  };
  const chunkedOversize = new Request(endpoint, chunkedOversizeOptions);
  assert.equal((await handler.fetch(chunkedOversize)).status, 413, "transport bounds bodies even without Content-Length");

  const rateLimited = await publicHandler({ limiter: new PublicMcpRateLimiter() });
  for (let index = 0; index < 30; index += 1) await rateLimited.fetch(request("not json", { "x-vercel-forwarded-for": "198.51.100.22" }));
  assert.equal((await rateLimited.fetch(request("not json", { "x-vercel-forwarded-for": "198.51.100.22" }))).status, 429);

  const timeoutHandler = createPublicReadOnlyMcpHandler({
    store: () => new MemoryInvitationStore(),
    football: () => ({ upcoming: async () => await new Promise<never>(() => undefined), timedFixture: async () => fixture }),
  }, { limiter: new PublicMcpRateLimiter(), timeoutMs: 1 });
  assert.equal((await timeoutHandler.fetch(request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "stakemate_get_verified_fixtures", arguments: { competition: "PL" } } }))).status, 504);
});

test("the public-read-only gate is separate from the private remote MCP gate", () => {
  const previous = { public: process.env.STAKEMATE_REMOTE_MCP_PUBLIC_READ_ONLY_ENABLED, private: process.env.STAKEMATE_REMOTE_MCP_ENABLED };
  try {
    delete process.env.STAKEMATE_REMOTE_MCP_PUBLIC_READ_ONLY_ENABLED;
    process.env.STAKEMATE_REMOTE_MCP_ENABLED = "true";
    assert.equal(remoteMcpPublicReadOnlyEnabled(), false);
    process.env.STAKEMATE_REMOTE_MCP_PUBLIC_READ_ONLY_ENABLED = "true";
    assert.equal(remoteMcpPublicReadOnlyEnabled(), true);
  } finally {
    if (previous.public === undefined) delete process.env.STAKEMATE_REMOTE_MCP_PUBLIC_READ_ONLY_ENABLED;
    else process.env.STAKEMATE_REMOTE_MCP_PUBLIC_READ_ONLY_ENABLED = previous.public;
    if (previous.private === undefined) delete process.env.STAKEMATE_REMOTE_MCP_ENABLED;
    else process.env.STAKEMATE_REMOTE_MCP_ENABLED = previous.private;
  }
});
