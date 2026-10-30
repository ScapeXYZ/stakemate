# Durable settlement worker (inactive)

`0004_durable_settlement_worker.sql` is an unapplied follow-on migration. It adds four server-only structures:

- `stakemate_result_evidence` is append-only, binds each source record to the committed football fixture, and records regulation-time scores, provenance, timestamps, a SHA-256 evidence hash, and an optional correction predecessor.
- `stakemate_settlement_decisions` is append-only. Only a verified decision (creator `1`, opponent `2`) or a reviewed void decision (`0`) can feed a job after its correction window.
- `stakemate_settlement_jobs` is the mutable, one-job-per-invitation operational queue. It records the funded Move challenge object ID, expected outcome, idempotency key, attempts, lease, transaction digest, and confirmation state. It contains no signing material.
- `stakemate_settlement_audit` is append-only. `stakemate_settlement_control` is the single, database-backed emergency pause.

The server-only durable adapter claims one eligible job in a PostgreSQL transaction using `FOR UPDATE SKIP LOCKED`. It increments an attempt and sets a short lease atomically. Before preparing an unsigned `submit_outcome` transaction it locks the job again and checks its lease owner, the final decision, exact Move outcome, and correction deadline.

An expired lease without a transaction digest becomes `retry_wait` using bounded backoff. An expired lease with a digest becomes `broadcast_pending` and is never retried until a chain-status reconciliation proves it is `not_found`. A confirmed receipt becomes terminal. This prevents ambiguous outcomes from generating a second settlement transaction.

The adapter has no signer, broadcaster, scheduler, or wallet credentials. It is disabled by default, and its current preparation path always records `AUTOMATION_SIGNING_AND_BROADCAST_DISABLED`. The mock receipt method exists only for disposable integration testing.

## Future operations

A separately approved scheduler may invoke the worker under a dedicated server service identity. It should run frequently enough to renew leases before expiry, emit metrics for lease expiry, retry backlog, paused state, unconfirmed digests, provider outages, and correction/dispute queues, and alert operators on any terminal failure or stalled reconciliation.

The future settlement authority should be a narrowly permissioned operational signer held by a managed key system with transaction-policy limits, audit trails, and an emergency revocation path. It must be distinct from application users and AI agents. Agents can prepare information only; they cannot access key material, change verified decisions, unpause the worker, or submit payouts.

Disputes, conflicting/corrected evidence, unavailable providers, and ambiguous chain results stay out of automatic settlement. Operators pause the queue, preserve the append-only evidence and audit trail, reconcile the specific Move challenge on-chain, and require a documented human review before any recovery action. No scheduler or execution gate is enabled in this repository.
