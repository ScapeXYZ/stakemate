import { NextResponse } from "next/server";
import { getInvitationStore } from "@/lib/server/invitations";
import { createAuthenticationNonce } from "@/lib/server/wallet-auth";
import { assertSameOrigin } from "@/lib/server/session";
import { MaintenanceWriteFreezeError, assertApplicationWritesAllowed } from "@/lib/server/maintenance-write-freeze";

export async function POST(request: Request) {
  try { const origin = assertSameOrigin(request); const body = await request.json() as { walletAddress?: string }; if (!body.walletAddress) return NextResponse.json({ error: "walletAddress is required", code: "AUTH_INPUT_INVALID" }, { status: 400 }); assertApplicationWritesAllowed("authentication_nonce_create"); const item = await createAuthenticationNonce(getInvitationStore(), body.walletAddress, origin); return NextResponse.json({ nonce: item.nonce, message: item.message, expiresAt: item.expiresAt }); }
  catch (error) { const message = error instanceof Error ? error.message : ""; if (error instanceof MaintenanceWriteFreezeError) return NextResponse.json({ error: "Authentication is temporarily unavailable for maintenance.", code: error.code }, { status: 503 }); if (message === "ORIGIN_NOT_ALLOWED" || message === "PRODUCTION_ORIGIN_NOT_CONFIGURED") return NextResponse.json({ error: "This browser origin is not allowed for authentication.", code: "AUTH_ORIGIN_NOT_ALLOWED" }, { status: 403 }); return NextResponse.json({ error: message === "DATABASE_NOT_CONFIGURED" ? "Authentication storage is not configured." : "Unable to create authentication challenge.", code: message === "DATABASE_NOT_CONFIGURED" ? "AUTH_STORAGE_UNAVAILABLE" : "AUTH_CHALLENGE_FAILED" }, { status: message === "DATABASE_NOT_CONFIGURED" ? 503 : 400 }); }
}
