import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { canonicalizeFootballDuelChallenge, canonicalizeFootballDuelCore, hashFootballDuelChallenge, hashFootballDuelCore, type FootballDuelChallengeTerms, type FootballDuelCoreTerms } from "@/lib/football-duel-terms";
import { assertApplicationWritesAllowed } from "@/lib/server/maintenance-write-freeze";
import { postgresSslForDatabaseUrl } from "@/lib/server/postgres-connection-security";
import { assertIsolatedPilotDatabaseUrl } from "@/lib/server/postgres-connection-security";

export type CanonicalInvitation = {
  id: string; status: "pending" | "accepted" | "rejected" | "expired" | "cancelled";
  creatorProfileId: string; recipientProfileId: string; creatorWalletAddress: string; recipientWalletAddress: string;
  core: FootballDuelCoreTerms; coreBytes: string; coreHash: string; invitationExpiresAtUtc: string;
  createdAtUtc: string; statusChangedAtUtc: string;
  outcomeDeadlineUtc: string; acceptedChallenge: FootballDuelChallengeTerms | null; acceptedChallengeBytes: string | null; acceptedChallengeHash: string | null;
  acceptedWalletAddress: string | null; fundingDeadlineAtUtc: string | null;
};
type Action = "create" | "accept" | "reject" | "cancel";
type Row = Record<string, unknown>;
const address = (value: string) => normalizeSuiAddress(value).toLowerCase();
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const iso = (value: string, label: string) => { const time = Date.parse(value); if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error(`${label} must be exact UTC.`); return time; };
const key = (value: string) => { if (!/^[A-Za-z0-9_-]{16,200}$/u.test(value)) throw new Error("INVALID_IDEMPOTENCY_KEY"); return digest(value); };
const databaseNow = (value: unknown) => new Date(value as Date).toISOString();

function coreFromRow(row: Row): FootballDuelCoreTerms {
  return { version: "stakemate.football-1x2-duel.v2", provider: String(row.fixture_provider), competitionCode: String(row.competition_code) as FootballDuelCoreTerms["competitionCode"], competitionName: String((row.terms_json as { competitionName?: string } | null)?.competitionName ?? "Persisted competition"), fixtureId: String(row.fixture_id), homeTeamId: String((row.terms_json as { homeTeamId?: string } | null)?.homeTeamId ?? "persisted-home"), homeTeam: String((row.terms_json as { homeTeam?: string } | null)?.homeTeam ?? "Persisted home"), awayTeamId: String((row.terms_json as { awayTeamId?: string } | null)?.awayTeamId ?? "persisted-away"), awayTeam: String((row.terms_json as { awayTeam?: string } | null)?.awayTeam ?? "Persisted away"), kickoffUtc: databaseNow(row.kickoff_at), creatorAddress: String(row.creator_wallet_address), opponentAddress: String(row.recipient_wallet_address), creatorSelection: String(row.creator_selection) as FootballDuelCoreTerms["creatorSelection"], opponentSelection: String(row.opponent_selection) as FootballDuelCoreTerms["opponentSelection"], unselectedOutcome: String(row.unselected_outcome) as FootballDuelCoreTerms["unselectedOutcome"], stakeMist: String(row.stake_mist), invitationLifetimeMinutes: Math.round((new Date(row.expires_at as Date).getTime() - new Date(row.created_at as Date).getTime()) / 60_000) as 10 | 15, voidRule: "full_principal_refund_for_unselected_outcome_or_provider_failure" };
}
function record(row: Row): CanonicalInvitation {
  const core = coreFromRow(row); const coreBytes = String(row.canonical_core_bytes); const coreHash = String(row.canonical_core_hash);
  if (canonicalizeFootballDuelCore(core) !== coreBytes || hashFootballDuelCore(core) !== coreHash) throw new Error("PERSISTED_CORE_MISMATCH");
  const accepted = row.accepted_challenge_hash ? { ...core, invitationExpiresAtUtc: databaseNow(row.expires_at), fundingDeadlineUtc: databaseNow(row.funding_deadline_at), outcomeDeadlineUtc: databaseNow(row.outcome_deadline_at), outcomeAuthority: String(row.accepted_outcome_authority) } satisfies FootballDuelChallengeTerms : null;
  if (accepted && (canonicalizeFootballDuelChallenge(accepted) !== String(row.accepted_challenge_bytes) || hashFootballDuelChallenge(accepted) !== String(row.accepted_challenge_hash))) throw new Error("PERSISTED_CHALLENGE_MISMATCH");
  const status = row.status as CanonicalInvitation["status"];
  const changedAt = status === "accepted" || status === "rejected" ? row.responded_at : status === "cancelled" ? row.cancelled_at : status === "expired" ? row.expires_at : row.created_at;
  return { id: String(row.id), status, creatorProfileId: String(row.creator_profile_id), recipientProfileId: String(row.recipient_profile_id), creatorWalletAddress: String(row.creator_wallet_address), recipientWalletAddress: String(row.recipient_wallet_address), core, coreBytes, coreHash, invitationExpiresAtUtc: databaseNow(row.expires_at), createdAtUtc: databaseNow(row.created_at), statusChangedAtUtc: databaseNow(changedAt), outcomeDeadlineUtc: databaseNow(row.outcome_deadline_at), acceptedChallenge: accepted, acceptedChallengeBytes: row.accepted_challenge_bytes ? String(row.accepted_challenge_bytes) : null, acceptedChallengeHash: row.accepted_challenge_hash ? String(row.accepted_challenge_hash) : null, acceptedWalletAddress: row.accepted_wallet_address ? String(row.accepted_wallet_address) : null, fundingDeadlineAtUtc: row.funding_deadline_at ? databaseNow(row.funding_deadline_at) : null };
}

