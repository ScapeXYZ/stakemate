/** Verified Sui Testnet deployment. This is intentionally not configurable from browser input. */
export const ESCROW_DEPLOYMENT = {
  network: "testnet",
  packageId: "0x3ad668c9afb9fe8540c9a3567aaee1e637f6392d414be3611f137658ef238392",
  module: "challenge_escrow",
  publishTransaction: "7WoZafsGnmWtqX91PHwX3vBAyMfU9bXQG9iNU7AEEDVf",
  clockObjectId: "0x6",
  graphqlUrl: "https://graphql.testnet.sui.io/graphql",
} as const;

export const ESCROW_MODULE = `${ESCROW_DEPLOYMENT.packageId}::${ESCROW_DEPLOYMENT.module}`;
export const CHALLENGE_TYPE = `${ESCROW_MODULE}::Challenge`;
export const ESCROW_TARGETS = {
  create: `${ESCROW_MODULE}::create`,
  acceptAndFund: `${ESCROW_MODULE}::accept_and_fund`,
  submitOutcome: `${ESCROW_MODULE}::submit_outcome`,
  cancelUnfunded: `${ESCROW_MODULE}::cancel_unfunded`,
  refundExpiredFunding: `${ESCROW_MODULE}::refund_expired_funding`,
  voidUnreportedOutcome: `${ESCROW_MODULE}::void_unreported_outcome`,
} as const;

/** Participant transactions are deliberately Testnet-only. Mainnet is not a configured dApp Kit network. */
export const ESCROW_SIGNING_DISABLED_REASON = "Sui Mainnet is disabled. Connect a Testnet wallet to sign this transaction.";
