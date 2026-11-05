import { assertFixtureUnchanged, buildDuelDraftTerms, hashDuelDraftTerms, oneXTwoSelections, type DuelDraftTerms, type OneXTwoSelection } from "@/lib/duel-draft";
import { footballCompetitions, getFootballDataClient, type FootballCompetition } from "@/lib/server/football-data";
import { getInvitationStore, invitationLifetimeMinutes, type InvitationLifetimeMinutes } from "@/lib/server/invitations";

export type DraftInput = { competition?: unknown; fixtureId?: unknown; expectedFixture?: { kickoffUtc?: unknown; homeTeamId?: unknown; awayTeamId?: unknown; providerStatus?: unknown }; creatorSelection?: unknown; opponentSelection?: unknown; opponentHandle?: unknown; stakeSui?: unknown; invitationLifetimeMinutes?: unknown };

/** Revalidates a provider fixture and immutable identities before a client can construct funding terms. */
export async function prepareVerifiedDuelDraft(walletAddress: string, body: DraftInput): Promise<{ terms: DuelDraftTerms; termsHash: string }> {
  if (typeof body.competition !== "string" || !footballCompetitions.includes(body.competition as FootballCompetition) || typeof body.fixtureId !== "string" || typeof body.opponentHandle !== "string" || typeof body.stakeSui !== "string" || !oneXTwoSelections.includes(body.creatorSelection as OneXTwoSelection) || !oneXTwoSelections.includes(body.opponentSelection as OneXTwoSelection)) throw new Error("DRAFT_INPUT_INVALID");
  const lifetime = body.invitationLifetimeMinutes === undefined ? 15 : body.invitationLifetimeMinutes;
  if (typeof lifetime !== "number" || !invitationLifetimeMinutes.includes(lifetime as InvitationLifetimeMinutes)) throw new Error("DRAFT_INPUT_INVALID");
  const store = getInvitationStore(); const creator = await store.profileForWallet(walletAddress); if (!creator) throw new Error("PROFILE_REQUIRED");
  const opponent = await store.profileForUsername(body.opponentHandle.replace(/^@/, "")); if (!opponent) throw new Error("OPPONENT_NOT_FOUND");
  if (!body.expectedFixture || typeof body.expectedFixture.kickoffUtc !== "string" || typeof body.expectedFixture.homeTeamId !== "string" || typeof body.expectedFixture.awayTeamId !== "string" || body.expectedFixture.providerStatus !== "TIMED") throw new Error("DRAFT_INPUT_INVALID");
  const fixture = await getFootballDataClient().timedFixture(body.competition as FootballCompetition, body.fixtureId); assertFixtureUnchanged({ fixtureId: body.fixtureId, kickoffUtc: body.expectedFixture.kickoffUtc, homeTeamId: body.expectedFixture.homeTeamId, awayTeamId: body.expectedFixture.awayTeamId, providerStatus: "TIMED" }, fixture);
  const terms = buildDuelDraftTerms({ fixture, creator: { username: creator.username, walletAddress: creator.walletAddress }, opponent, creatorSelection: body.creatorSelection as OneXTwoSelection, opponentSelection: body.opponentSelection as OneXTwoSelection, stakeSui: body.stakeSui, invitationLifetimeMinutes: lifetime as InvitationLifetimeMinutes, createdAt: new Date() });
  return { terms, termsHash: hashDuelDraftTerms(terms) };
}
