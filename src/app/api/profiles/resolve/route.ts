import { NextResponse } from "next/server";
import { authenticatedWallet, assertSameOrigin } from "@/lib/server/session";
import { getInvitationStore } from "@/lib/server/invitations";

/**
 * Handle lookup is intentionally authenticated and returns only the public
 * StakeMate handle plus its linked wallet address. It never returns profile IDs,
 * sessions, timestamps, invitations, or other account information.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!await authenticatedWallet()) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const body = await request.json() as { username?: unknown };
    if (typeof body.username !== "string" || !body.username.trim()) return NextResponse.json({ error: "username is required" }, { status: 400 });
    const identity = await getInvitationStore().profileForUsername(body.username.replace(/^@/, ""));
    if (!identity) return NextResponse.json({ error: "No registered StakeMate handle found." }, { status: 404 });
    return NextResponse.json({ identity });
  } catch {
    return NextResponse.json({ error: "Handle lookup unavailable." }, { status: 503 });
  }
}
