import { NextResponse } from "next/server";
import { getCanonicalInvitationPersistenceAdapter } from "@/lib/server/canonical-invitation-persistence";
import { assertInvitationLifecycleEnabled } from "@/lib/server/invitation-lifecycle-gate";
import { authenticatedWallet } from "@/lib/server/session";
import { getInvitationStore } from "@/lib/server/invitations";

/** Read-only, party-scoped commitment evidence. It cannot fund, sign, or settle. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertInvitationLifecycleEnabled(); const session = await authenticatedWallet();
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { id } = await params; const invitation = await getCanonicalInvitationPersistenceAdapter().invitationForWallet(id, session.walletAddress);
    if (!invitation) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    const profiles = getInvitationStore(); const [creator, recipient] = await Promise.all([profiles.profileForWallet(invitation.creatorWalletAddress), profiles.profileForWallet(invitation.recipientWalletAddress)]);
    if (!creator || !recipient) throw new Error("INVITATION_PROFILE_SNAPSHOT_MISSING");
    return NextResponse.json({ invitation, participants: { creatorUsername: creator.username, recipientUsername: recipient.username }, readOnly: true, fundingApproved: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { const code = error instanceof Error ? error.message : "INVITATION_AUDIT_UNAVAILABLE"; return NextResponse.json({ error: code, code }, { status: code === "INVITATION_LIFECYCLE_DISABLED" ? 423 : 503 }); }
}
