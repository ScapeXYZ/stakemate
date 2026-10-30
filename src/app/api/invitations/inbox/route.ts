import { NextResponse } from "next/server";
import { getCanonicalInvitationPersistenceAdapter } from "@/lib/server/canonical-invitation-persistence";
import { assertInvitationLifecycleEnabled } from "@/lib/server/invitation-lifecycle-gate";
import { authenticatedWallet } from "@/lib/server/session";
import { getInvitationStore } from "@/lib/server/invitations";

export async function GET() {
  try { const session = await authenticatedWallet(); if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    assertInvitationLifecycleEnabled(); const inbox = await getCanonicalInvitationPersistenceAdapter().inbox(session.walletAddress); const profiles = getInvitationStore();
    const present = async (item: typeof inbox.received[number]) => {
      const [creator, recipient] = await Promise.all([profiles.profileForWallet(item.creatorWalletAddress), profiles.profileForWallet(item.recipientWalletAddress)]);
      // A canonical invitation is valid only between immutable registered profiles.
      if (!creator || !recipient) throw new Error("INVITATION_PROFILE_SNAPSHOT_MISSING");
      return { id: item.id, status: item.status, fundingStatus: "not_funded" as const, expiresAt: item.invitationExpiresAtUtc, fundingDeadlineAt: item.fundingDeadlineAtUtc, creatorUsername: creator.username, recipientUsername: recipient.username, fixture: { competitionName: item.core.competitionName, homeTeam: item.core.homeTeam, awayTeam: item.core.awayTeam, kickoffUtc: item.core.kickoffUtc }, creatorSelection: item.core.creatorSelection, opponentSelection: item.core.opponentSelection, stakeMist: item.core.stakeMist };
    };
    return NextResponse.json({ received: await Promise.all(inbox.received.map(present)), sent: await Promise.all(inbox.sent.map(present)), profileRequired: false, serverNow: inbox.serverNow }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Invitation inbox unavailable." }, { status: 503 }); }
}
