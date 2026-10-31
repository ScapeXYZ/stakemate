import { NextResponse } from "next/server";
import { workosProtectedResourceMetadata } from "@/lib/server/workos-connect";

const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/**
 * Discovery only: this does not enable the MCP transport or issue/accept a token.
 * Keeping it separate lets a staging issuer be validated without weakening the
 * production MCP kill switch.
 */
export function GET() {
  const metadata = workosProtectedResourceMetadata(process.env.STAKEMATE_WORKOS_CONNECT_ISSUER);
  if (!metadata) return NextResponse.json({ error: "WorkOS Connect metadata is not configured." }, { status: 404, headers });
  return NextResponse.json(metadata, { headers });
}
