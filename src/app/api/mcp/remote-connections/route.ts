import { NextResponse } from "next/server";
import { getInvitationStore } from "@/lib/server/invitations";
import { MaintenanceWriteFreezeError, maintenanceWriteFreezeEnabled } from "@/lib/server/maintenance-write-freeze";
import { getRemoteMcpConsentRequestStore } from "@/lib/server/remote-mcp-consent-requests";
import { assertSameOrigin, authenticatedWallet } from "@/lib/server/session";
import { remoteMcpConsentIdentity } from "@/lib/server/remote-mcp-consent-identity";

async function identity() {
  const session = await authenticatedWallet();
  if (!session) return null;
  const profile = await getInvitationStore().profileForWallet(session.walletAddress);
  return remoteMcpConsentIdentity(session, profile);
}

export async function GET() {
  try { const current = await identity(); if (!current) return NextResponse.json({ error: "Authentication required" }, { status: 401 }); return NextResponse.json({ connections: await getRemoteMcpConsentRequestStore().connections(current.profile.id, current.session.walletAddress), remoteMcpEnabled: false, revocationAvailable: !maintenanceWriteFreezeEnabled() }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Remote MCP connections unavailable." }, { status: 503 }); }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request); const current = await identity(); if (!current) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const body = await request.json() as { authorizationId?: unknown }; if (typeof body.authorizationId !== "string") return NextResponse.json({ error: "Connection identifier is required." }, { status: 400 });
    const revoked = await getRemoteMcpConsentRequestStore().revokeConnection(body.authorizationId, current.profile.id, current.session.walletAddress);
    if (!revoked) return NextResponse.json({ error: "Connection not found or already revoked." }, { status: 404 });
    return NextResponse.json({ revoked: true, remoteMcpEnabled: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { if (error instanceof MaintenanceWriteFreezeError) return NextResponse.json({ error: "Remote MCP revocation is unavailable during maintenance.", code: error.code }, { status: 423 }); return NextResponse.json({ error: "Remote MCP revocation unavailable." }, { status: 503 }); }
}
