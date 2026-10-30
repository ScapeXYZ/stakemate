import "server-only";

import { normalizeSuiAddress } from "@mysten/sui/utils";
import { validateUpcomingFixture, type VerifiedFixture } from "@/lib/outcome-verification";
import { createInvitationRecord, type Invitation, type InvitationStore, type InvitationTerms, type Profile } from "@/lib/server/invitations";

const address = (value: string) => normalizeSuiAddress(value).toLowerCase();

/** The activated provider adapter must fetch the exact fixture with no persistence side effect. */
export interface FixtureEligibilityRevalidator { revalidate(expected: VerifiedFixture, now: Date): Promise<VerifiedFixture>; }

/**
 * Future server-authoritative lifecycle boundary. No API route calls this class yet.
 * The caller must pass the server session wallet and a recipient profile resolved by
 * the server, never addresses or terms supplied as authoritative by the browser.
 */
export class InvitationLifecycleService {
  constructor(private readonly store: InvitationStore, private readonly fixtures: FixtureEligibilityRevalidator) {}

  async create(input: { creator: Profile; authenticatedCreatorWallet: string; recipient: Profile; terms: InvitationTerms; duelTermsHash: string; now?: Date }) {
    const now = input.now ?? new Date();
    if (address(input.creator.walletAddress) !== address(input.authenticatedCreatorWallet)) throw new Error("AUTHENTICATED_WALLET_CHANGED");
    if (address(input.creator.walletAddress) === address(input.recipient.walletAddress)) throw new Error("SELF_INVITATION");
    await this.revalidate(input.terms, now);
    // createInvitation performs the final profile-wallet snapshot check inside its INSERT.
    return this.store.createInvitation(createInvitationRecord(input.creator, input.recipient, input.terms, input.duelTermsHash, now));
  }

  async respond(input: { invitationId: string; actor: Profile; authenticatedWallet: string; action: "accept" | "reject" | "cancel"; now?: Date }): Promise<Invitation> {
    const now = input.now ?? new Date();
    if (address(input.actor.walletAddress) !== address(input.authenticatedWallet)) throw new Error("AUTHENTICATED_WALLET_CHANGED");
    const invitation = await this.store.invitationById(input.invitationId);
    if (!invitation) throw new Error("INVITATION_NOT_FOUND");
    if (!/^[0-9a-f]{64}$/u.test(invitation.duelTermsHash)) throw new Error("IMMUTABLE_DUEL_TERMS_MISSING");
    // Acceptance is revalidated before its database compare-and-set. It never signs or funds.
    if (input.action === "accept") await this.revalidate(invitation.terms, now);
    return this.store.transitionInvitation(input.invitationId, input.actor.id, input.authenticatedWallet, input.action, now);
  }

  private async revalidate(terms: InvitationTerms, now: Date) {
    if (terms.market.kind !== "sports") return;
    const current = await this.fixtures.revalidate(terms.market.fixture, now);
    const invalid = validateUpcomingFixture(current, now.getTime());
    if (invalid) throw new Error(`FIXTURE_INELIGIBLE: ${invalid}`);
    const expected = terms.market.fixture;
    if (current.provider !== expected.provider || current.fixtureId !== expected.fixtureId || current.scheduledKickoffUtc !== expected.scheduledKickoffUtc || current.status !== expected.status || current.homeTeam !== expected.homeTeam || current.awayTeam !== expected.awayTeam || current.league !== expected.league) throw new Error("FIXTURE_CHANGED");
  }
}
