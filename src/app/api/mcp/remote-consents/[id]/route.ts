import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getInvitationStore } from "@/lib/server/invitations";
import { MaintenanceWriteFreezeError, maintenanceWriteFreezeEnabled } from "@/lib/server/maintenance-write-freeze";
import { getRemoteMcpConsentRequestStore } from "@/lib/server/remote-mcp-consent-requests";
import { assertSameOrigin, authenticatedWallet } from "@/lib/server/session";
import { remoteMcpConsentIdentity } from "@/lib/server/remote-mcp-consent-identity";

const csrfCookie = (id: string) => `stakemate_remote_mcp_csrf_${id}`;

async function identity() {
  const session = await authenticatedWallet();
  if (!session) return null;
  const profile = await getInvitationStore().profileForWallet(session.walletAddress);
  return remoteMcpConsentIdentity(session, profile);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const current = await identity(); if (!current) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { id } = await params; const state = new URL(request.url).searchParams.get("state") ?? "";
    const review = await getRemoteMcpConsentRequestStore().review(id, state);
    if (!review) return NextResponse.json({ error: "Consent request is invalid, expired, or already used." }, { status: 404 });
    const token = (await cookies()).get(csrfCookie(id))?.value ?? null;
    return NextResponse.json({ consent: review, csrfToken: token, actionsAvailable: !maintenanceWriteFreezeEnabled() && Boolean(token), walletAuthenticated: true, noTokensIssued: true }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch { return NextResponse.json({ error: "Consent request unavailable." }, { status: 503 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const current = await identity(); if (!current) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { id } = await params; const body = await request.json() as { state?: unknown; csrfToken?: unknown; decision?: unknown };
    const cookie = (await cookies()).get(csrfCookie(id))?.value;
    if (typeof body.state !== "string" || typeof body.csrfToken !== "string" || body.csrfToken !== cookie || (body.decision !== "approved" && body.decision !== "denied")) return NextResponse.json({ error: "Consent decision is invalid." }, { status: 400 });
    const decision = await getRemoteMcpConsentRequestStore().decide({ id, state: body.state, csrfToken: body.csrfToken, decision: body.decision, profileId: current.profile.id, walletAddress: current.session.walletAddress });
    if (!decision) return NextResponse.json({ error: "Consent request is invalid, expired, already used, or no longer matches this wallet profile." }, { status: 409 });
    (await cookies()).delete(csrfCookie(id));
    return NextResponse.json({ decision, tokenIssued: false, remoteMcpEnabled: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MaintenanceWriteFreezeError) return NextResponse.json({ error: "Remote MCP consent decisions are unavailable during maintenance. No approval was recorded.", code: error.code }, { status: 423 });
    return NextResponse.json({ error: "Consent decision unavailable." }, { status: 503 });
  }
}
