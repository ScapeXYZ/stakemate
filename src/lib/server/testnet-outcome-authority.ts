import "server-only";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { buildSubmitOutcome } from "@/lib/escrow-transactions";
import { getEscrowChallenge } from "@/lib/escrow-discovery";
import { classifySettlementReceipt, type ChainReceipt } from "@/lib/testnet-settlement-reconciliation";
import { loadLocalSettlementKeypair } from "@/lib/server/local-settlement-keystore";

export type OutcomeAuthoritySigner = {
  readonly address: string;
  simulate(challengeId: string, outcome: 0 | 1 | 2): Promise<void>;
  submit(challengeId: string, outcome: 0 | 1 | 2): Promise<{ digest: string }>;
};
export type OutcomeAuthorityReconciler = {
  reconcile(challengeId: string, outcome: 0 | 1 | 2, digest: string): Promise<ChainReceipt>;
};

const MAX_SETTLEMENT_GAS_MIST = BigInt(10_000_000);

function assertVpsOnly() {
  // This intentionally is not a NEXT_PUBLIC variable. A Vercel/serverless
  // deployment must not be able to load an unattended settlement key.
  if (process.env.STAKEMATE_SETTLEMENT_VPS !== "true") {
    throw new Error("SETTLEMENT_SIGNER_VPS_ONLY");
  }
  if (process.env.NEXT_PUBLIC_SUI_NETWORK && process.env.NEXT_PUBLIC_SUI_NETWORK !== "testnet") {
    throw new Error("SETTLEMENT_TESTNET_ONLY");
  }
}

/**
 * Dedicated Testnet authority adapter. The secret remains server-only and a
 * separately explicit broadcast flag is required even when the key exists.
 * Production should supply a managed signer implementing OutcomeAuthoritySigner.
 */
export class TestnetOutcomeAuthoritySigner implements OutcomeAuthoritySigner {
  readonly address: string;
  private readonly client = new SuiGrpcClient({ network: "testnet", baseUrl: "https://fullnode.testnet.sui.io:443" });
  constructor(private readonly keypair: Ed25519Keypair) { this.address = keypair.toSuiAddress(); }
  static fromLocalKeystore() {
    assertVpsOnly();
    return new TestnetOutcomeAuthoritySigner(loadLocalSettlementKeypair());
  }
  private assertAuthorized(recordedAuthority: string) {
    if (normalizeSuiAddress(recordedAuthority) !== normalizeSuiAddress(this.address)) throw new Error("OUTCOME_AUTHORITY_DOES_NOT_MATCH_CHALLENGE");
  }
  async simulate(challengeId: string, outcome: 0 | 1 | 2) {
    assertVpsOnly();
    const { transaction } = buildSubmitOutcome({ challengeId, outcome }); transaction.setSender(this.address); transaction.setGasBudget(MAX_SETTLEMENT_GAS_MIST);
    const result = await this.client.simulateTransaction({ transaction });
    if (result.$kind === "FailedTransaction" || !result.Transaction.status.success) throw new Error("OUTCOME_SIMULATION_FAILED");
  }
  async submit(challengeId: string, outcome: 0 | 1 | 2) {
    assertVpsOnly();
    if (process.env.STAKEMATE_TESTNET_SETTLEMENT_BROADCAST_ENABLED !== "true") throw new Error("OUTCOME_BROADCAST_NOT_AUTHORIZED");
    const { transaction } = buildSubmitOutcome({ challengeId, outcome });
    transaction.setGasBudget(MAX_SETTLEMENT_GAS_MIST);
    const result = await this.keypair.signAndExecuteTransaction({ transaction, client: this.client });
    if (result.$kind === "FailedTransaction" || !result.Transaction.status.success) throw new Error("OUTCOME_TRANSACTION_FAILED");
    return { digest: result.Transaction.digest };
  }
  /** Read-only receipt reconciliation. A successful transaction is not enough:
   * it must emit the exact terminal escrow event for this challenge. */
  async reconcile(challengeId: string, outcome: 0 | 1 | 2, digest: string): Promise<ChainReceipt> {
    assertVpsOnly();
    try {
      const result = await this.client.getTransaction({ digest, include: { events: true, effects: true } });
      const classified = classifySettlementReceipt({ kind: result.$kind === "Transaction" && result.Transaction.status.success ? "success" : "failed", challengeId, outcome, events: result.$kind === "Transaction" ? result.Transaction.events : [] });
      if (classified !== "confirmed") return classified;
      // A success effect/event alone is not a payout receipt. Re-read the
      // shared object and require its terminal state plus its immutable winner.
      const challenge = await getEscrowChallenge(this.client, challengeId);
      if ((outcome === 0 && challenge.state !== 3) || (outcome !== 0 && challenge.state !== 2)) return "failed";
      if (outcome !== 0) {
        const event = result.$kind === "Transaction" ? result.Transaction.events.find((item) => item.eventType.endsWith("::ChallengeSettled") && item.json?.challenge_id === challengeId) : undefined;
        const recipient = event?.json?.winner;
        const expected = outcome === 1 ? challenge.creator : challenge.opponent;
        if (typeof recipient !== "string" || normalizeSuiAddress(recipient) !== normalizeSuiAddress(expected)) return "failed";
      }
      return "confirmed";
    } catch (error) {
      // The SDK classifies an absent digest as a TransactionError; do not rely on
      // its internal type so this remains compatible across Sui SDK releases.
      if (error instanceof Error && /not.?found/i.test(error.message)) return "not_found";
      return "pending";
    }
  }
  /** Verify this signer against the immutable authority before any simulation or broadcast. */
  async submitAuthorized(input: { recordedAuthority: string; challengeId: string; outcome: 0 | 1 | 2 }) { this.assertAuthorized(input.recordedAuthority); await this.simulate(input.challengeId, input.outcome); return this.submit(input.challengeId, input.outcome); }
}
