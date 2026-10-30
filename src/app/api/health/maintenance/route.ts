import "server-only";
import { NextResponse } from "next/server";
import { maintenanceWriteFreezeStatus } from "@/lib/server/maintenance-write-freeze";

/** Public-safe deployment signal. It performs no database or provider operation. */
export async function GET() {
  return NextResponse.json(maintenanceWriteFreezeStatus(), { headers: { "Cache-Control": "no-store" } });
}
