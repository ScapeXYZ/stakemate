import { NextResponse } from "next/server";
import { prepareVerifiedDuelDraft, type DraftInput } from "@/lib/server/verified-duel-draft";
import { authenticatedWallet, assertSameOrigin } from "@/lib/server/session";
import { ProviderError, providerRetryHeaders } from "@/lib/server/errors";

export const runtime = "nodejs";
/** Ephemeral preview only: no invitation insert, transaction, signing, or provider-data persistence occurs here. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const session = await authenticatedWallet(); if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const prepared = await prepareVerifiedDuelDraft(session.walletAddress, await request.json() as DraftInput);
    return NextResponse.json({ previewOnly: true, fundable: false, ...prepared }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Draft preview unavailable.";
    if (error instanceof ProviderError) { const status = error.code === "NOT_CONFIGURED" ? 503 : error.code === "RATE_LIMIT" ? 429 : error.code === "TIMEOUT" ? 504 : 502; return NextResponse.json({ error: "Fixture revalidation failed. No draft was created.", code: error.code, ...(error.retryAfterMs ? { retryAfterSeconds: Math.max(1, Math.ceil(error.retryAfterMs / 1_000)) } : {}) }, { status, headers: providerRetryHeaders(error) }); }
    if (message.includes("cannot challenge itself")) return NextResponse.json({ error: "You cannot create a duel draft against your own wallet.", code: "SELF_INVITATION" }, { status: 400 });
    return NextResponse.json({ error: message, code: "DRAFT_INVALID" }, { status: 400 });
  }
}
