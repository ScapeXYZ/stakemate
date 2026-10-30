# StakeMate escrow internal security review — Milestone 4.2

**Scope:** `contracts/stakemate`, its Move scenario tests, the inert TypeScript transaction-intent layer, and wallet funding policy. This is an internal engineering review, not an independent audit.

## Method and evidence

The review traced each callable lifecycle transition: `create`, `accept_and_fund`, `cancel_unfunded`, `refund_expired_funding`, `submit_outcome`, and `void_unreported_outcome`. It checked every sender-derived authorization decision, state transition, balance withdrawal, fixed transfer destination, and deadline comparison. Scenario tests exercise expected aborts and successful conservation paths. The Testnet CLI reports the active environment as `testnet`.

## Findings

| Severity | Finding | Evidence and disposition |
| --- | --- | --- |
| High (fixed) | A participant could have been selected as outcome authority and could award itself the pool. | `create` now rejects zero, creator, and opponent authorities with `E_INVALID_OUTCOME_AUTHORITY`; dedicated scenario tests cover creator and zero authority. A third-party authority remains trusted by design. |
| Medium (fixed) | A stake above half `u64::MAX` could make the winner-path balance join overflow after both deposits. | `create` now rejects a stake above `u64::MAX / 2` with `E_STAKE_TOO_LARGE`; regression test covers the first unsafe value. |
| Informational | Terms hash proves only commitment to 32 bytes. It cannot establish canonical fixture terms, sports results, or consent. | Contract checks digest length only. Canonicalization, display, and off-chain evidence remain product responsibilities. |
| Informational | Outcome authority is centralized and may report an incorrect outcome before deadline. | Fixed recipient selection limits damage to one of the two participants, but no oracle/dispute evidence is on-chain. External review of authority operations is required. |
| Informational | Expiry recovery is caller-driven. | At the exact deadline the resolving path closes and the relevant public refund/void path opens. A participant or watchdog must submit it; there is no autonomous Sui execution. |

## State-transition conclusions

- `create` consumes exactly one non-zero creator coin and creates a shared challenge in `CREATED`; neither participant nor critical terms can subsequently change.
- `accept_and_fund` accepts only the immutable opponent, exactly once, before the funding deadline, with the exact configured stake. State advances to `FUNDED` only after the linear balance is joined.
- An unfunded challenge can only return its creator balance: before expiry by its creator, at/after expiry by any caller to the immutable creator address.
- A funded challenge can only be resolved before expiry by its immutable independent authority. Outcome values are limited to void/tie, creator win, and opponent win. Winner addresses are selected internally, never from caller input.
- At/after outcome expiry, any caller can only void and refund the two immutable participant addresses. Both terminal states reject all later funding, settlement, and refund attempts.

## Deadline and clock assumptions

`Clock` is borrowed read-only in production. Sui consensus supplies its timestamp; contract callers cannot set it. `clock::set_for_testing` occurs only in test-only code to prove boundaries. Funding and authority settlement require `now < deadline`; public recovery requires `now >= deadline`. Thus, at equality, no competing success path exists. Transaction ordering for the shared object is consensus-determined.

## Residual risks requiring external review

- Move/security audit of this exact source and compiled dependency set.
- Authority key custody, availability monitoring, and incident/dispute policy.
- Canonical terms-hash specification and independently verifiable off-chain evidence.
- Testnet operational rehearsal: shared-object contention, gas economics, event indexing, wallet UX, and recovery watchdogs.
- No Mainnet suitability conclusion is made by this review.
