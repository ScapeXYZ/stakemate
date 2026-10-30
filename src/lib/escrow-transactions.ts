import { Transaction } from "@mysten/sui/transactions";
import { ESCROW_DEPLOYMENT, ESCROW_SIGNING_DISABLED_REASON, ESCROW_TARGETS } from "./escrow-config";
import { hashHexToBytes } from "./terms";
import { hashFootballDuelChallenge, type FootballDuelChallengeTerms } from "./football-duel-terms";

export type EscrowAction = keyof typeof ESCROW_TARGETS;
export type TransactionPreview = {
  network: "testnet";
  target: string;
  packageId: string;
  stakeMist?: bigint;
  challengeId?: string;
  addresses: readonly string[];
  deadlines: readonly bigint[];
  expectedStateChange: string;
  gasEstimate: "Unavailable until a separately approved simulation";
  signingDisabledReason: string;
};

type CreateArgs = { creator: string; opponent: string; stakeMist: bigint; termsHashHex: string; fundingDeadlineMs: bigint; outcomeDeadlineMs: bigint; outcomeAuthority: string };
type ChallengeArgs = { challengeId: string };

function requiredId(value: string, label: string) { if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be a 32-byte object ID.`); return value; }
function stake(value: bigint) { if (value <= BigInt(0) || value > ((BigInt(2) ** BigInt(64) - BigInt(1)) / BigInt(2))) throw new Error("Stake is outside the deployed contract's safe range."); return value; }
function requiredAddress(value: string, label: string) { if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be a 32-byte Sui address.`); return value.toLowerCase(); }

/** Parse only canonical decimal MIST; user-facing SUI decimals must be converted before this boundary. */
export function parseMistAmount(value: string) { if (!/^[1-9]\d*$/u.test(value)) throw new Error("Stake must be a positive base-unit integer."); return stake(BigInt(value)); }

/** Builds an unsigned, unexecuted Transaction only. Callers must never pass it to a signer yet. */
export function buildCreateChallenge(args: CreateArgs) {
  stake(args.stakeMist); hashHexToBytes(args.termsHashHex);
  if (args.fundingDeadlineMs >= args.outcomeDeadlineMs) throw new Error("Outcome deadline must be after funding deadline.");
  const creator = requiredAddress(args.creator, "creator"); const opponent = requiredAddress(args.opponent, "opponent"); const authority = requiredAddress(args.outcomeAuthority, "outcomeAuthority");
  if (creator === opponent) throw new Error("A creator cannot challenge itself.");
  if (authority === `0x${"0".repeat(64)}` || authority === creator || authority === opponent) throw new Error("Outcome authority must be a non-zero independent address.");
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(args.stakeMist)]);
  tx.moveCall({ target: ESCROW_TARGETS.create, arguments: [tx.pure.address(opponent), coin, tx.pure.vector("u8", hashHexToBytes(args.termsHashHex)), tx.pure.u64(args.fundingDeadlineMs), tx.pure.u64(args.outcomeDeadlineMs), tx.pure.address(authority), tx.object(ESCROW_DEPLOYMENT.clockObjectId)] });
  return { transaction: tx, preview: preview("create", { ...args }) };
}

/** Maps the accepted football-duel commitment to the deployed Move v1 arguments; still unsigned and inert. */
export function buildFootballDuelCreateChallenge(terms: FootballDuelChallengeTerms) {
  const fundingDeadlineMs = BigInt(Date.parse(terms.fundingDeadlineUtc)); const outcomeDeadlineMs = BigInt(Date.parse(terms.outcomeDeadlineUtc));
  if (fundingDeadlineMs <= BigInt(0) || outcomeDeadlineMs <= fundingDeadlineMs) throw new Error("Accepted duel deadlines are invalid.");
  const termsHashHex = hashFootballDuelChallenge(terms);
  return { ...buildCreateChallenge({ creator: terms.creatorAddress, opponent: terms.opponentAddress, stakeMist: BigInt(terms.stakeMist), termsHashHex, fundingDeadlineMs, outcomeDeadlineMs, outcomeAuthority: terms.outcomeAuthority }), termsHashHex };
}

