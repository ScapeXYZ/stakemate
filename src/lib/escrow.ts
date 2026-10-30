/**
 * Compile-time interface for the Testnet Move package. This contains no package
 * ID and deliberately does not construct, sign, or submit a transaction.
 */
export const ESCROW_NETWORK = "testnet" as const;
const MAX_WINNER_STAKE_MIST = (BigInt(2) ** BigInt(64) - BigInt(1)) / BigInt(2);
const SUI_ADDRESS = /^0x[0-9a-fA-F]{64}$/;

export type EscrowChallengeTerms = {
  opponent: string;
  stakeMist: bigint;
  termsHashHex: string;
  fundingDeadlineMs: bigint;
  outcomeDeadlineMs: bigint;
  outcomeAuthority: string;
};

export type EscrowTransactionIntent = {
  network: typeof ESCROW_NETWORK;
  function: "create" | "accept_and_fund" | "submit_outcome" | "cancel_unfunded" | "refund_expired_funding" | "void_unreported_outcome";
  args: readonly unknown[];
  disabledReason: string;
};

export interface EscrowTransactionBuilder {
  createChallenge(terms: EscrowChallengeTerms): EscrowTransactionIntent;
  acceptAndFund(challengeId: string, stakeMist: bigint): EscrowTransactionIntent;
}

function assertTerms(terms: EscrowChallengeTerms) {
  if (terms.stakeMist <= BigInt(0)) throw new Error("Testnet stake must be greater than zero.");
  if (terms.stakeMist > MAX_WINNER_STAKE_MIST) throw new Error("Testnet stake is too large for an exact two-party payout.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(terms.termsHashHex)) throw new Error("Terms hash must be a 32-byte hex digest.");
  if (!SUI_ADDRESS.test(terms.opponent) || !SUI_ADDRESS.test(terms.outcomeAuthority)) throw new Error("Opponent and outcome authority must be 32-byte Sui addresses.");
  const opponent = terms.opponent.toLowerCase();
  const authority = terms.outcomeAuthority.toLowerCase();
  if (authority === `0x${"0".repeat(64)}` || authority === opponent) throw new Error("Outcome authority must be a non-zero, independent address.");
  if (terms.fundingDeadlineMs >= terms.outcomeDeadlineMs) throw new Error("Outcome deadline must be after funding deadline.");
}

/** Deliberately inert until a reviewed Testnet deployment has a package ID and explicit approval. */
export class DisabledEscrowTransactionBuilder implements EscrowTransactionBuilder {
  private readonly reason = "Escrow signing is disabled until the Move package is deployed, verified, and explicitly approved for Testnet.";
  createChallenge(terms: EscrowChallengeTerms): EscrowTransactionIntent {
    assertTerms(terms);
    return { network: ESCROW_NETWORK, function: "create", args: [terms], disabledReason: this.reason };
  }
  acceptAndFund(challengeId: string, stakeMist: bigint): EscrowTransactionIntent {
    if (!challengeId) throw new Error("Challenge ID is required.");
    if (stakeMist <= BigInt(0)) throw new Error("Testnet stake must be greater than zero.");
    return { network: ESCROW_NETWORK, function: "accept_and_fund", args: [challengeId, stakeMist], disabledReason: this.reason };
  }
}
