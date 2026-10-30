# Verified football result and settlement foundation

Settlement is not enabled. This foundation is mock-only and creates unsigned transaction intents only; it has no scheduler, signer, broadcaster, database migration, or network write.

## Evidence and correction rules

The committed provider fixture ID, competition code, and kickoff must match every evidence item exactly. A final result needs two distinct source identities and two distinct source kinds (for example, the primary provider plus a licensed secondary source). Repeated reads of football-data.org are never independent confirmation. Scores must be explicit regulation-time scores; extra-time and penalty information is ignored.

The default correction window is 60 minutes after the latest matching independent observation (configurable only from 15 minutes to seven days). Before it expires the state is `awaiting_correction`. Missing evidence is `pending_evidence`; provider outage is `unavailable`; conflicting scores, reschedules, corrections, postponements, and suspensions are `disputed`; abandonment/cancellation is `void_pending` for manual review. None of these states can settle automatically.

Evidence is designed for immutable persistence: source identity/type, provenance, provider timestamp, retrieval timestamp, regulation scores, lifecycle status, and deterministic evidence hash. A future reviewed migration must add an append-only evidence/job store with retention policies consistent with provider licensing.

## Settlement mapping and Move limits

After `verified`, the actual 1X2 result maps to Move outcome `1` for the creator’s selected result, `2` for the opponent’s selected result, or `0` when the third unselected result occurs. The deployed contract distributes the combined exact stake for 1/2 and refunds both exact stakes for 0. Fees are not configured or deducted by this foundation.

The local source accepts only a FUNDED challenge, immutable authority, and outcome 0/1/2. It can build an unsigned `submit_outcome` transaction. Milestone 7.23 verified source/package bytecode correspondence on Testnet using Sui `verify-source`; see `SUI_ESCROW_ATTESTATION.md`. This is an attestation, not activation authority: signing and broadcast remain disabled.

## Future worker operations

A durable worker must select only funded, unsettled rows using `SELECT ... FOR UPDATE SKIP LOCKED`, acquire a lease, append evidence, write a deterministic idempotency key, and prepare an unsigned transaction after the correction window. A separately authorized operational signer would need a gas-funded authority wallet, broadcast monitoring, chain-object re-read, transaction digest reconciliation, and bounded retry/backoff. Broadcast failures remain `broadcast_pending` until on-chain state proves success or a manual reviewer resolves it.

Emergency pause stops all job acquisition. Manual review handles disputed/corrected/suspended fixtures and may select only contract-supported void/refund after documented authorization. Users and AI agents cannot submit outcomes, alter evidence, choose payout recipients, or trigger a transaction.
