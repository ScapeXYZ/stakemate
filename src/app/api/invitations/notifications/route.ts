import { NextResponse } from "next/server";
import { getCanonicalInvitationPersistenceAdapter } from "@/lib/server/canonical-invitation-persistence";
import { assertInvitationLifecycleEnabled } from "@/lib/server/invitation-lifecycle-gate";
import { notificationStateForRecipient, updateRecipientNotification } from "@/lib/server/invitation-notifications";
import { authenticatedWallet, assertSameOrigin } from "@/lib/server/session";
import { getInvitationStore } from "@/lib/server/invitations";
import { unreadPendingNotificationCount } from "@/lib/invitation-notification-state";

export const runtime = "nodejs";

function responseStatus(error: unknown) {
  const code = error instanceof Error ? error.message : "INVITATION_NOTIFICATIONS_UNAVAILABLE";
  return { code, status: code === "INVITATION_LIFECYCLE_DISABLED" || code === "Application writes are temporarily unavailable for database maintenance." ? 423 : code === "INVITATION_NOTIFICATION_NOT_FOUND" ? 404 : 503 };
}

export async function GET() {
  try {
    assertInvitationLifecycleEnabled();
    const session = await authenticatedWallet(); if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const adapter = getCanonicalInvitationPersistenceAdapter();
    const initialInbox = await adapter.inbox(session.walletAddress);
    // Expiry is the only terminal transition permitted from this read surface;
    // it prevents an out-of-date bell from offering an expired invitation.
    const now = Date.parse(initialInbox.serverNow);
    await Promise.all(initialInbox.received.filter((item) => item.status === "pending" && Date.parse(item.invitationExpiresAtUtc) <= now).map((item) => adapter.expire(item.id)));
    const received = (await adapter.inbox(session.walletAddress)).received;
    const metadata = await notificationStateForRecipient(session.walletAddress, received.map((item) => item.id));
    const profiles = getInvitationStore();
    const notifications = await Promise.all(received.map(async (item) => {
      const [creator, recipient] = await Promise.all([profiles.profileForWallet(item.creatorWalletAddress), profiles.profileForWallet(item.recipientWalletAddress)]);
      if (!creator || !recipient) throw new Error("INVITATION_PROFILE_SNAPSHOT_MISSING");
      const state = metadata.get(item.id);
      return { id: item.id, unread: item.status === "pending" && !state?.readAt && !state?.dismissedAt, dismissed: Boolean(state?.dismissedAt), readAt: state?.readAt ?? null, status: item.status, occurredAt: item.statusChangedAtUtc, challengerUsername: creator.username, recipientUsername: recipient.username, fixture: { competitionName: item.core.competitionName, homeTeam: item.core.homeTeam, awayTeam: item.core.awayTeam, kickoffUtc: item.core.kickoffUtc }, creatorSelection: item.core.creatorSelection, opponentSelection: item.core.opponentSelection, stakeMist: item.core.stakeMist, expiresAt: item.invitationExpiresAtUtc, fundingStatus: "not_funded" as const, drawRule: "If the match finishes level, each participant receives 100% of their original escrow principal. Network gas is separate." };
    }));
    const unreadCount = unreadPendingNotificationCount(notifications.map((item) => ({ id: item.id, status: item.status, recipientWalletAddress: session.walletAddress, readAt: item.unread ? null : "read", dismissedAt: item.dismissed ? "dismissed" : null })), session.walletAddress);
    return NextResponse.json({ notifications, unreadCount }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { const result = responseStatus(error); return NextResponse.json({ error: result.code }, { status: result.status }); }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request); assertInvitationLifecycleEnabled();
    const session = await authenticatedWallet(); if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const body = await request.json() as { invitationId?: unknown; action?: unknown };
    if (typeof body.invitationId !== "string" || (body.action !== "read" && body.action !== "dismiss")) return NextResponse.json({ error: "Notification action is invalid." }, { status: 400 });
    const notification = await updateRecipientNotification(session.walletAddress, body.invitationId, body.action);
    return NextResponse.json({ notification }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { const result = responseStatus(error); return NextResponse.json({ error: result.code }, { status: result.status }); }
}
