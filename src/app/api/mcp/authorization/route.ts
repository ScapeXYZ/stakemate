import { NextResponse } from "next/server";
import { authenticatedWallet, assertSameOrigin } from "@/lib/server/session";
import { getInvitationStore } from "@/lib/server/invitations";
import { McpAuthorizationError, createMcpPairing, mcpAuthorizationStatusForSession, revokeMcpAuthorizationsForSession } from "@/lib/server/mcp-authorization";

async function authenticatedProfile() {
  const session = await authenticatedWallet();
  if (!session) return null;
  const profile = await getInvitationStore().profileForWallet(session.walletAddress);
  return profile ? { session, profile } : null;
}

function failure(error: unknown) {
  if (error instanceof McpAuthorizationError && error.code === "MCP_BROKER_ISOLATED_PILOT_REQUIRED") return NextResponse.json({ error: "AI Agent pairing is available only in the isolated local pilot.", code: error.code }, { status: 423 });
  return NextResponse.json({ error: "AI Agent authorization is unavailable." }, { status: 503 });
}

export async function GET() {
  try {
    const identity = await authenticatedProfile();
    if (!identity) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    return NextResponse.json({ ...(await mcpAuthorizationStatusForSession(identity.session)), username: identity.profile.username }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const identity = await authenticatedProfile();
    if (!identity) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const pairing = await createMcpPairing(identity.session, identity.profile);
    return NextResponse.json({ pairingCode: pairing.pairingCode, expiresAt: pairing.expiresAt, username: pairing.username, scopes: ["duels:prepare", "credibility:read", "invitations:read"], previewOnly: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request); const identity = await authenticatedProfile();
    if (!identity) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    await revokeMcpAuthorizationsForSession(identity.session);
    return NextResponse.json({ revoked: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
