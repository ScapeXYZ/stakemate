import postgres from "postgres";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { postgresSslForDatabaseUrl } from "@/lib/server/postgres-connection-security";
import { assertInvitationLifecycleEnabled } from "@/lib/server/invitation-lifecycle-gate";
import { assertApplicationWritesAllowed } from "@/lib/server/maintenance-write-freeze";

const address = (value: string) => normalizeSuiAddress(value).toLowerCase();

export type InvitationNotificationState = { invitationId: string; readAt: string | null; dismissedAt: string | null };

function databaseUrl() {
  assertInvitationLifecycleEnabled();
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_NOT_CONFIGURED");
  return value;
}

function client() {
  const value = databaseUrl();
  return postgres(value, { prepare: false, max: 2, ssl: postgresSslForDatabaseUrl(value), idle_timeout: 10, connect_timeout: 10 });
}

const iso = (value: unknown) => value ? new Date(value as Date).toISOString() : null;

/** Recipient-scoped durable notification metadata. Invitation facts remain read-only. */
export async function notificationStateForRecipient(walletAddress: string, invitationIds: readonly string[]) {
  if (!invitationIds.length) return new Map<string, InvitationNotificationState>();
  const sql = client();
  try {
    const rows = await sql`select invitation_id, read_at, dismissed_at from stakemate_invitation_notifications where recipient_wallet_address = ${address(walletAddress)} and invitation_id = any(${sql.array([...invitationIds], 2950)})`;
    return new Map(rows.map((row) => [String(row.invitation_id), { invitationId: String(row.invitation_id), readAt: iso(row.read_at), dismissedAt: iso(row.dismissed_at) }]));
  } finally { await sql.end({ timeout: 3 }); }
}

export async function updateRecipientNotification(walletAddress: string, invitationId: string, action: "read" | "dismiss") {
  assertApplicationWritesAllowed(`invitation_notification_${action}`);
  const sql = client();
  try {
    const [row] = await sql`update stakemate_invitation_notifications set read_at = coalesce(read_at, clock_timestamp()), dismissed_at = case when ${action} = 'dismiss' then coalesce(dismissed_at, clock_timestamp()) else dismissed_at end, updated_at = clock_timestamp() where invitation_id = ${invitationId} and recipient_wallet_address = ${address(walletAddress)} returning invitation_id, read_at, dismissed_at`;
    if (!row) throw new Error("INVITATION_NOTIFICATION_NOT_FOUND");
    return { invitationId: String(row.invitation_id), readAt: iso(row.read_at), dismissedAt: iso(row.dismissed_at) } satisfies InvitationNotificationState;
  } finally { await sql.end({ timeout: 3 }); }
}
