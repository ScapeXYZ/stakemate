import { NextResponse } from "next/server";
import { getInvitationStore } from "@/lib/server/invitations";
import { WalletAuthenticationError, verifyAuthenticationSignature } from "@/lib/server/wallet-auth";
import { assertSameOrigin, createSession } from "@/lib/server/session";
import { MaintenanceWriteFreezeError, assertApplicationWritesAllowed } from "@/lib/server/maintenance-write-freeze";

function databaseCode(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "none";
}

/** Development-only diagnostic: no request values, messages, or credentials are logged. */
function logFailure(stage: string, error: unknown) {
  if (process.env.NODE_ENV !== "production") console.warn(`[StakeMate auth] stage=${stage} pg_code=${error instanceof WalletAuthenticationError ? error.databaseCode ?? "none" : databaseCode(error)} signature_category=${error instanceof WalletAuthenticationError ? error.signatureFailure ?? "none" : "none"} signature_scheme=${error instanceof WalletAuthenticationError ? error.signatureScheme ?? "none" : "none"}`);
}

export async function POST(request: Request) {
  let stage = "origin_validation";
  try {
    const origin = assertSameOrigin(request);
    stage = "request_body";
    const body = await request.json() as { walletAddress?: unknown; nonce?: unknown; messageBytes?: unknown; signature?: unknown };
    if (typeof body.walletAddress !== "string" || typeof body.nonce !== "string" || typeof body.messageBytes !== "string" || typeof body.signature !== "string" || !body.walletAddress || !body.nonce || !body.messageBytes || !body.signature) return NextResponse.json({ error: "walletAddress, nonce, messageBytes, and signature are required strings", code: "AUTH_INPUT_INVALID" }, { status: 400 });
    assertApplicationWritesAllowed("authentication_verify_and_session_create");
    stage = "wallet_verification";
    const verified = await verifyAuthenticationSignature(getInvitationStore(), { walletAddress: body.walletAddress, nonce: body.nonce, messageBytes: body.messageBytes, signature: body.signature, origin });
    stage = "session_creation";
    await createSession(verified.walletAddress);
    return NextResponse.json({ walletAddress: verified.walletAddress });
  }
  catch (error) {
    const failureStage = error instanceof WalletAuthenticationError ? error.stage : stage;
    logFailure(failureStage, error);
    const message = error instanceof Error ? error.message : "";
    if (error instanceof MaintenanceWriteFreezeError) return NextResponse.json({ error: "Authentication is temporarily unavailable for maintenance.", code: error.code }, { status: 503 });
    if (message === "DATABASE_NOT_CONFIGURED") return NextResponse.json({ error: "Authentication storage is not configured.", code: "AUTH_STORAGE_UNAVAILABLE" }, { status: 503 });
    if (message === "ORIGIN_NOT_ALLOWED" || message === "PRODUCTION_ORIGIN_NOT_CONFIGURED") return NextResponse.json({ error: "This browser origin is not allowed for authentication.", code: "AUTH_ORIGIN_NOT_ALLOWED" }, { status: 403 });
    if (message === "AUTH_NONCE_INVALID_OR_REPLAYED" || message === "AUTH_NONCE_MESSAGE_MISMATCH") return NextResponse.json({ error: "This sign-in request expired or was already used. Request a new message and sign once.", code: "AUTH_NONCE_INVALID" }, { status: 401 });
    if (error instanceof WalletAuthenticationError && error.signatureFailure === "signed_message_mismatch") return NextResponse.json({ error: "The wallet did not sign the exact authentication message. Request a new message and sign again.", code: "AUTH_SIGNED_MESSAGE_MISMATCH" }, { status: 401 });
    if (error instanceof WalletAuthenticationError && error.signatureFailure === "signer_address_mismatch") return NextResponse.json({ error: "The signing account does not match the connected wallet. Reconnect the intended account and sign again.", code: "AUTH_SIGNER_ADDRESS_MISMATCH" }, { status: 401 });
    if (error instanceof WalletAuthenticationError && error.signatureFailure === "malformed_signature") return NextResponse.json({ error: "The wallet returned an unreadable signature. Update or reconnect the wallet, then try again.", code: "AUTH_SIGNATURE_MALFORMED" }, { status: 401 });
    if (error instanceof WalletAuthenticationError && error.signatureFailure === "unsupported_signature_scheme") return NextResponse.json({ error: "This wallet signature scheme is not supported by the current verifier.", code: "AUTH_SIGNATURE_UNSUPPORTED" }, { status: 401 });
    if (error instanceof WalletAuthenticationError && error.stage === "signature_verification") return NextResponse.json({ error: "The wallet signature did not match the displayed authentication message.", code: "AUTH_SIGNATURE_INVALID" }, { status: 401 });
    if (error instanceof WalletAuthenticationError && (error.stage === "nonce_lookup" || error.stage === "nonce_consumption")) return NextResponse.json({ error: "Authentication storage was unavailable. No session was created.", code: "AUTH_STORAGE_FAILED" }, { status: 503 });
    if (failureStage === "session_creation") return NextResponse.json({ error: "Secure session storage failed. No session was created.", code: "AUTH_SESSION_FAILED" }, { status: 503 });
    return NextResponse.json({ error: "Authentication could not be completed. No session was created.", code: "AUTH_FAILED" }, { status: 503 });
  }
}
