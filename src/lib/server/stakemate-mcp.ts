import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { buildDuelDraftTerms, hashDuelDraftTerms, oneXTwoSelections, oneXTwoLabel } from "@/lib/duel-draft";
import { recommendFromCredibilityMemories } from "@/lib/memory/recommendations";
import { getFootballDataClient, footballCompetitions, type FootballCompetition, type FootballFixture } from "@/lib/server/football-data";
import { getInvitationStore, type InvitationStore } from "@/lib/server/invitations";
import { getWalrusMemoryService } from "@/lib/server/walrus-memory";
import type { McpAuthContext } from "@/lib/server/mcp-auth-context";
import { ProviderError } from "@/lib/server/errors";

type PrivateScope = "duels:prepare" | "credibility:read" | "invitations:read";
export type McpDependencies = {
  authContext(): Promise<McpAuthContext | null>;
  store(): InvitationStore;
  football(): Pick<ReturnType<typeof getFootballDataClient>, "upcoming" | "timedFixture">;
  recallCredibility(walletAddress: string, username: string): Promise<unknown>;
};

const competition = z.enum(footballCompetitions);
const username = z.string().trim().min(3).max(25).regex(/^@?[a-zA-Z0-9_]+$/);
const selection = z.enum(oneXTwoSelections);
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> });
const error = (code: string, message: string, details: Record<string, unknown> = {}) => ({ isError: true as const, content: [{ type: "text" as const, text: JSON.stringify({ code, message, ...details }) }] });

async function privateContext(deps: McpDependencies, scope: PrivateScope) {
  const context = await deps.authContext();
  if (!context || !context.scopes.includes(scope)) return null;
  return context;
}

function publicFixture(fixture: FootballFixture) {
  return { fixtureId: fixture.fixtureId, competition: fixture.competitionCode, homeTeam: fixture.homeTeam.name, awayTeam: fixture.awayTeam.name, kickoffUtc: fixture.kickoffUtc, providerStatus: fixture.providerStatus, eligibility: fixture.eligibility, provider: fixture.provider, retrievedAtUtc: fixture.retrievedAtUtc };
}

export function createStakeMateMcpServer(deps: McpDependencies) {
  const server = new McpServer({ name: "stakemate", version: "0.1.0" }, { instructions: "StakeMate tools are read-only or preview-only. Never claim an invitation was sent, never sign, fund, settle, or write Walrus Memory." });

  registerStakeMatePublicTools(server, deps);

  server.registerTool("stakemate_prepare_duel", {
    title: "Prepare a safe football duel preview",
    description: "Authenticated preview only. Natural-language context is accepted for display, but explicit structured fixture ID and outcomes are mandatory to prevent ambiguity. This never creates an invitation.",
    inputSchema: z.object({
      naturalLanguageRequest: z.string().trim().min(5).max(240).optional(),
      recipientUsername: username,
      competition,
      fixtureId: z.string().regex(/^\d+$/).max(24),
      challengerSelection: selection,
      opponentSelection: selection,
      stakeSui: z.string().trim().max(32),
      invitationLifetimeMinutes: z.union([z.literal(10), z.literal(15)]),
    }),
  }, async (input) => {
    const context = await privateContext(deps, "duels:prepare");
    if (!context) return error("AUTHENTICATION_REQUIRED", "A verified, unexpired StakeMate wallet context is required to prepare a private duel.");
    if (input.challengerSelection === input.opponentSelection) return error("AMBIGUOUS_OUTCOMES", "Challenger and opponent must choose different explicit 1X2 outcomes.");
    try {
      const store = deps.store();
      const [challenger, opponent, fixture] = await Promise.all([
        store.profileForWallet(context.walletAddress),
        store.profileForUsername(input.recipientUsername.replace(/^@/, "")),
        deps.football().timedFixture(input.competition, input.fixtureId),
      ]);
      if (!challenger) return error("PROFILE_REQUIRED", "The authenticated wallet has no registered StakeMate username.");
      if (!opponent) return error("USERNAME_NOT_FOUND", "The recipient must be a registered StakeMate username.");
      const terms = buildDuelDraftTerms({ fixture, creator: challenger, opponent, creatorSelection: input.challengerSelection, opponentSelection: input.opponentSelection, stakeSui: input.stakeSui, invitationLifetimeMinutes: input.invitationLifetimeMinutes, createdAt: new Date() });
      return text({ previewOnly: true, invitationCreated: false, naturalLanguageRequest: input.naturalLanguageRequest ?? null, challenger: `@${terms.creator.username}`, opponent: `@${terms.opponent.username}`, match: publicFixture(fixture), selections: { challenger: oneXTwoLabel(terms.creatorSelection), opponent: oneXTwoLabel(terms.opponentSelection), drawRefundOutcome: oneXTwoLabel(terms.unselectedOutcome) }, proposedStake: { suiEach: input.stakeSui, mistEach: terms.stakeMist }, expiryUtc: terms.invitationExpiresAtUtc, drawRefundRule: "If the unselected outcome occurs (including a full-time draw for opposing home/away selections), each participant receives 100% of original escrow principal; network gas is separate.", termsHash: hashDuelDraftTerms(terms) });
    } catch { return error("DUEL_PREPARATION_REJECTED", "The fixture, stake, outcomes, or identities are not eligible. Refresh verified fixtures and provide explicit values."); }
  });

  server.registerTool("stakemate_read_my_credibility", {
    title: "Read my credibility memories",
    description: "Authenticated wallet-owner-only read of validated Walrus Memory records and their provenance. It never invents a score.",
    inputSchema: z.object({}),
  }, async () => {
    const context = await privateContext(deps, "credibility:read");
    if (!context) return error("AUTHENTICATION_REQUIRED", "A verified, unexpired StakeMate wallet context is required.");
    try {
      const profile = await deps.store().profileForWallet(context.walletAddress);
      if (!profile) return error("PROFILE_REQUIRED", "The authenticated wallet has no registered StakeMate username.");
      const recalled = await deps.recallCredibility(context.walletAddress, profile.username) as { records: unknown[]; provenance: unknown };
      const recommendation = recommendFromCredibilityMemories(context.walletAddress, recalled.records);
      return text({ username: profile.username, recommendation, provenance: recalled.provenance });
    } catch { return error("CREDIBILITY_UNAVAILABLE", "Validated Walrus Memory credibility records are unavailable."); }
  });

  server.registerTool("stakemate_get_my_invitations", {
    title: "Get my invitation audit summary",
    description: "Authenticated wallet-owner-only read of invitation state. It has no mutation capability.",
    inputSchema: z.object({}),
  }, async () => {
    const context = await privateContext(deps, "invitations:read");
    if (!context) return error("AUTHENTICATION_REQUIRED", "A verified, unexpired StakeMate wallet context is required.");
    try {
      const store = deps.store(); const profile = await store.profileForWallet(context.walletAddress);
      if (!profile) return error("PROFILE_REQUIRED", "The authenticated wallet has no registered StakeMate username.");
      const simplify = (item: Awaited<ReturnType<typeof store.invitationsForCreator>>[number]) => ({ id: item.id, status: item.status, createdAt: item.createdAt, expiresAt: item.expiresAt, respondedAt: item.respondedAt, fundingStatus: item.fundingStatus, termsHash: item.termsHash });
      const [sent, received] = await Promise.all([store.invitationsForCreator(profile.id), store.invitationsForRecipient(profile.id)]);
      return text({ username: profile.username, sent: sent.map(simplify), received: received.map(simplify), readOnly: true });
    } catch { return error("INVITATIONS_UNAVAILABLE", "Invitation audit data is unavailable."); }
  });
  return server;
}

