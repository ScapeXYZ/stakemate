import { normalizeSuiAddress } from "@mysten/sui/utils";
import type { FootballFixture } from "@/lib/server/football-data";
import type { InvitationLifetimeMinutes, PublicHandleIdentity } from "@/lib/server/invitations";
import { canonicalizeFootballDuelCore, coreFromDraft, hashFootballDuelCore } from "@/lib/football-duel-terms";
import { suiToMist } from "@/lib/sui-mist";

export { suiToMist } from "@/lib/sui-mist";

export const oneXTwoSelections = ["home_win", "draw", "away_win"] as const;
export type OneXTwoSelection = (typeof oneXTwoSelections)[number];
export type DuelDraftTerms = {
  version: "stakemate.football-duel-draft.v1";
  fixture: Pick<FootballFixture, "provider" | "competitionCode" | "competitionName" | "fixtureId" | "kickoffUtc" | "providerStatus" | "retrievedAtUtc"> & { homeTeam: FootballFixture["homeTeam"]; awayTeam: FootballFixture["awayTeam"] };
  market: "1X2";
  creator: PublicHandleIdentity;
  opponent: PublicHandleIdentity;
  creatorSelection: OneXTwoSelection;
  opponentSelection: OneXTwoSelection;
  unselectedOutcome: OneXTwoSelection;
  stakeMist: string;
  totalPotMist: string;
  invitationLifetimeMinutes: InvitationLifetimeMinutes;
  invitationExpiresAtUtc: string;
  fundingDeadlinePolicy: "set only after explicit off-chain acceptance; bounded by Move outcome deadline";
  outcomeRule: "creator wins only if actual 1X2 outcome equals creatorSelection; opponent wins only if it equals opponentSelection; unselectedOutcome voids and refunds both principals";
  voidRule: "full_principal_refund_for_unselected_outcome_or_provider_failure";
  previewOnly: true;
};
export type DraftFixtureReference = { fixtureId: string; kickoffUtc: string; homeTeamId: string; awayTeamId: string; providerStatus: "TIMED" };

const selectionLabel: Record<OneXTwoSelection, string> = { home_win: "Home Win", draw: "Draw", away_win: "Away Win" };
const normalized = (address: string) => normalizeSuiAddress(address).toLowerCase();
export function oneXTwoLabel(value: OneXTwoSelection) { return selectionLabel[value]; }

/** A selection is invalidated rather than silently rewritten when live provider terms change. */
export function assertFixtureUnchanged(reference: DraftFixtureReference, current: FootballFixture) {
  if (reference.fixtureId !== current.fixtureId || reference.kickoffUtc !== current.kickoffUtc || reference.homeTeamId !== current.homeTeam.id || reference.awayTeamId !== current.awayTeam.id || reference.providerStatus !== current.providerStatus) throw new Error("Fixture changed after selection. Refresh fixtures and choose it again.");
}

export function buildDuelDraftTerms(input: { fixture: FootballFixture; creator: PublicHandleIdentity; opponent: PublicHandleIdentity; creatorSelection: OneXTwoSelection; opponentSelection: OneXTwoSelection; stakeSui: string; invitationLifetimeMinutes: InvitationLifetimeMinutes; createdAt: Date }): DuelDraftTerms {
  if (input.fixture.providerStatus !== "TIMED" || input.fixture.eligibility !== "eligible" || Date.parse(input.fixture.kickoffUtc) <= input.createdAt.getTime()) throw new Error("Fixture is not a current eligible TIMED future fixture.");
  // The isolated two-wallet invitation pilot is intentionally head-to-head:
  // one Home Win pick and one Away Win pick. Draw is always the void/refund
  // outcome, never an invitation selection supplied by a browser.
  if (!(["home_win", "away_win"] as const).includes(input.creatorSelection as "home_win" | "away_win") || !(["home_win", "away_win"] as const).includes(input.opponentSelection as "home_win" | "away_win") || input.creatorSelection === input.opponentSelection) throw new Error("Creator and opponent must select opposing Home Win and Away Win outcomes.");
  if (normalized(input.creator.walletAddress) === normalized(input.opponent.walletAddress)) throw new Error("A wallet cannot challenge itself.");
  if (![10, 15].includes(input.invitationLifetimeMinutes)) throw new Error("Invitation lifetime must be 10 or 15 minutes.");
  const stakeMist = suiToMist(input.stakeSui); const unselectedOutcome = oneXTwoSelections.find((item) => item !== input.creatorSelection && item !== input.opponentSelection)!;
  return { version: "stakemate.football-duel-draft.v1", fixture: { provider: input.fixture.provider, competitionCode: input.fixture.competitionCode, competitionName: input.fixture.competitionName, fixtureId: input.fixture.fixtureId, homeTeam: input.fixture.homeTeam, awayTeam: input.fixture.awayTeam, kickoffUtc: input.fixture.kickoffUtc, providerStatus: input.fixture.providerStatus, retrievedAtUtc: input.fixture.retrievedAtUtc }, market: "1X2", creator: { username: input.creator.username, walletAddress: normalized(input.creator.walletAddress) }, opponent: { username: input.opponent.username, walletAddress: normalized(input.opponent.walletAddress) }, creatorSelection: input.creatorSelection, opponentSelection: input.opponentSelection, unselectedOutcome, stakeMist, totalPotMist: (BigInt(stakeMist) * BigInt(2)).toString(), invitationLifetimeMinutes: input.invitationLifetimeMinutes, invitationExpiresAtUtc: new Date(input.createdAt.getTime() + input.invitationLifetimeMinutes * 60_000).toISOString(), fundingDeadlinePolicy: "set only after explicit off-chain acceptance; bounded by Move outcome deadline", outcomeRule: "creator wins only if actual 1X2 outcome equals creatorSelection; opponent wins only if it equals opponentSelection; unselectedOutcome voids and refunds both principals", voidRule: "full_principal_refund_for_unselected_outcome_or_provider_failure", previewOnly: true };
}

/** The preview digest is the fixed v2 core only; exact expiry/funding/outcome deadlines are not known yet. */
export function canonicalizeDuelDraftTerms(terms: DuelDraftTerms) { return canonicalizeFootballDuelCore(coreFromDraft(terms)); }
export function hashDuelDraftTerms(terms: DuelDraftTerms) { return hashFootballDuelCore(coreFromDraft(terms)); }
