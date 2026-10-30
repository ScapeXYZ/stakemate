import { NextResponse } from "next/server";
import { coreFromDraft } from "@/lib/football-duel-terms";
import { prepareVerifiedDuelDraft, type DraftInput } from "@/app/api/duels/draft/route";
import { getCanonicalInvitationPersistenceAdapter } from "@/lib/server/canonical-invitation-persistence";
import { assertInvitationLifecycleEnabled } from "@/lib/server/invitation-lifecycle-gate";
import { outcomeDeadlineForCore } from "@/lib/server/invitation-policy";
import { authenticatedWallet, assertSameOrigin } from "@/lib/server/session";

export const runtime = "nodejs";

/** Explicitly invoked only after review; locked unless both server-side lifecycle gates are exact true. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); assertInvitationLifecycleEnabled();
    const session = await authenticatedWallet(); if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const body = await request.json() as { idempotencyKey?: unknown; [key: string]: unknown };
    if (typeof body.idempotencyKey !== "string") return NextResponse.json({ error: "Invitation creation requires an idempotency key.", code: "INVITATION_INPUT_INVALID" }, { status: 400 });
    const { terms } = await prepareVerifiedDuelDraft(session.walletAddress, body as DraftInput);
    const core = coreFromDraft(terms);
    const invitation = await getCanonicalInvitationPersistenceAdapter().create({ authenticatedCreatorWallet: session.walletAddress, recipientWalletAddress: core.opponentAddress, core, outcomeDeadlineUtc: outcomeDeadlineForCore(core), idempotencyKey: body.idempotencyKey });
    return NextResponse.json({ invitation, acknowledgementOnly: true, fundingApproved: false }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVITATION_CREATE_FAILED";
    if (code === "INVITATION_LIFECYCLE_DISABLED") return NextResponse.json({ error: "Invitation lifecycle activation is not approved.", code }, { status: 423 });
    const status = code === "Application writes are temporarily unavailable for database maintenance." ? 423 : code === "PROFILE_REQUIRED" ? 403 : code === "OPPONENT_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: code, code }, { status });
  }
}
