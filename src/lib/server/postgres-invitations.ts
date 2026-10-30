import postgres from "postgres";
import { randomUUID } from "node:crypto";
import type { AuthNonce, Invitation, InvitationStatus, InvitationStore, Profile, PublicHandleIdentity } from "@/lib/server/invitations";
import { normalizeUsername } from "@/lib/server/invitations";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { assertApplicationWritesAllowed } from "@/lib/server/maintenance-write-freeze";
import { postgresSslForDatabaseUrl } from "@/lib/server/postgres-connection-security";

export type Session = { id: string; tokenHash: string; walletAddress: string; expiresAt: string; revokedAt: string | null; createdAt: string };
const address = (value: string) => normalizeSuiAddress(value).toLowerCase();
const date = (value: Date) => value.toISOString();
const profile = (row: Record<string, unknown>): Profile => ({ id: String(row.id), walletAddress: String(row.wallet_address), username: String(row.username), usernameNormalized: String(row.username_normalized), createdAt: date(row.created_at as Date), updatedAt: date(row.updated_at as Date) });
const publicHandle = (row: Record<string, unknown>): PublicHandleIdentity => ({ username: String(row.username), walletAddress: String(row.wallet_address) });
const nonce = (row: Record<string, unknown>): AuthNonce => ({ nonce: String(row.nonce), walletAddress: String(row.wallet_address), message: String(row.message), expiresAt: date(row.expires_at as Date), usedAt: row.used_at ? date(row.used_at as Date) : null });
const invitation = (row: Record<string, unknown>): Invitation => ({ id: String(row.id), creatorProfileId: String(row.creator_profile_id), recipientProfileId: String(row.recipient_profile_id), status: row.status as InvitationStatus, duelTermsHash: String(row.duel_terms_hash), termsCanonical: String(row.terms_canonical), termsHash: String(row.terms_hash), terms: row.terms_json as Invitation["terms"], fundingStatus: "not_funded", creatorWalletAddress: String(row.creator_wallet_address), recipientWalletAddress: String(row.recipient_wallet_address), acceptedWalletAddress: row.accepted_wallet_address ? String(row.accepted_wallet_address) : null, createdAt: date(row.created_at as Date), expiresAt: date(row.expires_at as Date), respondedAt: row.responded_at ? date(row.responded_at as Date) : null, fundingDeadlineAt: row.funding_deadline_at ? date(row.funding_deadline_at as Date) : null, cancelledAt: row.cancelled_at ? date(row.cancelled_at as Date) : null });