/** The only tools safe to expose before remote OAuth identity is fully reviewed. */
export function createStakeMatePublicMcpServer(deps: Pick<McpDependencies, "store" | "football">) {
  const server = new McpServer({ name: "stakemate", version: "0.1.0" }, { instructions: "StakeMate public tools are read-only. They never authenticate a wallet, create invitations, sign, fund, settle, or write data." });
  registerStakeMatePublicTools(server, deps);
  return server;
}

function registerStakeMatePublicTools(server: McpServer, deps: Pick<McpDependencies, "store" | "football">) {

  server.registerTool("stakemate_resolve_username", {
    title: "Resolve a StakeMate username",
    description: "Read-only public profile lookup. It never returns sessions, credentials, or private profile fields.",
    inputSchema: z.object({ username }),
  }, async ({ username: handle }) => {
    try {
      const profile = await deps.store().profileForUsername(handle.replace(/^@/, ""));
      return profile ? text({ username: profile.username }) : error("USERNAME_NOT_FOUND", "No registered StakeMate username matches this handle.");
    } catch { return error("PROFILE_LOOKUP_UNAVAILABLE", "Public username lookup is unavailable."); }
  });

  server.registerTool("stakemate_get_verified_fixtures", {
    title: "Get verified upcoming fixtures",
    description: "Reads current football-data.org fixtures. SCHEDULED fixtures are display-only; only TIMED future fixtures are eligible for a preview.",
    inputSchema: z.object({ competition: competition.optional(), horizonDays: z.number().int().min(1).max(7).default(7) }),
  }, async ({ competition: requested, horizonDays }) => {
    try {
      const codes = requested ? [requested] : footballCompetitions;
      const results = await Promise.all(codes.map(async (code) => deps.football().upcoming(code, horizonDays)));
      const fixtures = results.flatMap((result) => result.fixtures.map(publicFixture));
      return text({ provider: "football-data.org/v4", fixtures, fixtureWindow: fixtures.length === 0 ? "empty" : "results" });
    } catch (cause) {
      if (cause instanceof ProviderError) return error("FIXTURE_LOOKUP_UNAVAILABLE", "Verified fixture data is unavailable; do not infer a fixture.", {
        providerErrorCategory: cause.code,
        ...(cause.status === undefined ? {} : { providerHttpStatus: cause.status }),
        ...(cause.retryAfterMs === undefined ? {} : { retryAfterSeconds: Math.max(1, Math.ceil(cause.retryAfterMs / 1_000)) }),
      });
      return error("FIXTURE_LOOKUP_UNAVAILABLE", "Verified fixture data is unavailable; do not infer a fixture.", { providerErrorCategory: "UNAVAILABLE" });
    }
  });

}

export function configuredMcpDependencies(): McpDependencies {
  return {
    authContext: async () => {
      const context = await (await import("@/lib/server/mcp-auth-context")).authenticatedMcpContextFromEnvironment();
      if (!context) return null;
      return await (await import("@/lib/server/mcp-authorization")).mcpAuthorizationIsActive(context.authorizationId, context.walletAddress) ? context : null;
    },
    store: getInvitationStore,
    football: getFootballDataClient,
    recallCredibility: async (walletAddress, username) => {
      const recalled = await getWalrusMemoryService().recallValidatedRecords(`StakeMate credibility score for @${username}`, 10);
      return { ...recalled, walletAddress };
    },
  };
}
