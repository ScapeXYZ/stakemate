import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { join } from "node:path";
import { createStakeMateMcpServer } from "../src/lib/server/stakemate-mcp";
import { MemoryInvitationStore } from "../src/lib/server/invitations";
import type { FootballFixture } from "../src/lib/server/football-data";

const alice = `0x${"1".repeat(64)}`;
const bob = `0x${"2".repeat(64)}`;
const fixture: FootballFixture = { provider: "football-data.org/v4", competitionCode: "PL", competitionName: "Premier League", fixtureId: "42", homeTeam: { id: "10", name: "Arsenal FC" }, awayTeam: { id: "20", name: "Chelsea FC" }, kickoffUtc: "2030-01-02T12:00:00.000Z", providerStatus: "TIMED", eligibility: "eligible", retrievedAtUtc: "2030-01-01T00:00:00.000Z" };

async function connected(authenticated = true) {
  const store = new MemoryInvitationStore();
  await store.claimUsername(alice, "alice", new Date("2030-01-01T00:00:00.000Z"));
  await store.claimUsername(bob, "bob", new Date("2030-01-01T00:00:00.000Z"));
  const server = createStakeMateMcpServer({
    authContext: async () => authenticated ? { authorizationId: "33333333-3333-4333-8333-333333333333", walletAddress: alice, scopes: ["duels:prepare", "credibility:read", "invitations:read"], issuedAt: "2030-01-01T00:00:00.000Z", expiresAt: "2030-01-02T00:00:00.000Z" } : null,
    store: () => store,
    football: () => ({ upcoming: async () => ({ provider: "football-data.org/v4" as const, competition: "PL" as const, retrievedAtUtc: fixture.retrievedAtUtc, attribution: "test", fixtures: [fixture] }), timedFixture: async () => fixture }),
    recallCredibility: async () => ({ records: [{ id: "71c6a3d1-9041-4947-b4cc-3779453f1daa", occurredAt: "2030-01-01T00:00:00.000Z", challengeId: "credibility", actorId: "agent", type: "player.credibility_score", playerId: alice, score: 80, sampleSize: 7, methodology: "verified outcomes" }], provenance: { network: "mainnet", matchedRecordIds: ["71c6a3d1-9041-4947-b4cc-3779453f1daa"] } }),
  });
  const client = new Client({ name: "stakemate-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function decoded(result: { content: Array<{ type: string; text?: string }> }) { return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>; }

test("MCP server starts and advertises exactly the safe StakeMate tools", async () => {
  const client = new Client({ name: "stakemate-mcp-stdio-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), join(process.cwd(), "scripts/stakemate-mcp.ts")],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["stakemate_get_my_invitations", "stakemate_get_verified_fixtures", "stakemate_prepare_duel", "stakemate_read_my_credibility", "stakemate_resolve_username"]);
  } finally { await client.close(); }
});

test("MCP rejects unauthenticated private calls and invalid inputs", async () => {
  const { client, server } = await connected(false);
  try {
    const denied = await client.callTool({ name: "stakemate_get_my_invitations", arguments: {} });
    assert.equal(denied.isError, true); assert.equal(decoded(denied).code, "AUTHENTICATION_REQUIRED");
    const invalid = await client.callTool({ name: "stakemate_prepare_duel", arguments: { recipientUsername: "@bob" } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); await server.close(); }
});

test("MCP resolves public handles and safely prepares but never creates a duel", async () => {
  const { client, server } = await connected();
  try {
    const profile = await client.callTool({ name: "stakemate_resolve_username", arguments: { username: "@bob" } });
    assert.equal(profile.isError, undefined); assert.equal(decoded(profile).username, "bob");
    const prepared = await client.callTool({ name: "stakemate_prepare_duel", arguments: { naturalLanguageRequest: "Alice backs Arsenal against Bob", recipientUsername: "@bob", competition: "PL", fixtureId: "42", challengerSelection: "home_win", opponentSelection: "away_win", stakeSui: "0.1", invitationLifetimeMinutes: 15 } });
    const value = decoded(prepared); assert.equal(value.previewOnly, true); assert.equal(value.invitationCreated, false); assert.equal(value.challenger, "@alice"); assert.equal(value.opponent, "@bob");
    const credibility = await client.callTool({ name: "stakemate_read_my_credibility", arguments: {} });
    assert.equal(decoded(credibility).username, "alice");
  } finally { await client.close(); await server.close(); }
});
