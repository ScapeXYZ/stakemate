import "server-only";

import { settlementRuntimeRoleDiagnosticResponse } from "@/lib/settlement-runtime-role-diagnostic-response";
import { settlementRuntimeRoleDiagnostic } from "@/lib/server/settlement-runtime-role-diagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Authenticated, SELECT-only database identity diagnostics for settlement migration planning. */
export async function GET(request: Request) {
  return settlementRuntimeRoleDiagnosticResponse(request, process.env.CRON_SECRET, settlementRuntimeRoleDiagnostic);
}
