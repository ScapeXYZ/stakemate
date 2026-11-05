import { buildSubmitOutcome } from "@/lib/escrow-transactions";
import { settlementOutcome, type ResultCommitment, type ResultVerification } from "@/lib/server/football-result-verification";

export type FundedDuel = { id: string; challengeId: string; state: "funded" | "settled" | "voided"; commitment: ResultCommitment; verification: ResultVerification; outcomeAuthority: string };
export type SettlementJob = { duelId: string; state: "pending" | "prepared" | "broadcast_pending" | "confirmed" | "failed" | "paused"; idempotencyKey: string; settlementOutcome: 0 | 1 | 2 | null; attempts: number; lastError: string | null };
/** Runtime-only activation gate. It is deliberately false unless the VPS has
 * explicitly been configured for Testnet broadcast; Vercel cannot satisfy the
 * companion VPS-only signer guard. */
export const settlementAutomationEnabled = false;

export function settlementBroadcastActivationEnabled() {
  return process.env.STAKEMATE_SETTLEMENT_VPS === "true" && process.env.STAKEMATE_TESTNET_SETTLEMENT_BROADCAST_ENABLED === "true";
}

/** Durable production implementation must use SELECT ... FOR UPDATE SKIP LOCKED and a DB-backed job table. This mock-safe worker signs and broadcasts nothing. */
export class SettlementWorker {
  private leases = new Set<string>(); private jobs = new Map<string, SettlementJob>();
  constructor(private readonly paused: () => boolean = () => false) {}
  async process(duel: FundedDuel) {
    if (this.paused()) return this.save({ duelId: duel.id, state: "paused", idempotencyKey: `settlement:${duel.id}`, settlementOutcome: null, attempts: 0, lastError: "EMERGENCY_PAUSE" });
    if (duel.state !== "funded") return this.save({ duelId: duel.id, state: duel.state === "settled" ? "confirmed" : "failed", idempotencyKey: `settlement:${duel.id}`, settlementOutcome: null, attempts: 0, lastError: "DUEL_NOT_FUNDED" });
    if (this.leases.has(duel.id)) return this.jobs.get(duel.id) ?? this.save({ duelId: duel.id, state: "pending", idempotencyKey: `settlement:${duel.id}`, settlementOutcome: null, attempts: 0, lastError: "LEASED_BY_ANOTHER_WORKER" });
    this.leases.add(duel.id); try { const outcome = settlementOutcome(duel.commitment, duel.verification); if (outcome === null) return this.save({ duelId: duel.id, state: "pending", idempotencyKey: `settlement:${duel.id}`, settlementOutcome: null, attempts: 0, lastError: "RESULT_NOT_FINALIZED" });
      // Validates the exact deployed target/argument shape but never signs or executes.
      buildSubmitOutcome({ challengeId: duel.challengeId, outcome });
      return this.save({ duelId: duel.id, state: "prepared", idempotencyKey: `settlement:${duel.id}`, settlementOutcome: outcome, attempts: 1, lastError: settlementBroadcastActivationEnabled() ? null : "AUTOMATION_SIGNING_AND_BROADCAST_DISABLED" });
    } finally { this.leases.delete(duel.id); }
  }
  private save(job: SettlementJob) { const existing = this.jobs.get(job.duelId); if (existing?.state === "prepared" || existing?.state === "confirmed") return existing; this.jobs.set(job.duelId, job); return job; }
}
