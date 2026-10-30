# StakeMate Testnet escrow security model

## Scope and non-goals

`contracts/stakemate` is a **Testnet-only, un-deployed** Sui Move package. It accepts only valueless Testnet `Coin<SUI>` and has no frontend transaction path. It is not a Mainnet contract, betting product, or a substitute for legal, responsible-gaming, or security review.

## Contract model

Each newly created shared `Challenge` object is its challenge ID. It records only the protocol minimum:

- two immutable participant addresses;
- exact stake in MIST per participant;
- a 32-byte immutable terms hash, calculated from canonical off-chain terms;
- immutable funding and outcome deadlines;
- immutable outcome-authority address;
- two SUI balances and terminal state.

No names, sports fixtures, predictions, personal details, wallet private keys, or Walrus content are stored on-chain. Those details must remain off-chain and the terms hash must be independently reproducible by both participants.

## Lifecycle and rules

1. The creator calls `create` with exactly its stake before the funding deadline.
2. Only the named opponent can call `accept_and_fund`, once, with exactly the same stake before that deadline.
3. Before acceptance, only the creator may call `cancel_unfunded`; after missed funding, anyone may call `refund_expired_funding`, but payout is fixed to the creator.
4. While funded and before the outcome deadline, only the immutable, non-zero authority (which cannot be either participant) can submit: `1` creator win, `2` opponent win, or `0` tie/void. Win pays the complete two-stake pool to the designated participant; tie/void returns exact stakes to both.
5. Once the outcome deadline passes without a report, anyone may call `void_unreported_outcome`; the contract returns exact stakes to the two immutable participants.

There is no post-funding unilateral participant cancellation. A dispute is handled off-chain by the named authority before the outcome deadline; if no authoritative resolution arrives in time, the deterministic on-chain result is a void/refund. This avoids an arbitrary caller choosing a recipient.

## Invariants

- Participants, stake, terms hash, deadlines, and authority cannot change after creation.
- A challenge begins with exactly one creator stake and can receive exactly one matching opponent stake.
- Only `FUNDED` challenges may settle; every settlement sets a terminal state before returning funds.
- Terminal states contain zero escrow balance and cannot be paid/refunded again.
- Each non-void settlement transfers exactly `2 * stake`; each void/refund transfers exactly the deposited participant balances.
- The stake is no more than half of `u64::MAX`, so the exact two-stake winner payout cannot overflow when balances are joined.
- The transaction sender is never used as a payout destination except where it is already the immutable participant.

## Threat model and trust assumptions

The contract protects against an unrelated caller funding, settling, claiming a refund, or redirecting funds. It uses the Sui `Clock` for deadline comparisons and a shared object for consensus-ordered lifecycle changes.

The **outcome authority is trusted** to report a correct outcome and is a single availability/trust point. It is not an oracle, not decentralized, and has no upgrade or administrator override. If compromised or wrong, it can choose a winner before the outcome deadline. If unavailable, users recover their original stakes only after that deadline. The 32-byte terms hash proves only commitment to supplied bytes, not truth of sports data or the fairness of off-chain dispute handling.

## Required review before Testnet deployment

1. Install a Sui CLI matching Testnet and run the package build, lint, scenario tests, and coverage.
2. Use a Sui CLI matched to the intended Testnet release. Sui 1.83 automatically resolves the framework; do not reintroduce a conflicting explicit framework Git dependency in `Move.toml`.
3. Have an independent Move security review validate object ownership, deadline boundaries, coin conservation, event schema, and every abort path.
4. Agree the authority operational policy, dispute process, key rotation/replacement policy (which cannot alter existing challenges), and terms-hash canonicalization format.
5. Deploy only after explicit approval; follow `docs/TESTNET_DEPLOYMENT_RUNBOOK.md`, then set a verified package ID outside source control and enable no signing path until client integration is separately reviewed.

## Known limitations

- No oracle or trustless sports-result verification.
- No on-chain dispute evidence or appeals mechanism.
- No durable external receipt/indexer integration.
- Shared-object consensus can affect throughput/cost.
- Resolution remains centralized in the named authority. Requiring it to be independent prevents a participant from self-awarding, but does not make it truthful or available.
- Funds are recoverable after the relevant deadline, but recovery is caller-driven; a participant or watchdog must submit the refund/void transaction after expiry.
- This is internally tested code, not an independent security audit.
