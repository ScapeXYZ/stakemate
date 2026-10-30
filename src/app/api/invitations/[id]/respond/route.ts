import { NextResponse } from "next/server";
import { getCanonicalInvitationPersistenceAdapter } from "@/lib/server/canonical-invitation-persistence";
import { assertInvitationLifecycleEnabled } from "@/lib/server/invitation-lifecycle-gate";
import { acceptedOutcomeAuthority } from "@/lib/server/invitation-policy";
import { revalidateCanonicalFixture } from "@/lib/server/canonical-fixture-revalidation";
import { authenticatedWallet, assertSameOrigin } from "@/lib/server/session";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); assertInvitationLifecycleEnabled(); const session = await authenticatedWallet(); if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { id } = await params; const body = await request.json() as { action?: unknown; idempotencyKey?: unknown };
    if ((body.action !== "accept" && body.action !== "reject" && body.action !== "cancel") || typeof body.idempotencyKey !== "string") return NextResponse.json({ error: "Invitation action is invalid.", code: "INVITATION_INPUT_INVALID" }, { status: 400 });
    const adapter = getCanonicalInvitationPersistenceAdapter();
    // A recipient acknowledgement is refused if the exact committed fixture,
    // teams, or kickoff no longer match the provider's current TIMED fixture.
    if (body.action === "accept") { const current = await adapter.invitationForWallet(id, session.walletAddress); if (!current) throw new Error("INVITATION_NOT_FOUND"); await revalidateCanonicalFixture(current.core); }
    const invitation = await adapter.respond({ invitationId: id, authenticatedWallet: session.walletAddress, action: body.action, idempotencyKey: body.idempotencyKey, ...(body.action === "accept" ? { outcomeAuthority: acceptedOutcomeAuthority() } : {}) });
    return NextResponse.json({ invitation, acknowledgementOnly: true, fundingApproved: false }, { headers: { "Cache-Control": "no-store" } });
  }
  catch (error) { const message = error instanceof Error ? error.message : "Invitation action failed"; const status = message === "INVITATION_LIFECYCLE_DISABLED" || message === "Application writes are temporarily unavailable for database maintenance." ? 423 : message === "UNAUTHORIZED_INVITATION_ACTION" ? 403 : message === "INVITATION_NOT_FOUND" ? 404 : message === "INVITATION_NOT_PENDING" || message === "INVITATION_EXPIRED" ? 409 : 400; return NextResponse.json({ error: message }, { status }); }
}
