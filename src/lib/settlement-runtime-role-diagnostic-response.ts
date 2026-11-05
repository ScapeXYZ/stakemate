export type SettlementRuntimeRoleDiagnostic = {
  currentDatabase: string;
  currentUser: string;
  sessionUser: string;
  bypassRls: boolean;
  ownsPublicSchema: boolean;
  canCreatePublicSchema: boolean;
  migrationRoleMembership: boolean | null;
};

/** Pure response boundary: authentication is checked before the server-only database loader runs. */
export async function settlementRuntimeRoleDiagnosticResponse(
  request: Request,
  secret: string | undefined,
  load: () => Promise<SettlementRuntimeRoleDiagnostic>,
) {
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ code: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    return Response.json(await load(), { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ code: "SETTLEMENT_RUNTIME_ROLE_DIAGNOSTIC_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