/** Pure preflight only; the Move contract remains the authorization authority. */
export function assertEligibleActor(action: Exclude<EscrowAction, "create">, challenge: { creator: string; opponent: string; outcomeAuthority: string; state: number; fundingDeadlineMs: bigint; outcomeDeadlineMs: bigint }, actor: string, nowMs: bigint) {
  const sender = requiredAddress(actor, "actor");
  if (action === "acceptAndFund" && (sender !== challenge.opponent || challenge.state !== 0 || nowMs >= challenge.fundingDeadlineMs)) throw new Error("Only the opponent may fund an unexpired created challenge.");
  if (action === "submitOutcome" && (sender !== challenge.outcomeAuthority || challenge.state !== 1 || nowMs >= challenge.outcomeDeadlineMs)) throw new Error("Only the outcome authority may settle before outcome expiry.");
  if (action === "cancelUnfunded" && (sender !== challenge.creator || challenge.state !== 0)) throw new Error("Only the creator may cancel an unfunded challenge.");
  if (action === "refundExpiredFunding" && (challenge.state !== 0 || nowMs < challenge.fundingDeadlineMs)) throw new Error("Funding refund is available only after expiry.");
  if (action === "voidUnreportedOutcome" && (challenge.state !== 1 || nowMs < challenge.outcomeDeadlineMs)) throw new Error("Outcome void is available only after expiry.");
}

export function buildAcceptAndFund(args: ChallengeArgs & { stakeMist: bigint; expectedStakeMist: bigint }) {
  requiredId(args.challengeId, "challengeId"); stake(args.stakeMist); stake(args.expectedStakeMist); if (args.stakeMist !== args.expectedStakeMist) throw new Error("Funding coin must equal the challenge's exact stake.");
  const tx = new Transaction(); const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(args.stakeMist)]);
  tx.moveCall({ target: ESCROW_TARGETS.acceptAndFund, arguments: [tx.object(args.challengeId), coin, tx.object(ESCROW_DEPLOYMENT.clockObjectId)] });
  return { transaction: tx, preview: preview("acceptAndFund", args) };
}

export function buildSubmitOutcome(args: ChallengeArgs & { outcome: 0 | 1 | 2 }) { requiredId(args.challengeId, "challengeId"); const tx = new Transaction(); tx.moveCall({ target: ESCROW_TARGETS.submitOutcome, arguments: [tx.object(args.challengeId), tx.pure.u8(args.outcome), tx.object(ESCROW_DEPLOYMENT.clockObjectId)] }); return { transaction: tx, preview: preview("submitOutcome", args) }; }
export function buildCancelUnfunded(args: ChallengeArgs) { requiredId(args.challengeId, "challengeId"); const tx = new Transaction(); tx.moveCall({ target: ESCROW_TARGETS.cancelUnfunded, arguments: [tx.object(args.challengeId)] }); return { transaction: tx, preview: preview("cancelUnfunded", args) }; }
export function buildRefundExpiredFunding(args: ChallengeArgs) { requiredId(args.challengeId, "challengeId"); const tx = new Transaction(); tx.moveCall({ target: ESCROW_TARGETS.refundExpiredFunding, arguments: [tx.object(args.challengeId), tx.object(ESCROW_DEPLOYMENT.clockObjectId)] }); return { transaction: tx, preview: preview("refundExpiredFunding", args) }; }
export function buildVoidUnreportedOutcome(args: ChallengeArgs) { requiredId(args.challengeId, "challengeId"); const tx = new Transaction(); tx.moveCall({ target: ESCROW_TARGETS.voidUnreportedOutcome, arguments: [tx.object(args.challengeId), tx.object(ESCROW_DEPLOYMENT.clockObjectId)] }); return { transaction: tx, preview: preview("voidUnreportedOutcome", args) }; }

function preview(action: EscrowAction, args: CreateArgs | (ChallengeArgs & { stakeMist?: bigint; outcome?: 0 | 1 | 2 })): TransactionPreview {
  const descriptions: Record<EscrowAction, string> = { create: "Escrow creator's exact Testnet stake and share a CREATED challenge.", acceptAndFund: "Escrow opponent's exact stake and move the challenge to FUNDED.", submitOutcome: "Trusted authority resolves a funded challenge to a fixed participant or exact refunds.", cancelUnfunded: "Return the creator stake and void an unfunded challenge.", refundExpiredFunding: "Return the creator stake after funding expiry.", voidUnreportedOutcome: "Return both exact stakes after outcome expiry." };
  return { network: "testnet", target: ESCROW_TARGETS[action], packageId: ESCROW_DEPLOYMENT.packageId, stakeMist: "stakeMist" in args ? args.stakeMist : undefined, challengeId: "challengeId" in args ? args.challengeId : undefined, addresses: "opponent" in args ? [args.opponent, args.outcomeAuthority] : [], deadlines: "fundingDeadlineMs" in args ? [args.fundingDeadlineMs, args.outcomeDeadlineMs] : [], expectedStateChange: descriptions[action], gasEstimate: "Unavailable until a separately approved simulation", signingDisabledReason: ESCROW_SIGNING_DISABLED_REASON };
}
