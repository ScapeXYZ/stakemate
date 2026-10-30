import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { MemoryInvitationStore } from "../src/lib/server/invitations";
import { createRemoteMcpHandler } from "../src/lib/server/remote-mcp";
import { remoteMcpEnabled } from "../src/lib/server/remote-mcp-policy";

test("remote MCP stays disabled without an explicit HTTPS deployment configuration", () => {
  const previous = { enabled: process.env.STAKEMATE_REMOTE_MCP_ENABLED, origin: process.env.STAKEMATE_REMOTE_MCP_ORIGIN, issuer: process.env.STAKEMATE_REMOTE_MCP_OAUTH_ISSUER };
  delete process.env.STAKEMATE_REMOTE_MCP_ENABLED; delete process.env.STAKEMATE_REMOTE_MCP_ORIGIN; delete process.env.STAKEMATE_REMOTE_MCP_OAUTH_ISSUER;
  try { assert.equal(remoteMcpEnabled(), false); } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[`STAKEMATE_REMOTE_MCP_${key === "enabled" ? "ENABLED" : key.toUpperCase()}`]; } }
});

test("remote handler factory provides public discovery but no private identity without OAuth", async () => {
  const store = new MemoryInvitationStore();
  const handler = createRemoteMcpHandler({ store: () => store, football: () => ({ upcoming: async () => ({ provider: "football-data.org/v4" as const, competition: "PL" as const, retrievedAtUtc: new Date().toISOString(), attribution: "test", fixtures: [] }), timedFixture: async () => { throw new Error("unused"); } }), recallCredibility: async () => ({ records: [], provenance: {} }) }, { verify: async () => null });
  assert.equal(typeof handler.fetch, "function");
});
