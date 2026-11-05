import "server-only";

import { NextResponse } from "next/server";
import { runSettlementCron } from "@/lib/server/settlement-cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vercel invokes this only with CRON_SECRET. Response contains operational counts, never evidence or credentials. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const result = await runSettlementCron();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Settlement cron failed", {
      errorType: error instanceof Error ? error.name : "UNKNOWN",
      code: error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN",
    });
    const code = error instanceof Error && /^SETTLEMENT_[A-Z_]+$/u.test(error.message) ? error.message : "SETTLEMENT_CRON_FAILED";
    return NextResponse.json({ ok: false, code }, { status: 503 });
  }
}
