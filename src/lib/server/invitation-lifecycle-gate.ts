/**
 * Separate from canonical persistence: both exact server-side opt-ins are required
 * before a route may mutate invitations. It is intentionally never client-driven.
 */
export function invitationLifecycleEnabled() {
  return process.env.STAKEMATE_INVITATION_LIFECYCLE_ENABLED === "true" && process.env.STAKEMATE_CANONICAL_INVITATIONS_ENABLED === "true";
}

export function assertInvitationLifecycleEnabled() {
  if (!invitationLifecycleEnabled()) throw new Error("INVITATION_LIFECYCLE_DISABLED");
  // This write path is deliberately a pilot capability, never a production
  // feature flag.  Requiring the exact disposable PostgreSQL listener makes a
  // copied feature flag insufficient to activate it against Supabase.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("ISOLATED_PILOT_DATABASE_NOT_LOCAL");
  assertIsolatedPilotDatabaseUrl(databaseUrl);
  if (process.env.STAKEMATE_PUBLIC_ORIGIN !== "http://localhost:3001") throw new Error("ISOLATED_PILOT_ORIGIN_REQUIRED");
}

/** Safe for server rendering: failures mean the pilot controls are not shown. */
export function isolatedInvitationPilotEnabled() {
  try { assertInvitationLifecycleEnabled(); return true; } catch { return false; }
}
import { assertIsolatedPilotDatabaseUrl } from "@/lib/server/postgres-connection-security";
