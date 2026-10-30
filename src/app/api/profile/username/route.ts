import { NextResponse } from "next/server";
import { authenticatedWallet, assertSameOrigin } from "@/lib/server/session";
import { getInvitationStore } from "@/lib/server/invitations";
import { MaintenanceWriteFreezeError, assertApplicationWritesAllowed } from "@/lib/server/maintenance-write-freeze";
import { ProfileAuthenticationRequiredError, withAuthenticatedProfileWallet } from "@/lib/server/profile-username-access";

export async function GET(request: Request) {
  try {
    return await withAuthenticatedProfileWallet(await authenticatedWallet(), async (walletAddress) => {
      const store = getInvitationStore();
      const candidate = new URL(request.url).searchParams.get("username");
      if (candidate !== null) {
        const existing = await store.profileForUsername(candidate.replace(/^@/, ""));
        return NextResponse.json({ available: !existing });
      }
      const profile = await store.profileForWallet(walletAddress);
      return NextResponse.json({ walletAddress, profile });
    });
  } catch (error) {
    if (error instanceof ProfileAuthenticationRequiredError) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    return NextResponse.json({ error: "Profile unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return await withAuthenticatedProfileWallet(await authenticatedWallet(), async (walletAddress) => {
      const body = await request.json() as { username?: string };
      if (!body.username) return NextResponse.json({ error: "username is required" }, { status: 400 });
      assertApplicationWritesAllowed("profile_claim_username");
      const profile = await getInvitationStore().claimUsername(walletAddress, body.username, new Date());
      return NextResponse.json({ profile });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to claim username.";
    if (error instanceof ProfileAuthenticationRequiredError) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error instanceof MaintenanceWriteFreezeError) return NextResponse.json({ error: "Profile changes are temporarily unavailable for maintenance.", code: error.code }, { status: 503 });
    if (message === "USERNAME_TAKEN") return NextResponse.json({ error: "Username unavailable.", code: message }, { status: 409 });
    if (message === "USERNAME_ALREADY_CLAIMED") return NextResponse.json({ error: "This wallet already owns a username.", code: message }, { status: 409 });
    return NextResponse.json({ error: "Unable to claim username." }, { status: 400 });
  }
}
