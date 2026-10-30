import { createHash } from "node:crypto";
import postgres from "postgres";
import { buildSubmitOutcome } from "@/lib/escrow-transactions";
import { settlementAutomationEnabled } from "@/lib/server/settlement-worker";
import { assertApplicationWritesAllowed } from "@/lib/server/maintenance-write-freeze";
import { postgresSslForDatabaseUrl } from "@/lib/server/postgres-connection-security";

export type DurableSettlementJob = {
  id: string; invitationId: string; decisionId: string; status: string; attemptCount: number;
  leaseOwner: string | null; leaseExpiresAt: string | null; expectedMoveOutcome: 0 | 1 | 2;
  moveChallengeId: string; transactionDigest: string | null; confirmationStatus: string; lastError: string | null;
};
export type MockReceipt = "confirmed" | "not_found" | "pending" | "failed";
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const row = (value: Record<string, unknown>): DurableSettlementJob => ({
  id: String(value.id), invitationId: String(value.invitation_id), decisionId: String(value.decision_id), status: String(value.status), attemptCount: Number(value.attempt_count),
  leaseOwner: value.lease_owner ? String(value.lease_owner) : null, leaseExpiresAt: value.lease_expires_at ? new Date(value.lease_expires_at as Date).toISOString() : null,
  expectedMoveOutcome: Number(value.expected_move_outcome) as 0 | 1 | 2, moveChallengeId: String(value.move_challenge_id), transactionDigest: value.transaction_digest ? String(value.transaction_digest) : null,
  confirmationStatus: String(value.confirmation_status), lastError: value.last_error ? String(value.last_error) : null,
});

/**
 * Server-only durable queue. It has no signer and no broadcaster. The feature gate
 * permits database scheduling only in the disposable integration environment; even
 * there, prepare() builds an unsigned transaction preview and records no transaction.
 */