/** Uses simple queries only: Supabase transaction pooler must not retain prepared statements. */
export class PostgresInvitationStore implements InvitationStore {
  private sql: postgres.Sql;
  constructor(databaseUrl: string) { this.sql = postgres(databaseUrl, { prepare: false, max: 1, ssl: postgresSslForDatabaseUrl(databaseUrl), idle_timeout: 20, connect_timeout: 10 }); }
  async close() { await this.sql.end({ timeout: 5 }); }
  async connectionTest() { await this.sql`select 1 as ok`; }
  async serverNow() { const [row] = await this.sql`select clock_timestamp() as now`; return date(row.now as Date); }
  /** Read-only RLS/privilege probe. It intentionally returns no application data. */
  async accessTest() { await this.sql`select 1 from stakemate_profiles limit 1`; await this.sql`select 1 from stakemate_auth_nonces limit 1`; await this.sql`select 1 from stakemate_sessions limit 1`; await this.sql`select 1 from stakemate_invitations limit 1`; }
  /** Bounded maintenance for only expired StakeMate authentication records. */
  async cleanupExpired(now = new Date(), limit = 100) { assertApplicationWritesAllowed("authentication_cleanup"); const bounded = Math.min(Math.max(Math.trunc(limit), 1), 100); const timestamp = now.toISOString(); const nonces = await this.sql`with targets as (select ctid from stakemate_auth_nonces where expires_at <= ${timestamp} order by expires_at limit ${bounded}) delete from stakemate_auth_nonces where ctid in (select ctid from targets)`; const sessions = await this.sql`with targets as (select ctid from stakemate_sessions where expires_at <= ${timestamp} order by expires_at limit ${bounded}) delete from stakemate_sessions where ctid in (select ctid from targets)`; return { nonces: nonces.count, sessions: sessions.count }; }
  async createNonce(value: AuthNonce) { assertApplicationWritesAllowed("authentication_nonce_create"); await this.sql`insert into stakemate_auth_nonces (nonce, wallet_address, message, expires_at, used_at) values (${value.nonce}, ${address(value.walletAddress)}, ${value.message}, ${value.expiresAt}, null)`; }
  async nonceByValue(value: string) { const [row] = await this.sql`select nonce, wallet_address, message, expires_at, used_at from stakemate_auth_nonces where nonce = ${value}`; return row ? nonce(row) : null; }
  async consumeNonce(value: string, walletAddress: string, now: Date) { assertApplicationWritesAllowed("authentication_nonce_consume"); const [row] = await this.sql`update stakemate_auth_nonces set used_at = ${now.toISOString()} where nonce = ${value} and wallet_address = ${address(walletAddress)} and used_at is null and expires_at > ${now.toISOString()} returning nonce, wallet_address, message, expires_at, used_at`; return row ? nonce(row) : null; }
  /** A handle is a permanent wallet binding. There is deliberately no rename path. */
  async claimUsername(walletAddress: string, username: string, now: Date) { assertApplicationWritesAllowed("profile_claim_username");
    const wallet = address(walletAddress); const display = username.trim().normalize("NFC"); const normalized = normalizeUsername(display); const timestamp = now.toISOString();
    try {
      const [row] = await this.sql`insert into stakemate_profiles (id, wallet_address, username, username_normalized, created_at, updated_at) values (${randomUUID()}, ${wallet}, ${display}, ${normalized}, ${timestamp}, ${timestamp}) on conflict (wallet_address) do nothing returning id, wallet_address, username, username_normalized, created_at, updated_at`;
      if (row) return profile(row);
    } catch (error: unknown) { if ((error as { code?: string }).code === "23505") throw new Error("USERNAME_TAKEN"); throw error; }
    // A wallet conflict can only mean it already owns its immutable profile.
    const existing = await this.profileForWallet(wallet); if (existing) throw new Error("USERNAME_ALREADY_CLAIMED");
    throw new Error("USERNAME_CLAIM_FAILED");
  }
  async profileForWallet(walletAddress: string) { const [row] = await this.sql`select id, wallet_address, username, username_normalized, created_at, updated_at from stakemate_profiles where wallet_address = ${address(walletAddress)}`; return row ? profile(row) : null; }
  async profileForUsername(username: string) { const [row] = await this.sql`select username, wallet_address from stakemate_profiles where username_normalized = ${normalizeUsername(username)}`; return row ? publicHandle(row) : null; }
  /** PostgreSQL clock, rather than a browser/app clock, becomes the persisted creation/expiry authority. */
  /**
   * One INSERT verifies both current profile-wallet bindings and assigns the database clock.
   * This is intentionally not exposed by a route until activation approval.
   */
  async createInvitation(value: Invitation) { assertApplicationWritesAllowed("invitation_create");
    const [row] = await this.sql`with expire_matching as (update stakemate_invitations set status = 'expired' where creator_wallet_address = ${address(value.creatorWalletAddress)} and recipient_wallet_address = ${address(value.recipientWalletAddress)} and duel_terms_hash = ${value.duelTermsHash} and status = 'pending' and expires_at <= clock_timestamp()) insert into stakemate_invitations (id, creator_profile_id, recipient_profile_id, creator_wallet_address, recipient_wallet_address, status, duel_terms_hash, terms_canonical, terms_hash, terms_json, funding_status, outcome_deadline_at, created_at, expires_at, responded_at, accepted_wallet_address, funding_deadline_at, cancelled_at)
      select ${value.id}, creator.id, recipient.id, creator.wallet_address, recipient.wallet_address, 'pending', ${value.duelTermsHash}, ${value.termsCanonical}, ${value.termsHash}, ${this.sql.json(value.terms)}, 'not_funded', ${value.terms.outcomeDeadlineUtc}, clock_timestamp(), clock_timestamp() + (${value.terms.invitationLifetimeMinutes} * interval '1 minute'), null, null, null, null
      from stakemate_profiles creator cross join stakemate_profiles recipient
      where creator.id = ${value.creatorProfileId} and recipient.id = ${value.recipientProfileId} and creator.wallet_address = ${address(value.creatorWalletAddress)} and recipient.wallet_address = ${address(value.recipientWalletAddress)} and creator.id <> recipient.id
      returning *`;
    if (!row) throw new Error("PROFILE_WALLET_BINDING_CHANGED");
    return invitation(row);
  }
  async invitationById(id: string) { const [row] = await this.sql`select * from stakemate_invitations where id = ${id}`; return row ? invitation(row) : null; }
  /** Inbox reads never mutate expiry state; an explicit lifecycle worker owns expiry transitions. */
  async invitationsForRecipient(profileId: string) { const rows = await this.sql`select * from stakemate_invitations where recipient_profile_id = ${profileId} order by created_at desc`; return rows.map(invitation); }
  async invitationsForCreator(profileId: string) { const rows = await this.sql`select * from stakemate_invitations where creator_profile_id = ${profileId} order by created_at desc`; return rows.map(invitation); }
  async transitionInvitation(id: string, actorProfileId: string, actorWalletAddress: string, action: "accept" | "reject" | "cancel", now: Date) { assertApplicationWritesAllowed(`invitation_${action}`);
    void now; const recipientAction = action === "accept" || action === "reject";
    const [row] = recipientAction
      ? action === "accept"
        ? await this.sql`with instant as (select clock_timestamp() as now) update stakemate_invitations set status = 'accepted', responded_at = instant.now, accepted_wallet_address = ${address(actorWalletAddress)}, funding_deadline_at = instant.now + interval '15 minutes' from instant where id = ${id} and recipient_profile_id = ${actorProfileId} and recipient_wallet_address = ${address(actorWalletAddress)} and status = 'pending' and expires_at > instant.now and instant.now + interval '15 minutes' < outcome_deadline_at returning stakemate_invitations.*`
        : await this.sql`with instant as (select clock_timestamp() as now) update stakemate_invitations set status = 'rejected', responded_at = instant.now from instant where id = ${id} and recipient_profile_id = ${actorProfileId} and recipient_wallet_address = ${address(actorWalletAddress)} and status = 'pending' and expires_at > instant.now returning stakemate_invitations.*`
      : await this.sql`with instant as (select clock_timestamp() as now) update stakemate_invitations set status = 'cancelled', cancelled_at = instant.now from instant where id = ${id} and creator_profile_id = ${actorProfileId} and creator_wallet_address = ${address(actorWalletAddress)} and status = 'pending' and expires_at > instant.now returning stakemate_invitations.*`;
    if (row) return invitation(row);
    const [expired] = await this.sql`update stakemate_invitations set status = 'expired' where id = ${id} and status = 'pending' and expires_at <= clock_timestamp() returning id`;
    if (expired) throw new Error("INVITATION_NOT_PENDING");
    const existing = await this.invitationById(id); if (!existing) throw new Error("INVITATION_NOT_FOUND"); throw new Error(existing.status === "pending" ? "UNAUTHORIZED_INVITATION_ACTION" : "INVITATION_NOT_PENDING");
  }
  async createSession(value: Session) { assertApplicationWritesAllowed("session_create"); await this.sql`insert into stakemate_sessions (id, token_hash, wallet_address, expires_at, revoked_at, created_at) values (${value.id}, ${value.tokenHash}, ${address(value.walletAddress)}, ${value.expiresAt}, null, ${value.createdAt})`; }
  async sessionByTokenHash(tokenHash: string, now: Date) { const [row] = await this.sql`select id, token_hash, wallet_address, expires_at, revoked_at, created_at from stakemate_sessions where token_hash = ${tokenHash} and revoked_at is null and expires_at > ${now.toISOString()}`; return row ? { id: String(row.id), tokenHash: String(row.token_hash), walletAddress: String(row.wallet_address), expiresAt: date(row.expires_at as Date), revokedAt: row.revoked_at ? date(row.revoked_at as Date) : null, createdAt: date(row.created_at as Date) } satisfies Session : null; }
  async revokeSession(tokenHash: string, now: Date) { assertApplicationWritesAllowed("session_revoke"); await this.sql`update stakemate_sessions set revoked_at = ${now.toISOString()} where token_hash = ${tokenHash} and revoked_at is null`; }
}

let singleton: PostgresInvitationStore | undefined;
export function getPostgresInvitationStore() { const url = process.env.DATABASE_URL; if (!url?.trim()) throw new Error("DATABASE_NOT_CONFIGURED"); singleton ??= new PostgresInvitationStore(url); return singleton; }
