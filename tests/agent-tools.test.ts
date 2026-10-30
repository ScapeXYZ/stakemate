import assert from "node:assert/strict";
import test from "node:test";
import { LocalOnlyAgentTools } from "../src/lib/server/agent-tools";
import type { FootballFixture } from "../src/lib/server/football-data";
import { hashDuelDraftTerms, type DuelDraftTerms } from "../src/lib/duel-draft";

const alice = `0x${"11".repeat(32)}`; const bob = `0x${"22".repeat(32)}`;
const fixture: FootballFixture = { provider: "football-data.org/v4", competitionCode: "PL", competitionName: "Premier League", fixtureId: "42", homeTeam: { id: "1", name: "Arsenal FC" }, awayTeam: { id: "2", name: "Tottenham Hotspur FC" }, kickoffUtc: "2030-01-02T12:00:00.000Z", providerStatus: "TIMED", eligibility: "eligible", retrievedAtUtc: "2030-01-01T00:00:00.000Z" };
const identities = new Map([[alice, { username: "alice", walletAddress: alice }], [bob, { username: "bob", walletAddress: bob }]]);
function tools() { return new LocalOnlyAgentTools({ featured: async () => ({ PL: { fixtures: [] }, PD: { fixtures: [] }, CL: { fixtures: [] } }), fixture: async () => fixture, profile: async (wallet) => identities.get(wallet) ?? null, resolve: async (username) => [...identities.values()].find((value) => value.username === username) ?? null, credibility: async (wallet) => ({ wallet }) }); }
const context = (wallet: string, requestId: string, scopes: readonly "fixtures:read"[] | readonly ("fixtures:read" | "profiles:resolve" | "duels:draft")[] = ["fixtures:read", "profiles:resolve", "duels:draft"]) => ({ sessionVerified: true as const, originValidated: true as const, walletAddress: wallet, requestId, scopes });
const draft = { competition: "PL" as const, fixtureId: "42", opponentHandle: "@bob", creatorSelection: "home_win", opponentSelection: "away_win", stakeSui: "0.1", invitationLifetimeMinutes: 15 as const, expectedKickoffUtc: fixture.kickoffUtc, expectedHomeTeamId: "1", expectedAwayTeamId: "2" };

test("local-only agent tools reject unauthorized, replayed, malformed, and approval-bypass requests", async () => {
  const server = tools(); assert.deepEqual(await server.invoke(context(alice, "one", ["fixtures:read"]), "stakemate_resolve_username", { username: "bob" }), { ok: false, error: "AGENT_INPUT_INVALID" });
  assert.deepEqual(await server.invoke({ ...context(alice, "two"), originValidated: false }, "stakemate_read_fixture", { competition: "PL", fixtureId: "42" }), { ok: false, error: "AGENT_NOT_AUTHORIZED" });
  assert.equal((await server.invoke(context(alice, "three"), "stakemate_read_fixture", { competition: "PL", fixtureId: "not-id" })).ok, false);
  assert.equal((await server.invoke(context(alice, "four"), "stakemate_propose_duel_draft", { ...draft, creatorSelection: "draw", opponentSelection: "draw" })).ok, false);
  assert.equal((await server.invoke(context(alice, "five"), "stakemate_propose_duel_draft", draft)).ok, true);
  assert.deepEqual(await server.invoke(context(alice, "five"), "stakemate_propose_duel_draft", draft), { ok: false, error: "AGENT_NOT_AUTHORIZED" });
});

test("simulated two-identity agent exchange returns browser-identical previews only and never creates an invitation", async () => {
  const server = tools(); const aliceDraft = await server.invoke(context(alice, "alice-draft"), "stakemate_propose_duel_draft", draft); const bobDraft = await server.invoke(context(bob, "bob-draft"), "stakemate_propose_duel_draft", { ...draft, opponentHandle: "@alice", creatorSelection: "away_win", opponentSelection: "home_win" });
  assert.equal(aliceDraft.ok, true); assert.equal(bobDraft.ok, true); if (aliceDraft.ok && bobDraft.ok) { assert.equal((aliceDraft.result as { fundable: boolean }).fundable, false); assert.equal((aliceDraft.result as { humanApprovalRequired: boolean }).humanApprovalRequired, true); assert.equal((aliceDraft.result as { termsHash: string }).termsHash, hashDuelDraftTerms((aliceDraft.result as { terms: DuelDraftTerms }).terms)); assert.notEqual((aliceDraft.result as { termsHash: string }).termsHash, (bobDraft.result as { termsHash: string }).termsHash); }
  assert.equal(server.audit.filter((event) => event.outcome === "allowed").length, 2);
});

test("credibility reads are bound to the authenticated wallet and no invitation-send tool exists", async () => {
  const server = tools();
  const owner = await server.invoke({ ...context(alice, "credibility-owner"), scopes: ["credibility:read"] }, "stakemate_read_my_credibility", {});
  assert.deepEqual(owner, { ok: true, result: { wallet: alice } });
  assert.equal((await server.invoke({ ...context(alice, "credibility-denied"), scopes: ["fixtures:read"] }, "stakemate_read_my_credibility", {})).ok, false);
  assert.equal(server.definitions().some((tool) => tool.name.includes("send") || tool.name.includes("sign")), false);
});
