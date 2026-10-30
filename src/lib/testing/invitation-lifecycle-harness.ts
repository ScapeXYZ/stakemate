/**
 * TEST-ONLY invitation lifecycle harness. It has no network client, no production
 * store, and no route import; synthetic fixtures exist only in this instance.
 */
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { createInvitationRecord, MemoryInvitationStore, type Invitation, type InvitationTerms, type Profile } from "@/lib/server/invitations";
import { validateUpcomingFixture, type VerifiedFixture } from "@/lib/outcome-verification";

const address = (value: string) => normalizeSuiAddress(value).toLowerCase();
const fixtureKey = (fixture: VerifiedFixture) => `${fixture.provider}:${fixture.fixtureId}`;

export class SyntheticFixtureRegistry {
  private readonly fixtures = new Map<string, VerifiedFixture>();
  set(fixture: VerifiedFixture) { this.fixtures.set(fixtureKey(fixture), structuredClone(fixture)); }
  revalidate(expected: VerifiedFixture, now: Date) {
    const current = this.fixtures.get(fixtureKey(expected));
    if (!current) throw new Error("FIXTURE_NOT_REVALIDATED");
    const invalid = validateUpcomingFixture(current, now.getTime());
    if (invalid) throw new Error(`FIXTURE_INELIGIBLE: ${invalid}`);
    if (current.scheduledKickoffUtc !== expected.scheduledKickoffUtc || current.status !== expected.status || current.league !== expected.league || current.homeTeam !== expected.homeTeam || current.awayTeam !== expected.awayTeam) throw new Error("FIXTURE_CHANGED");
  }
}

/** Models the future server-side orchestration; it is deliberately unavailable to app routes. */
export class InvitationLifecycleHarness {
  readonly store = new MemoryInvitationStore();
  readonly fixtures = new SyntheticFixtureRegistry();

  async profile(walletAddress: string, username: string, now: Date) { return this.store.claimUsername(walletAddress, username, now); }
  async create(creator: Profile, recipient: Profile, terms: InvitationTerms, duelTermsHash: string, now: Date) {
    if (address(creator.walletAddress) === address(recipient.walletAddress)) throw new Error("SELF_INVITATION");
    this.revalidateTermsFixture(terms, now);
    const record = createInvitationRecord(creator, recipient, terms, duelTermsHash, now);
    return this.store.createInvitation(record);
  }
  async respond(invitationId: string, actor: Profile, authenticatedWalletAddress: string, action: "accept" | "reject" | "cancel", now: Date): Promise<Invitation> {
    if (address(actor.walletAddress) !== address(authenticatedWalletAddress)) throw new Error("AUTHENTICATED_WALLET_CHANGED");
    const record = await this.store.invitationById(invitationId);
    if (!record) throw new Error("INVITATION_NOT_FOUND");
    if (!/^[0-9a-f]{64}$/u.test(record.duelTermsHash)) throw new Error("IMMUTABLE_DUEL_TERMS_MISSING");
    // Reject/cancel need no fixture read; create and accept must always revalidate.
    if (action === "accept") this.revalidateTermsFixture(record.terms, now);
    return this.store.transitionInvitation(invitationId, actor.id, authenticatedWalletAddress, action, now);
  }
  private revalidateTermsFixture(terms: InvitationTerms, now: Date) {
    if (terms.market.kind === "sports") this.fixtures.revalidate(terms.market.fixture, now);
  }
}
