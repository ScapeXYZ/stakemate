import { createHash } from "node:crypto";
import { ESCROW_DEPLOYMENT, CHALLENGE_TYPE } from "@/lib/escrow-config";
import type { EscrowChallenge } from "@/lib/escrow-discovery";
import { buildSubmitOutcome } from "@/lib/escrow-transactions";
import { settlementOutcome, verifyFootballResult, type FootballResultEvidence, type ResultCommitment } from "@/lib/server/football-result-verification";
import { SettlementWorker, type SettlementJob } from "@/lib/server/settlement-worker";

export type FundingConfirmation = { challengeId: string; packageId: string; fundingTransactionDigest: string; confirmedAtUtc: string };
export type SettlementPolicyInput = {
  acceptedChallengeHash: string; expectedChallengeId: string; expectedOutcomeAuthority: string;
  onChainObjectType: string; knownChallengeIdsForAcceptedTerms: readonly string[];
  fundingConfirmation: FundingConfirmation | null; onChainChallenge: EscrowChallenge | null;
  commitment: ResultCommitment; evidence: readonly FootballResultEvidence[]; now?: Date;
};
export type SettlementPolicyDecision = {
  approved: boolean; code: string; auditHash: string; expectedOutcome: 0 | 1 | 2 | null;
  /** Preview only: never a transaction, signature, serialized payload, or broadcast request. */
  preview: ReturnType<typeof buildSubmitOutcome>["preview"] | null;
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const address = (value: string) => /^0x[0-9a-f]{64}$/u.test(value) ? value.toLowerCase() : null;
const challengeId = (value: string) => /^0x[0-9a-f]{64}$/u.test(value) ? value.toLowerCase() : null;
const decision = (approved: boolean, code: string, expectedOutcome: 0 | 1 | 2 | null = null, preview: SettlementPolicyDecision["preview"] = null): SettlementPolicyDecision => ({ approved, code, expectedOutcome, preview, auditHash: hash({ approved, code, expectedOutcome, previewTarget: preview?.target ?? null }) });

/**
 * Pure server-side policy gate for simulations. It deliberately has no signer,
 * broadcaster, raw-transaction input, network client, or feature flag that enables
 * execution. Callers must supply independently read, immutable on-chain evidence.
 */
export function simulateSettlementPolicy(input: SettlementPolicyInput): SettlementPolicyDecision {
  const expectedId = challengeId(input.expectedChallengeId); const authority = address(input.expectedOutcomeAuthority);
  if (!expectedId || !authority || !/^0x[0-9a-f]{64}$/u.test(input.acceptedChallengeHash)) return decision(false, "INVALID_IMMUTABLE_INPUT");
  const confirmation = input.fundingConfirmation; const chain = input.onChainChallenge;
  if (!confirmation || !chain || !confirmation.fundingTransactionDigest || confirmation.packageId !== ESCROW_DEPLOYMENT.packageId || challengeId(confirmation.challengeId) !== expectedId) return decision(false, "ONCHAIN_FUNDING_UNCONFIRMED");
  if (input.onChainObjectType !== CHALLENGE_TYPE || challengeId(chain.id) !== expectedId || chain.state !== 1) return decision(false, "CHALLENGE_NOT_FUNDED");
  if (input.knownChallengeIdsForAcceptedTerms.length !== 1 || challengeId(input.knownChallengeIdsForAcceptedTerms[0]) !== expectedId) return decision(false, "DUPLICATE_OR_UNBOUND_CHALLENGE");
  if (chain.termsHashHex.toLowerCase() !== input.acceptedChallengeHash.toLowerCase()) return decision(false, "TERMS_HASH_MISMATCH");
  if (chain.outcomeAuthority.toLowerCase() !== authority) return decision(false, "OUTCOME_AUTHORITY_MISMATCH");
  // This documents the exact attested package/type binding. The parsed object is
  // accepted only by the discovery layer after it has already checked this type.
  if (!CHALLENGE_TYPE.startsWith(`${ESCROW_DEPLOYMENT.packageId}::`)) return decision(false, "PACKAGE_BINDING_INVALID");
  const now = input.now ?? new Date();
  if (BigInt(now.getTime()) >= chain.outcomeDeadlineMs) return decision(false, "OUTCOME_DEADLINE_PASSED");
  const kickoffMs = Date.parse(input.commitment.kickoffUtc);
  if (input.evidence.some((item) => Date.parse(item.observedAtUtc) < kickoffMs || Date.parse(item.sourceRetrievedAtUtc) < Date.parse(item.observedAtUtc))) return decision(false, "RESULT_EVIDENCE_STALE_OR_INCONSISTENT");
  let verification;
  try { verification = verifyFootballResult(input.commitment, input.evidence, now); } catch { return decision(false, "RESULT_EVIDENCE_INVALID"); }
  const outcome = settlementOutcome(input.commitment, verification);
  if (outcome === null) return decision(false, `RESULT_NOT_SETTLEABLE_${verification.state.toUpperCase()}`);
  // This runs after every policy check. Discard the unsigned Transaction and expose
  // only its fixed target/argument preview to a simulation caller.
  const preview = buildSubmitOutcome({ challengeId: expectedId, outcome }).preview;
  return decision(true, "SIMULATION_POLICY_APPROVED_EXECUTION_DISABLED", outcome, preview);
}

/** This boundary is intentionally non-configurable until a separate approval. */
export const settlementSigningEnabled = false;

/** Connects verifier, policy gate, and the existing mock-safe worker for tests only. */
export class SimulationSettlementPipeline {
  constructor(private readonly worker = new SettlementWorker()) {}
  async process(input: SettlementPolicyInput & { duelId: string }) : Promise<{ policy: SettlementPolicyDecision; job: SettlementJob | null }> {
    const policy = simulateSettlementPolicy(input);
    if (!policy.approved || !input.onChainChallenge) return { policy, job: null };
    const verification = verifyFootballResult(input.commitment, input.evidence, input.now);
    const job = await this.worker.process({ id: input.duelId, challengeId: input.onChainChallenge.id, state: "funded", commitment: input.commitment, verification, outcomeAuthority: input.onChainChallenge.outcomeAuthority });
    return { policy, job };
  }
}