export class DurableSettlementWorker {
  private readonly sql: postgres.Sql;
  private readonly enabled: boolean;
  constructor(databaseUrl: string, options: { enabledForIntegrationTest?: boolean; ssl?: "require" | false } = {}) {
    this.enabled = options.enabledForIntegrationTest === true || process.env.STAKEMATE_DURABLE_SETTLEMENT_WORKER_ENABLED === "true";
    this.sql = postgres(databaseUrl, { prepare: false, max: 4, ssl: postgresSslForDatabaseUrl(databaseUrl, options.ssl), idle_timeout: 20, connect_timeout: 10 });
  }
  async close() { await this.sql.end({ timeout: 5 }); }
  private gate() { if (!this.enabled) throw new Error("DURABLE_SETTLEMENT_WORKER_DISABLED"); }
  private async audit(tx: postgres.TransactionSql, jobId: string, eventType: string, data: Record<string, unknown>) {
    const serialized = JSON.stringify({ jobId, eventType, data });
    await tx`insert into stakemate_settlement_audit (job_id, event_type, event_data, event_hash) values (${jobId}, ${eventType}, ${tx.json(data as never)}, ${digest(serialized)})`;
  }
  /** Atomically claims one eligible job. A lease cannot be claimed by a second worker. */
  async claim(workerId: string, leaseSeconds = 30): Promise<DurableSettlementJob | null> {
    assertApplicationWritesAllowed("durable_settlement_claim"); this.gate(); if (!/^[A-Za-z0-9._:-]{3,100}$/u.test(workerId) || !Number.isInteger(leaseSeconds) || leaseSeconds < 5 || leaseSeconds > 300) throw new Error("INVALID_WORKER_LEASE");
    return this.sql.begin(async (tx) => {
      const [control] = await tx`select emergency_paused from stakemate_settlement_control where singleton = true for update`;
      if (!control || control.emergency_paused) return null;
      const [claimed] = await tx`
        with candidate as (
          select j.id from stakemate_settlement_jobs j
          join stakemate_settlement_decisions d on d.id = j.decision_id
          where j.status in ('pending', 'retry_wait') and j.run_after <= clock_timestamp()
            and d.verification_state in ('verified', 'void_pending')
            and d.correction_window_ends_at <= clock_timestamp()
            and d.expected_move_outcome = j.expected_move_outcome
          order by j.run_after, j.created_at
          for update of j skip locked limit 1
        )
        update stakemate_settlement_jobs j set status = 'leased', lease_owner = ${workerId}, lease_expires_at = clock_timestamp() + (${leaseSeconds} * interval '1 second'), attempt_count = attempt_count + 1, updated_at = clock_timestamp(), last_error = null
        from candidate where j.id = candidate.id returning j.*`;
      if (!claimed) return null;
      await this.audit(tx, String(claimed.id), "leased", { workerId, leaseSeconds });
      return row(claimed);
    });
  }
  /** Converts a valid leased decision to an unsigned transaction preview. Never signs or broadcasts. */
  async prepare(jobId: string, workerId: string) {
    assertApplicationWritesAllowed("durable_settlement_prepare"); this.gate();
    return this.sql.begin(async (tx) => {
      const [current] = await tx`select j.*, d.verification_state, d.correction_window_ends_at, d.expected_move_outcome as decision_outcome from stakemate_settlement_jobs j join stakemate_settlement_decisions d on d.id = j.decision_id where j.id = ${jobId} for update`;
      if (!current || current.status !== "leased" || current.lease_owner !== workerId || new Date(current.lease_expires_at as Date).getTime() <= Date.now()) throw new Error("SETTLEMENT_LEASE_NOT_OWNED");
      if (!["verified", "void_pending"].includes(String(current.verification_state)) || new Date(current.correction_window_ends_at as Date).getTime() > Date.now() || Number(current.decision_outcome) !== Number(current.expected_move_outcome)) throw new Error("SETTLEMENT_DECISION_NOT_FINAL");
      const preview = buildSubmitOutcome({ challengeId: String(current.move_challenge_id), outcome: Number(current.expected_move_outcome) as 0 | 1 | 2 }).preview;
      const [updated] = await tx`update stakemate_settlement_jobs set status = 'prepared', lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp(), last_error = ${settlementAutomationEnabled ? null : "AUTOMATION_SIGNING_AND_BROADCAST_DISABLED"} where id = ${jobId} returning *`;
      await this.audit(tx, jobId, "prepared_unsigned", { executionDisabled: !settlementAutomationEnabled, expectedMoveOutcome: Number(current.expected_move_outcome) });
      return { job: row(updated), preview, broadcasted: false as const };
    });
  }
  /** Recover leases after worker loss. A job with a transaction digest stays ambiguous until reconciliation. */
  async recoverExpiredLeases() {
    assertApplicationWritesAllowed("durable_settlement_recover_leases"); this.gate();
    return this.sql.begin(async (tx) => {
      const recovered = await tx`update stakemate_settlement_jobs set status = case when transaction_digest is null then 'retry_wait' else 'broadcast_pending' end, lease_owner = null, lease_expires_at = null, run_after = case when transaction_digest is null then clock_timestamp() + (least(attempt_count, 8) * interval '5 seconds') else run_after end, updated_at = clock_timestamp(), last_error = case when transaction_digest is null then 'LEASE_EXPIRED_RETRY_SCHEDULED' else 'AMBIGUOUS_TRANSACTION_RECONCILIATION_REQUIRED' end where status = 'leased' and lease_expires_at <= clock_timestamp() returning *`;
      for (const item of recovered) await this.audit(tx, String(item.id), "lease_expired", { hasTransactionDigest: Boolean(item.transaction_digest) });
      return recovered.map(row);
    });
  }
  /** Mock-only receipt reconciliation. A not-found receipt is required before retrying an ambiguous transaction. */
  async reconcileMockReceipt(jobId: string, receipt: MockReceipt) {
    assertApplicationWritesAllowed("durable_settlement_reconcile"); this.gate();
    return this.sql.begin(async (tx) => {
      const [current] = await tx`select * from stakemate_settlement_jobs where id = ${jobId} for update`;
      if (!current || !current.transaction_digest) throw new Error("TRANSACTION_RECONCILIATION_REQUIRES_DIGEST");
      const status = receipt === "confirmed" ? "confirmed" : receipt === "not_found" ? "retry_wait" : "broadcast_pending";
      const [updated] = await tx`update stakemate_settlement_jobs set status = ${status}, confirmation_status = ${receipt}, lease_owner = null, lease_expires_at = null, run_after = case when ${receipt} = 'not_found' then clock_timestamp() else run_after end, updated_at = clock_timestamp(), last_error = case when ${receipt} = 'not_found' then 'CHAIN_RECEIPT_NOT_FOUND' else null end where id = ${jobId} returning *`;
      await this.audit(tx, jobId, "mock_receipt_reconciled", { receipt, transactionDigest: String(current.transaction_digest) });
      return row(updated);
    });
  }
}