/** Server-only and inactive by default. No route instantiates this adapter. */
export class CanonicalInvitationPersistenceAdapter {
  private sql: postgres.Sql;
  private readonly enabled: boolean;
  constructor(databaseUrl: string, options: { enabledForIntegrationTest?: boolean; ssl?: "require" | false } = {}) { this.enabled = options.enabledForIntegrationTest === true || process.env.STAKEMATE_CANONICAL_INVITATIONS_ENABLED === "true"; this.sql = postgres(databaseUrl, { prepare: false, max: 4, ssl: postgresSslForDatabaseUrl(databaseUrl, options.ssl), idle_timeout: 20, connect_timeout: 10 }); }
  async close() { await this.sql.end({ timeout: 5 }); }
  private gate() { if (!this.enabled) throw new Error("CANONICAL_INVITATION_PERSISTENCE_DISABLED"); }
  private async replay(tx: postgres.TransactionSql, actor: string, operation: Action, idempotencyKey: string, requestHash: string) {
    const keyHash = key(idempotencyKey); const inserted = await tx`insert into stakemate_invitation_idempotency (actor_wallet_address, operation, key_hash, request_hash, response_status) values (${actor}, ${operation}, ${keyHash}, ${requestHash}, 'completed') on conflict do nothing returning invitation_id`;
    if (inserted.length) return null;
    const [existing] = await tx`select request_hash, invitation_id from stakemate_invitation_idempotency where actor_wallet_address = ${actor} and operation = ${operation} and key_hash = ${keyHash} for update`;
    if (!existing || String(existing.request_hash) !== requestHash) throw new Error("IDEMPOTENCY_REPLAY_MISMATCH");
    if (!existing.invitation_id) throw new Error("IDEMPOTENCY_INCOMPLETE");
    const [row] = await tx`select * from stakemate_invitations where id = ${String(existing.invitation_id)}`;
    if (!row) throw new Error("IDEMPOTENCY_RESULT_MISSING"); return record(row);
  }
  private async finish(tx: postgres.TransactionSql, actor: string, operation: Action, idempotencyKey: string, id: string) { await tx`update stakemate_invitation_idempotency set invitation_id = ${id}, completed_at = clock_timestamp() where actor_wallet_address = ${actor} and operation = ${operation} and key_hash = ${key(idempotencyKey)}`; }
  async create(input: { authenticatedCreatorWallet: string; recipientWalletAddress: string; core: FootballDuelCoreTerms; outcomeDeadlineUtc: string; idempotencyKey: string }) {
    assertApplicationWritesAllowed("canonical_invitation_create"); this.gate(); const creator = address(input.authenticatedCreatorWallet); const recipient = address(input.recipientWalletAddress); const coreBytes = canonicalizeFootballDuelCore(input.core); const coreHash = hashFootballDuelCore(input.core); const outcomeDeadline = iso(input.outcomeDeadlineUtc, "outcome deadline");
    if (creator !== input.core.creatorAddress || recipient !== input.core.opponentAddress || creator === recipient) throw new Error("AUTHENTICATED_WALLET_CHANGED");
    const requestHash = digest(`create\n${creator}\n${recipient}\n${coreHash}\n${input.outcomeDeadlineUtc}`);
    return this.sql.begin(async (tx) => { const replay = await this.replay(tx, creator, "create", input.idempotencyKey, requestHash); if (replay) return replay;
      const [row] = await tx`with expire_matching as (update stakemate_invitations set status = 'expired' where creator_wallet_address = ${creator} and recipient_wallet_address = ${recipient} and canonical_core_hash = ${coreHash} and status = 'pending' and expires_at <= clock_timestamp()) insert into stakemate_invitations (id, creator_profile_id, recipient_profile_id, creator_wallet_address, recipient_wallet_address, status, duel_terms_hash, terms_canonical, terms_hash, terms_json, funding_status, outcome_deadline_at, created_at, expires_at, canonical_core_version, canonical_core_bytes, canonical_core_hash, fixture_provider, fixture_id, competition_code, kickoff_at, creator_selection, opponent_selection, unselected_outcome, stake_mist) select ${randomUUID()}, creator.id, recipient.id, creator.wallet_address, recipient.wallet_address, 'pending', ${coreHash}, ${coreBytes}, ${coreHash}, ${tx.json({ competitionName: input.core.competitionName, homeTeamId: input.core.homeTeamId, homeTeam: input.core.homeTeam, awayTeamId: input.core.awayTeamId, awayTeam: input.core.awayTeam })}, 'not_funded', ${new Date(outcomeDeadline).toISOString()}, clock_timestamp(), clock_timestamp() + (${input.core.invitationLifetimeMinutes} * interval '1 minute'), ${input.core.version}, ${coreBytes}, ${coreHash}, ${input.core.provider}, ${input.core.fixtureId}, ${input.core.competitionCode}, ${input.core.kickoffUtc}, ${input.core.creatorSelection}, ${input.core.opponentSelection}, ${input.core.unselectedOutcome}, ${input.core.stakeMist} from stakemate_profiles creator cross join stakemate_profiles recipient where creator.wallet_address = ${creator} and recipient.wallet_address = ${recipient} and creator.id <> recipient.id returning *`;
      if (!row) throw new Error("PROFILE_WALLET_BINDING_CHANGED"); const result = record(row);
      // This table exists only in the isolated pilot migration. Its state is
      // notification metadata, never part of the immutable invitation core.
      await tx`insert into stakemate_invitation_notifications (invitation_id, recipient_wallet_address) values (${result.id}, ${recipient}) on conflict (invitation_id) do nothing`;
      await this.finish(tx, creator, "create", input.idempotencyKey, result.id); return result; });
  }
  async respond(input: { invitationId: string; authenticatedWallet: string; action: Exclude<Action, "create">; idempotencyKey: string; outcomeAuthority?: string }) {
    assertApplicationWritesAllowed(`canonical_invitation_${input.action}`); this.gate(); const actor = address(input.authenticatedWallet); const requestHash = digest(`${input.action}\n${input.invitationId}\n${actor}\n${input.outcomeAuthority ?? ""}`);
    return this.sql.begin(async (tx) => { const replay = await this.replay(tx, actor, input.action, input.idempotencyKey, requestHash); if (replay) return replay;
      const [current] = await tx`select *, clock_timestamp() as database_now from stakemate_invitations where id = ${input.invitationId} for update`;
      if (!current) throw new Error("INVITATION_NOT_FOUND"); if (!current.canonical_core_hash) throw new Error("LEGACY_INVITATION_INACTIVE"); if (String(current.status) !== "pending") throw new Error("INVITATION_NOT_PENDING"); const now = databaseNow(current.database_now); if (new Date(current.expires_at as Date).getTime() <= Date.parse(now)) { await tx`update stakemate_invitations set status = 'expired' where id = ${input.invitationId} and status = 'pending'`; throw new Error("INVITATION_EXPIRED"); }
      let row: Row | undefined;
      if (input.action === "accept") { if (String(current.recipient_wallet_address) !== actor || !input.outcomeAuthority) throw new Error("UNAUTHORIZED_INVITATION_ACTION"); const authority = address(input.outcomeAuthority); if (authority === actor || authority === String(current.creator_wallet_address) || authority === `0x${"0".repeat(64)}`) throw new Error("INVALID_OUTCOME_AUTHORITY"); const funding = new Date(Date.parse(now) + 15 * 60_000).toISOString(); const challenge = { ...coreFromRow(current), invitationExpiresAtUtc: databaseNow(current.expires_at), fundingDeadlineUtc: funding, outcomeDeadlineUtc: databaseNow(current.outcome_deadline_at), outcomeAuthority: authority } satisfies FootballDuelChallengeTerms; const challengeBytes = canonicalizeFootballDuelChallenge(challenge); const challengeHash = hashFootballDuelChallenge(challenge); [row] = await tx`update stakemate_invitations set status = 'accepted', responded_at = ${now}, accepted_wallet_address = ${actor}, funding_deadline_at = ${funding}, accepted_challenge_version = ${"stakemate.challenge-terms.v1"}, accepted_challenge_bytes = ${challengeBytes}, accepted_challenge_hash = ${challengeHash}, accepted_outcome_authority = ${authority} where id = ${input.invitationId} and status = 'pending' and expires_at > ${now} returning *`; }
      else if (input.action === "reject") [row] = await tx`update stakemate_invitations set status = 'rejected', responded_at = ${now} where id = ${input.invitationId} and status = 'pending' and recipient_wallet_address = ${actor} and expires_at > ${now} returning *`;
      else [row] = await tx`update stakemate_invitations set status = 'cancelled', cancelled_at = ${now} where id = ${input.invitationId} and status = 'pending' and creator_wallet_address = ${actor} and expires_at > ${now} returning *`;
      if (!row) throw new Error("UNAUTHORIZED_INVITATION_ACTION"); const result = record(row);
      await tx`update stakemate_invitation_notifications set read_at = coalesce(read_at, clock_timestamp()), dismissed_at = coalesce(dismissed_at, clock_timestamp()), updated_at = clock_timestamp() where invitation_id = ${result.id} and recipient_wallet_address = ${result.recipientWalletAddress}`;
      await this.finish(tx, actor, input.action, input.idempotencyKey, result.id); return result;
    });
  }
  async expire(invitationId: string) { assertApplicationWritesAllowed("canonical_invitation_expire"); this.gate(); const [row] = await this.sql`update stakemate_invitations set status = 'expired' where id = ${invitationId} and status = 'pending' and expires_at <= clock_timestamp() returning *`; return row ? record(row) : null; }
  /** Party-scoped, read-only audit record. It never lazily changes expiry. */
  async invitationForWallet(invitationId: string, authenticatedWallet: string) {
    this.gate(); const actor = address(authenticatedWallet);
    const [row] = await this.sql`select * from stakemate_invitations where id = ${invitationId} and (creator_wallet_address = ${actor} or recipient_wallet_address = ${actor})`;
    return row ? record(row) : null;
  }
  /** Authenticated, wallet-snapshot-scoped read. It never mutates or lazily expires rows. */
  async inbox(authenticatedWallet: string) {
    this.gate(); const actor = address(authenticatedWallet);
    const [received, sent, clock] = await Promise.all([
      this.sql`select * from stakemate_invitations where recipient_wallet_address = ${actor} order by created_at desc`,
      this.sql`select * from stakemate_invitations where creator_wallet_address = ${actor} order by created_at desc`,
      this.sql`select clock_timestamp() as now`,
    ]);
    return { received: received.map(record), sent: sent.map(record), serverNow: databaseNow(clock[0].now) };
  }
  /** CLI-only, read-only candidate source. It is hard-bound to the disposable pilot listener. */
  async allForWalrusOperator() {
    this.gate(); const url = process.env.DATABASE_URL; if (!url) throw new Error("DATABASE_NOT_CONFIGURED"); assertIsolatedPilotDatabaseUrl(url);
    const rows = await this.sql`select * from stakemate_invitations where canonical_core_hash is not null order by created_at asc, id asc`;
    // Historical/synthetic test rows may carry a canonical-looking column but
    // fail immutable core reconstruction; they are never candidate evidence.
    return rows.flatMap((row) => { try { return [record(row)]; } catch { return []; } });
  }
}

let canonicalSingleton: CanonicalInvitationPersistenceAdapter | undefined;

/** Only route code behind the lifecycle gate may obtain the production-configured adapter. */
export function getCanonicalInvitationPersistenceAdapter() {
  const url = process.env.DATABASE_URL;
  if (!url?.trim()) throw new Error("DATABASE_NOT_CONFIGURED");
  canonicalSingleton ??= new CanonicalInvitationPersistenceAdapter(url);
  return canonicalSingleton;
}
