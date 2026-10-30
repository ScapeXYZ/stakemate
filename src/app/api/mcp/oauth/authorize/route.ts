import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getInvitationStore } from "@/lib/server/invitations";
import { MaintenanceWriteFreezeError, maintenanceWriteFreezeEnabled } from "@/lib/server/maintenance-write-freeze";
import { createLocalAuthorizationConsentPreview, localMcpAuthorizationPreviewEnabled, validateLocalAuthorizationRequest } from "@/lib/server/local-mcp-oauth-authorization";
import { remoteMcpConsentIdentity } from "@/lib/server/remote-mcp-consent-identity";
import { getRemoteMcpConsentRequestStore } from "@/lib/server/remote-mcp-consent-requests";
import { authenticatedWallet } from "@/lib/server/session";

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

async function identity() {
  const session = await authenticatedWallet();
  if (!session) return null;
  const profile = await getInvitationStore().profileForWallet(session.walletAddress);
  return remoteMcpConsentIdentity(session, profile);
}

/**
 * Local development-only authorization handoff. It never redirects to the
 * caller's redirect_uri and never creates a code or token. Its only possible
 * navigation target is this application's authenticated consent page.
 */
export async function GET(request: Request) {
  if (!localMcpAuthorizationPreviewEnabled()) return NextResponse.json({ error: "Local OAuth preview is disabled." }, { status: 404, headers });
  const validated = validateLocalAuthorizationRequest(new URL(request.url).searchParams);
  if (!validated.ok) return NextResponse.json({ error: "Authorization request rejected.", oauthError: validated.error }, { status: 400, headers });
  if (maintenanceWriteFreezeEnabled()) return NextResponse.json({ error: "Local OAuth preview is unavailable while the application write freeze is active. No consent request, approval, code, or token was created." }, { status: 423, headers });
  try {
    const current = await identity();
    if (!current) return NextResponse.json({ error: "Wallet authentication required." }, { status: 401, headers });
    const consent = await createLocalAuthorizationConsentPreview(validated.request, current.profile, getRemoteMcpConsentRequestStore());
    const jar = await cookies();
    jar.set(`stakemate_remote_mcp_csrf_${consent.id}`, consent.csrfToken, { httpOnly: true, secure: false, sameSite: "lax", path: `/api/mcp/remote-consents/${consent.id}`, expires: new Date(consent.expiresAt) });
    const page = new URL(`/mcp/consent/${consent.id}`, request.url); page.searchParams.set("state", consent.state);
    return NextResponse.redirect(page, { status: 303, headers });
  } catch (error) {
    if (error instanceof MaintenanceWriteFreezeError) return NextResponse.json({ error: "Local OAuth preview is unavailable while the application write freeze is active. No consent request, approval, code, or token was created." }, { status: 423, headers });
    return NextResponse.json({ error: "Local OAuth preview unavailable." }, { status: 503, headers });
  }
}
