import "server-only";

import { NextResponse } from "next/server";
import { settlementOperationalStatus } from "@/lib/server/settlement-operational-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Authenticated, read-only settlement readiness. No IDs, errors, evidence, or credentials are returned. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const status = await settlementOperationalStatus();
    return NextResponse.json(status, { status: status.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, code: "SETTLEMENT_STATUS_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
