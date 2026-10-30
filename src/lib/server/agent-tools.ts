import { z } from "zod";
import { buildDuelDraftTerms, hashDuelDraftTerms, oneXTwoSelections, type OneXTwoSelection } from "@/lib/duel-draft";
import type { FeaturedFixture } from "@/lib/featured-fixtures";
import type { FootballCompetition, FootballFixture } from "@/lib/server/football-data";
import type { PublicHandleIdentity } from "@/lib/server/invitations";

export type AgentScope = "fixtures:read" | "profiles:resolve" | "duels:draft" | "credibility:read";
export type AgentContext = { sessionVerified: boolean; originValidated: boolean; walletAddress: string; scopes: readonly AgentScope[]; requestId: string };
export type AgentAuditEvent = { tool: string; requestId: string; walletBound: boolean; outcome: "allowed" | "denied" | "invalid" };
export type AgentDependencies = { featured(): Promise<Record<FootballCompetition, { fixtures: FeaturedFixture[] }>>; fixture(competition: FootballCompetition, fixtureId: string): Promise<FootballFixture>; profile(wallet: string): Promise<PublicHandleIdentity | null>; resolve(username: string): Promise<PublicHandleIdentity | null>; credibility?(wallet: string): Promise<unknown> };

const listInput = z.object({ competition: z.enum(["PL", "PD", "CL"]).optional() });
const fixtureInput = z.object({ competition: z.enum(["PL", "PD", "CL"]), fixtureId: z.string().regex(/^\d+$/).max(24) });
const resolveInput = z.object({ username: z.string().trim().min(3).max(25).regex(/^@?[a-zA-Z0-9_]+$/) });
const draftInput = fixtureInput.extend({ opponentHandle: z.string().trim().min(3).max(25).regex(/^@?[a-zA-Z0-9_]+$/), creatorSelection: z.enum(oneXTwoSelections), opponentSelection: z.enum(oneXTwoSelections), stakeSui: z.string().trim().max(32), invitationLifetimeMinutes: z.union([z.literal(10), z.literal(15)]), expectedKickoffUtc: z.string().datetime(), expectedHomeTeamId: z.string().max(24), expectedAwayTeamId: z.string().max(24) });

/** Provider-neutral MCP tool core. It is not an HTTP server and has no remote transport. */
export class LocalOnlyAgentTools {
  private readonly seen = new Set<string>(); readonly audit: AgentAuditEvent[] = [];
  constructor(private readonly deps: AgentDependencies) {}
  definitions() { return [{ name: "stakemate_list_featured_fixtures", inputSchema: { type: "object", properties: { competition: { enum: ["PL", "PD", "CL"] } } }, scopes: ["fixtures:read"] }, { name: "stakemate_read_fixture", inputSchema: { type: "object", properties: { competition: { enum: ["PL", "PD", "CL"] }, fixtureId: { type: "string" } }, required: ["competition", "fixtureId"] }, scopes: ["fixtures:read"] }, { name: "stakemate_resolve_username", inputSchema: { type: "object", properties: { username: { type: "string" } }, required: ["username"] }, scopes: ["profiles:resolve"] }, { name: "stakemate_read_my_credibility", inputSchema: { type: "object", properties: {} }, scopes: ["credibility:read"], authorization: "authenticated wallet owner only" }, { name: "stakemate_propose_duel_draft", inputSchema: { type: "object" }, scopes: ["duels:draft"] }] as const; }
  async invoke(context: AgentContext, tool: string, input: unknown) {
    if (!context.sessionVerified || !context.originValidated || !context.requestId || this.seen.has(context.requestId)) return this.deny(tool, context, "denied"); this.seen.add(context.requestId);
    try {
      if (tool === "stakemate_list_featured_fixtures") { this.scope(context, "fixtures:read"); const parsed = listInput.parse(input); const all = await this.deps.featured(); const leagues = parsed.competition ? { [parsed.competition]: all[parsed.competition] } : all; return this.allow(tool, context, leagues); }
      if (tool === "stakemate_read_fixture") { this.scope(context, "fixtures:read"); const parsed = fixtureInput.parse(input); return this.allow(tool, context, await this.deps.fixture(parsed.competition, parsed.fixtureId)); }
      if (tool === "stakemate_resolve_username") { this.scope(context, "profiles:resolve"); const parsed = resolveInput.parse(input); return this.allow(tool, context, await this.deps.resolve(parsed.username.replace(/^@/, ""))); }
      if (tool === "stakemate_read_my_credibility") { this.scope(context, "credibility:read"); z.object({}).strict().parse(input); if (!this.deps.credibility) throw new Error("CREDIBILITY_UNAVAILABLE"); return this.allow(tool, context, await this.deps.credibility(context.walletAddress)); }
      if (tool === "stakemate_propose_duel_draft") { this.scope(context, "duels:draft"); const parsed = draftInput.parse(input); if (parsed.creatorSelection === parsed.opponentSelection) throw new Error("OUTCOMES_MUST_DIFFER"); const creator = await this.deps.profile(context.walletAddress); const opponent = await this.deps.resolve(parsed.opponentHandle.replace(/^@/, "")); if (!creator || !opponent) throw new Error("PROFILE_NOT_FOUND"); const fixture = await this.deps.fixture(parsed.competition, parsed.fixtureId); if (fixture.kickoffUtc !== parsed.expectedKickoffUtc || fixture.homeTeam.id !== parsed.expectedHomeTeamId || fixture.awayTeam.id !== parsed.expectedAwayTeamId || fixture.providerStatus !== "TIMED") throw new Error("FIXTURE_CHANGED"); const terms = buildDuelDraftTerms({ fixture, creator, opponent, creatorSelection: parsed.creatorSelection as OneXTwoSelection, opponentSelection: parsed.opponentSelection as OneXTwoSelection, stakeSui: parsed.stakeSui, invitationLifetimeMinutes: parsed.invitationLifetimeMinutes, createdAt: new Date() }); return this.allow(tool, context, { previewOnly: true, fundable: false, terms, termsHash: hashDuelDraftTerms(terms), humanApprovalRequired: true }); }
      return this.deny(tool, context, "invalid");
    } catch { return this.deny(tool, context, "invalid"); }
  }
  private scope(context: AgentContext, required: AgentScope) { if (!context.scopes.includes(required)) throw new Error("SCOPE_DENIED"); }
  private allow(tool: string, context: AgentContext, result: unknown) { this.audit.push({ tool, requestId: context.requestId, walletBound: true, outcome: "allowed" }); return { ok: true as const, result }; }
  private deny(tool: string, context: AgentContext, outcome: "denied" | "invalid") { this.audit.push({ tool, requestId: context.requestId, walletBound: Boolean(context.walletAddress), outcome }); return { ok: false as const, error: outcome === "denied" ? "AGENT_NOT_AUTHORIZED" : "AGENT_INPUT_INVALID" }; }
}
