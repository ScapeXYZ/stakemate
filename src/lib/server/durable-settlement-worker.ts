import { createHash } from "node:crypto";
import postgres from "postgres";
import { buildSubmitOutcome } from "@/lib/escrow-transactions";
import { settlementBroadcastActivationEnabled } from "@/lib/server/settlement-worker";
import { assertApplicationWritesAllowed } from "@/lib/server/maintenance-write-freeze";
import { postgresSslForDatabaseUrl } from "@/lib/server/postgres-connection-security";
import type { OutcomeAuthorityReconciler, OutcomeAuthoritySigner } from "@/lib/server/testnet-outcome-authority";

export type DurableSettlementJob = {
  id: string; invitationId: string; decisionId: string; status: string; attemptCount: number;
  leaseOwner: string | null; leaseExpiresAt: string | null; expectedMoveOutcome: 0 | 1 | 2;
  moveChallengeId: string; transactionDigest: string | null; confirmationStatus: string; lastError: string | null;
};
export type MockReceipt = "confirmed" | "not_found" | "pending" | "failed";
export type VerifiedSettlementQueueInput = { invitationId: string; evidenceHash: string; verificationState: "verified" | "void_pending"; resultOutcome: "home_win" | "draw" | "away_win" | null; expectedMoveOutcome: 0 | 1 | 2; correctionWindowEndsAt: string; rationale: string; decisionHash: string; moveChallengeId: string; fundingConfirmedAt: string; idempotencyKey: string };
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
  /** Records a verified/void decision and its one idempotent durable job. Callers
   * must have already run immutable on-chain policy checks; this method never
   * accepts pending or disputed provider results. */
  async enqueueVerified(input: VerifiedSettlementQueueInput) {
    assertApplicationWritesAllowed("durable_settlement_enqueue"); this.gate();
    if (!/^[0-9a-f]{64}$/u.test(input.evidenceHash) || !/^[0-9a-f]{64}$/u.test(input.decisionHash) || !/^[0-9a-f]{64}$/u.test(input.idempotencyKey) || !/^0x[0-9a-f]{64}$/u.test(input.moveChallengeId) || !input.rationale.trim()) throw new Error("INVALID_SETTLEMENT_QUEUE_INPUT");
    if ((input.verificationState === "verified") !== (input.resultOutcome !== null) || (input.verificationState === "void_pending") !== (input.expectedMoveOutcome === 0)) throw new Error("INVALID_SETTLEMENT_DECISION");
    return this.sql.begin(async (tx) => {
      const [decision] = await tx`insert into stakemate_settlement_decisions (invitation_id, evidence_hash, verification_state, result_outcome, expected_move_outcome, correction_window_ends_at, rationale, decision_hash) values (${input.invitationId}, ${input.evidenceHash}, ${input.verificationState}, ${input.resultOutcome}, ${input.expectedMoveOutcome}, ${input.correctionWindowEndsAt}, ${input.rationale}, ${input.decisionHash}) on conflict (decision_hash) do update set decision_hash = excluded.decision_hash returning id`;
      const [job] = await tx`insert into stakemate_settlement_jobs (invitation_id, decision_id, idempotency_key, expected_move_outcome, move_challenge_id, funding_confirmed_at) values (${input.invitationId}, ${decision.id}, ${input.idempotencyKey}, ${input.expectedMoveOutcome}, ${input.moveChallengeId}, ${input.fundingConfirmedAt}) on conflict (invitation_id) do update set invitation_id = excluded.invitation_id returning *`;
      await this.audit(tx, String(job.id), "queued_verified_outcome", { decisionId: String(decision.id), verificationState: input.verificationState, expectedMoveOutcome: input.expectedMoveOutcome }); return row(job);
    });
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
      // A job can legitimately be leased again after an expired attempt. Keep
      // the immutable audit record tied to that specific attempt, rather than
      // making a second lease by the same worker collide with its first one.
      await this.audit(tx, String(claimed.id), "leased", { workerId, leaseSeconds, attemptCount: Number(claimed.attempt_count) });
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
      const automationEnabled = settlementBroadcastActivationEnabled();
      const [updated] = await tx`update stakemate_settlement_jobs set status = 'prepared', lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp(), last_error = ${automationEnabled ? null : "AUTOMATION_SIGNING_AND_BROADCAST_DISABLED"} where id = ${jobId} returning *`;
      await this.audit(tx, jobId, "prepared_unsigned", { executionDisabled: !automationEnabled, expectedMoveOutcome: Number(current.expected_move_outcome) });
      return { job: row(updated), preview, broadcasted: false as const };
    });
  }
  /**
   * Executes a previously prepared job only when a caller has separately enabled
   * the broadcast gate. The immutable invitation authority is re-read under lock
   * and must equal the signer address before simulation or submission. This
   * method deliberately does not construct a signer or read signing secrets.
   */
  async executePrepared(jobId: string, signer: OutcomeAuthoritySigner, allowBroadcast = false) {
    assertApplicationWritesAllowed("durable_settlement_execute"); this.gate();
    const prepared = await this.sql.begin(async (tx) => {
      const [current] = await tx`select j.*, i.accepted_outcome_authority from stakemate_settlement_jobs j join stakemate_invitations i on i.id = j.invitation_id where j.id = ${jobId} for update`;
      if (!current || current.status !== "prepared") throw new Error("SETTLEMENT_JOB_NOT_PREPARED");
      if (!current.accepted_outcome_authority || String(current.accepted_outcome_authority).toLowerCase() !== signer.address.toLowerCase()) throw new Error("OUTCOME_AUTHORITY_DOES_NOT_MATCH_CHALLENGE");
      await this.audit(tx, jobId, "simulation_requested", { challengeId: String(current.move_challenge_id), expectedMoveOutcome: Number(current.expected_move_outcome) });
      return { challengeId: String(current.move_challenge_id), outcome: Number(current.expected_move_outcome) as 0 | 1 | 2 };
    });
    try { await signer.simulate(prepared.challengeId, prepared.outcome); }
    catch (error) { return this.recordExecutionFailure(jobId, "SIMULATION_FAILED", error); }
    if (!settlementBroadcastActivationEnabled() || !allowBroadcast) {
      return this.sql.begin(async (tx) => { const [updated] = await tx`update stakemate_settlement_jobs set last_error = 'AUTOMATION_SIGNING_AND_BROADCAST_DISABLED', updated_at = clock_timestamp() where id = ${jobId} and status = 'prepared' returning *`; if (!updated) throw new Error("SETTLEMENT_JOB_STATE_CHANGED"); await this.audit(tx, jobId, "simulated_broadcast_blocked", { broadcastGate: false }); return row(updated); });
    }
    // A transport failure after the signer sends bytes is ambiguous. Persist the
    // attempt before calling it and leave it non-retryable until a chain lookup
    // resolves it; never turn this condition into a blind resubmission.
    await this.sql.begin(async (tx) => {
      const [updated] = await tx`update stakemate_settlement_jobs set status = 'broadcast_pending', confirmation_status = 'pending', last_error = 'SUBMISSION_AMBIGUOUS_RECONCILIATION_REQUIRED', updated_at = clock_timestamp() where id = ${jobId} and status = 'prepared' and transaction_digest is null returning *`;
      if (!updated) throw new Error("SETTLEMENT_IDEMPOTENCY_CONFLICT");
      await this.audit(tx, jobId, "submission_intent_recorded", { challengeId: prepared.challengeId });
    });
    try {
      const receipt = await signer.submit(prepared.challengeId, prepared.outcome);
      return this.sql.begin(async (tx) => { const [updated] = await tx`update stakemate_settlement_jobs set transaction_digest = ${receipt.digest}, confirmation_status = 'pending', last_error = null, updated_at = clock_timestamp() where id = ${jobId} and status = 'broadcast_pending' and transaction_digest is null returning *`; if (!updated) throw new Error("SETTLEMENT_IDEMPOTENCY_CONFLICT"); await this.audit(tx, jobId, "submitted", { transactionDigest: receipt.digest }); return row(updated); });
    } catch (error) {
      // The durable state already says that reconciliation is mandatory. Do not
      // downgrade it to retry_wait, even if the error looks transient.
      return this.sql.begin(async (tx) => { const [updated] = await tx`update stakemate_settlement_jobs set last_error = 'SUBMISSION_AMBIGUOUS_RECONCILIATION_REQUIRED', updated_at = clock_timestamp() where id = ${jobId} and status = 'broadcast_pending' returning *`; if (!updated) throw new Error("SETTLEMENT_JOB_STATE_CHANGED"); await this.audit(tx, jobId, "submission_ambiguous", { detail: error instanceof Error ? error.message.slice(0, 120) : "unknown" }); return row(updated); });
    }
  }
  private async recordExecutionFailure(jobId: string, code: string, error: unknown) {
    const safe = error instanceof Error ? error.message.replace(/suiprivkey\S+|0x[0-9a-f]{64}/giu, "[redacted]").slice(0, 240) : "unknown";
    return this.sql.begin(async (tx) => { const [updated] = await tx`update stakemate_settlement_jobs set status = 'retry_wait', run_after = clock_timestamp() + (least(attempt_count, 8) * interval '5 seconds'), last_error = ${code}, updated_at = clock_timestamp() where id = ${jobId} and status in ('prepared', 'broadcast_pending') returning *`; if (!updated) throw new Error("SETTLEMENT_JOB_STATE_CHANGED"); await this.audit(tx, jobId, "execution_failed", { code, detail: safe }); return row(updated); });
  }
  /** Recover leases after worker loss. A job with a transaction digest stays ambiguous until reconciliation. */
  async recoverExpiredLeases() {
    assertApplicationWritesAllowed("durable_settlement_recover_leases"); this.gate();
    return this.sql.begin(async (tx) => {
      const recovered = await tx`update stakemate_settlement_jobs set status = case when transaction_digest is null then 'retry_wait' else 'broadcast_pending' end, lease_owner = null, lease_expires_at = null, run_after = case when transaction_digest is null then clock_timestamp() + (least(attempt_count, 8) * interval '5 seconds') else run_after end, updated_at = clock_timestamp(), last_error = case when transaction_digest is null then 'LEASE_EXPIRED_RETRY_SCHEDULED' else 'AMBIGUOUS_TRANSACTION_RECONCILIATION_REQUIRED' end where status = 'leased' and lease_expires_at <= clock_timestamp() returning *`;
      // Expiry is a transition of a particular lease attempt. A job may be
      // safely retried and expire again, so including its monotonic attempt
      // count preserves both append-only records without treating either as a
      // duplicate event.
      for (const item of recovered) await this.audit(tx, String(item.id), "lease_expired", { hasTransactionDigest: Boolean(item.transaction_digest), attemptCount: Number(item.attempt_count) });
      return recovered.map(row);
    });
  }
  /** Mock-only receipt reconciliation. A not-found receipt is required before retrying an ambiguous transaction. */
  async reconcileMockReceipt(jobId: string, receipt: MockReceipt) {
    assertApplicationWritesAllowed("durable_settlement_reconcile"); this.gate();
    return this.sql.begin(async (tx) => {
      const [current] = await tx`select * from stakemate_settlement_jobs where id = ${jobId} for update`;
      if (!current || !current.transaction_digest) throw new Error("TRANSACTION_RECONCILIATION_REQUIRES_DIGEST");
      // A response can be lost after a terminal update commits. A retry carrying
      // the same terminal receipt is therefore a state-level no-op, not a new
      // audit event. Any other retry would contradict immutable history.
      if (current.status !== "broadcast_pending") {
        if (current.status === "confirmed" && current.confirmation_status === receipt) return row(current);
        throw new Error("SETTLEMENT_RECEIPT_CONFLICT");
      }
      const status = receipt === "confirmed" ? "confirmed" : receipt === "not_found" ? "retry_wait" : "broadcast_pending";
      const [updated] = await tx`update stakemate_settlement_jobs set status = ${status}, confirmation_status = ${receipt}, lease_owner = null, lease_expires_at = null, run_after = case when ${receipt} = 'not_found' then clock_timestamp() else run_after end, updated_at = clock_timestamp(), last_error = case when ${receipt} = 'not_found' then 'CHAIN_RECEIPT_NOT_FOUND' else null end where id = ${jobId} returning *`;
      await this.audit(tx, jobId, "mock_receipt_reconciled", { receipt, transactionDigest: String(current.transaction_digest) });
      return row(updated);
    });
  }
  /** Reconciles a real Testnet digest and the terminal escrow event before a job
   * can become confirmed or retryable. An unknown submission stays pending. */
  async reconcileChainReceipt(jobId: string, reconciler: OutcomeAuthorityReconciler) {
    assertApplicationWritesAllowed("durable_settlement_reconcile_chain"); this.gate();
    const current = await this.sql.begin(async (tx) => {
      const [job] = await tx`select * from stakemate_settlement_jobs where id = ${jobId} for update`;
      if (!job || job.status !== "broadcast_pending" || !job.transaction_digest) throw new Error("TRANSACTION_RECONCILIATION_REQUIRES_DIGEST");
      return { digest: String(job.transaction_digest), challengeId: String(job.move_challenge_id), outcome: Number(job.expected_move_outcome) as 0 | 1 | 2 };
    });
    const receipt = await reconciler.reconcile(current.challengeId, current.outcome, current.digest);
    return this.sql.begin(async (tx) => {
      const status = receipt === "confirmed" ? "confirmed" : receipt === "not_found" ? "retry_wait" : receipt === "failed" ? "failed" : "broadcast_pending";
      const [updated] = await tx`update stakemate_settlement_jobs set status = ${status}, confirmation_status = ${receipt}, lease_owner = null, lease_expires_at = null, run_after = case when ${receipt} = 'not_found' then clock_timestamp() else run_after end, updated_at = clock_timestamp(), last_error = case when ${receipt} = 'not_found' then 'CHAIN_RECEIPT_NOT_FOUND' when ${receipt} = 'failed' then 'CHAIN_EXECUTION_OR_ESCROW_RECONCILIATION_FAILED' when ${receipt} = 'pending' then 'CHAIN_RECONCILIATION_PENDING' else null end where id = ${jobId} and status = 'broadcast_pending' and transaction_digest = ${current.digest} returning *`;
      if (!updated) throw new Error("SETTLEMENT_JOB_STATE_CHANGED");
      await this.audit(tx, jobId, "chain_receipt_reconciled", { receipt, transactionDigest: current.digest, challengeId: current.challengeId });
      return row(updated);
    });
  }
  async broadcastPending(limit = 20) {
    this.gate();
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_RECONCILIATION_LIMIT");
    const jobs = await this.sql`select * from stakemate_settlement_jobs where status = 'broadcast_pending' and transaction_digest is not null order by updated_at asc limit ${limit}`;
    return jobs.map(row);
  }
}
