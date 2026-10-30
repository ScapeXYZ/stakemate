# Walrus Memory hackathon evidence workflow

Target date: **November 10, 2026**. This is a runbook for an explicitly approved Mainnet Memory operator; it does not authorize a write.

## Provider verification log

On 2026-10-28, a local operator-provided `TATUM_API_KEY` was confirmed present without being displayed. The legacy Testnet JSON-RPC URL returned HTTP `404`, so it is not used as evidence. The server-only native TLS gRPC adapter then completed read-only calls to Tatum's Testnet gateway using `x-api-key` metadata and official Sui generated protobuf messages. `GetServiceInfo` returned `chain: testnet` and chain identifier `69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD`. `GetObject` verified package `0x3ad668c9afb9fe8540c9a3567aaee1e637f6392d414be3611f137658ef238392` as a `package` containing module `challenge_escrow`. `GetTransaction` verified publish transaction `7WoZafsGnmWtqX91PHwX3vBAyMfU9bXQG9iNU7AEEDVf` with execution status `success`. These are read-only provider observations, not an independent contract audit or authorization to enable signing.

On 2026-10-28, `WALRUS_MEMORY_ACCOUNT_ID` was present, selected Mainnet, and exactly matched the operator-supplied public account object ID `0x5a7b42f72bba73964fbda17036e60b971250746df3ddb32655f00043e404213b`; `WALRUS_MEMORY_WRITES_ENABLED` was false. The required `WALRUS_MEMORY_DELEGATE_KEY` environment variable was absent, so the authenticated read-only readiness call stopped locally with `NOT_CONFIGURED` before constructing a MemWal client or contacting the relayer. This does **not** verify that the account exists on Mainnet or that any delegate is authorized. No Walrus recall, write, paid storage action, signing, or transaction was attempted.

Later on 2026-10-28, the delegate variable was configured server-side without being displayed. With writes still false, the authenticated readiness check completed against the configured Mainnet relayer and returned `{ "ok": true, "network": "mainnet", "authenticated": true }`. The check calls SDK `health()` plus a bounded `recall()` and discards recalled content. This verifies that the configured account/delegate pair was accepted for the supported read-only operation; it does not prove write permission, pricing/funding readiness, record durability, or any completed Walrus write. No `remember` call, paid storage action, signing, or transaction was performed.

## Evidence standard

For each of at least ten distinct, meaningful records, retain an immutable operator evidence row containing: canonical record JSON, SHA-256 digest, schema record ID, accepted `jobId`, final `blobId`, accepted/completed timestamps, namespace, relayer URL, recall-verification timestamp/query, and the durable receipt-journal location. Do not count retries, duplicate digests, fabricated records, or a merely accepted job as distinct completed writes.

## Candidate meaningful records

Use actual lifecycle events only, such as different on-chain challenge creations, acceptances, authority outcomes, expiry refunds, and reviewed reputation insights. Each must validate against `src/lib/memory/records.ts`; do not invent fixtures, results, evidence references, participants, or reputation claims to reach ten.

## Milestone 7.2 write preparation (no write performed)

The repository includes ten **proposed-unwritten** `reputation.insight` records in `src/lib/memory/proposed-evidence.ts`. They are a dry-run plan, not Walrus records or receipts: verified Testnet deployment, Move test evidence, Testnet-only frontend policy, three Tatum verification observations, two Walrus readiness observations, wallet funding-disabled policy, and write-gating policy. They are intentionally project-evidence records rather than fabricated sports challenges, fixtures, outcomes, or user reputation claims.

The local dry-run on 2026-10-28 validated all 10 schema-v1 canonical records: 10 unique SHA-256 digests, 0 duplicates, and 3,792 total canonical UTF-8 bytes. It created no MemWal client, no provider job, no receipt-journal entry, and no storage write. Its expected post-submission journal shape is deliberately a template (`prepared` locally, then `accepted` with a provider-assigned job ID, then `completed` only after a non-empty blob ID); it is not evidence of a receipt.

### Cost and funding gate

MemWal does not expose a non-spending Mainnet account-balance, capacity, or price-quote method. The authenticated `health()`/`recall()` readiness result verifies relayer acceptance, not who funds a write or whether capacity is available. Official Walrus documentation says a blob write has WAL storage/write fees and SUI gas costs, with price/capacity depending on encoded size and epoch duration. It directs operators to `walrus info`, the Cost Calculator, or `walrus store --dry-run` for current non-submitting estimates. The current public documentation describes storage as USD-pegged at $0.023/GB/month, but that is not a quote for this Memory relayer workflow and must not be treated as one. See [Walrus Storage Costs](https://docs.wal.app/docs/system-overview/storage-costs), [Walrus Memory funding](https://docs.wal.app/walrus-memory/fundamentals/architecture/funding-storage), and [MemWal quick start](https://github.com/MystenLabs/walrus-memory/blob/dev/docs/getting-started/quick-start.md).

Before the first genuine write, an operator must: (1) obtain written approval for one exact proposed record and a spending cap, (2) confirm with the configured hosted relayer whether it sponsors WAL and SUI or requires a funded publisher/account, (3) capture current Walrus CLI/Calculator estimates for the selected payload and retention, (4) configure a restricted durable `WALRUS_MEMORY_RECEIPTS_PATH`, and (5) run as exactly one writer. Keep `WALRUS_MEMORY_WRITES_ENABLED=false` until all five are complete.

### Receipt and concurrency limits

The file receipt journal uses atomic replacement and the service serializes writes inside one Node.js process. It persists a `prepared` intent before calling `remember()` and reuses the canonical digest as the SDK idempotency key, reducing the crash window between remote acceptance and local journaling. A persisted `accepted` job must be reconciled by job status after a crash or timeout; it is never counted as completed automatically. This remains unsuitable for multiple processes/hosts: independent writers can race despite atomic file replacement. Use a transactional shared receipt store with a unique digest constraint and distributed lease before any multi-instance deployment.

## Milestone 7.3 final pre-write audit (no write performed)

The current local environment does **not** configure `WALRUS_MEMORY_RECEIPTS_PATH`. It is therefore not ready for a genuine write: no claim is made about durable storage, filesystem permissions, or Git/public-asset exclusion. The service now refuses future enabled writes unless the path is absolute and outside the repository, a non-secret `WALRUS_MEMORY_WRITE_APPROVAL_ID` is present, and the first `prepared` journal entry can be persisted before `remember()` is called.

Milestone 7.4 supersedes the first sentence above: `WALRUS_MEMORY_RECEIPTS_PATH` is now configured privately. A non-mutating host-level check confirmed it is absolute, outside the repository, its parent has mode `0700`, and the active host user can write there. The journal file does not yet exist, which is expected because no write or receipt preparation has been authorized. The configured location itself was not created or modified during this verification.

Mocked crash-recovery tests cover all journal states without contacting the relayer: a `prepared` receipt resubmits with the same SHA-256 idempotency key; an `accepted` receipt polls its recorded job without calling `remember()` again; and a `completed` receipt is deduplicated. Process-wide locking prevents concurrent duplicate submissions in one Node.js process, including across service instances. It is not a distributed lock, and the file store is not safe across hosts/processes.

### Single-record operator procedure

1. Select exactly one of the proposed-unwritten project-evidence records and record its UUID, canonical digest, retention decision, and a maximum approved spend in an external approval ticket.
2. Confirm the managed-relayer usage limits and retention policy that apply to this account. Official Walrus documentation identifies `https://relayer.memory.walrus.xyz` as the Foundation-managed Production endpoint and says its server wallet covers storage costs; it may apply usage limits. The general Memory funding documentation describes this relayer/publisher pattern as sponsoring WAL and SUI for the agent. Authenticated recall does not reveal the account's remaining quota or guarantee acceptance of a write.
3. Run the official Walrus CLI/Cost Calculator estimate for the selected payload and chosen retention. Do not proceed if the result exceeds the external approval cap or if the funding party cannot be identified.
4. Provision a host-owned, restricted, absolute receipt path outside the repository, verify its persistence/backup policy, and set the non-secret approval ID. Keep write mode false during this check.
5. Obtain a second operator's explicit approval to set `WALRUS_MEMORY_WRITES_ENABLED=true` for one process and one record only. The service first persists `prepared`, then records the provider job ID as `accepted`, and only counts the record after `waitForRememberJob()` returns a non-empty blob ID.
6. Immediately run a bounded, specific recall verification; retain its timestamp/query and the completed receipt privately. Reset write mode to false before any additional record is considered.

No strict monetary ceiling can be enforced by this application before submission: MemWal has no available-price/capacity method, and the managed relayer's live quota/limit decision is external to the SDK. The application can enforce the approval-ID and one-process gates, but the human/operator capacity cap remains procedural until the relayer exposes an enforceable quota.

### Managed relayer funding evidence

The configured service defaults to `https://relayer.memory.walrus.xyz`, which the official Managed Relayer page identifies as the Walrus Foundation Production endpoint. That page says the server wallet covers Walrus storage fees and may impose usage limits; it is provided as a public good without an SLA. The Relayer Overview says the server wallet covers storage costs and documents rate limiting and a storage quota in the relayer design. The funding architecture describes a Walrus Memory relayer acting as a publisher, where the sponsor pays WAL and SUI rather than the SDK client. Confirmed: StakeMate's delegate key does not need to sign or fund a normal managed-relayer `remember()` flow. Unknown: the exact current quota, rate-limit state, retention duration, and whether the next payload will be accepted. See [Managed Relayer](https://docs.wal.app/walrus-memory/relayer/public-relayer), [Relayer Overview](https://docs.wal.app/walrus-memory/relayer/overview), and [Memory funding](https://docs.wal.app/walrus-memory/fundamentals/architecture/funding-storage).

### Selected one-record review candidate (not approved, not submitted)

- Record type/status: `reputation.insight` / `proposed-unwritten`
- UUID: `010f25e6-b030-42aa-a4dc-06ee545f458b`
- Exact content: `StakeMate's challenge_escrow package was source-verified on Sui Testnet.`
- SHA-256 of canonical schema-v1 JSON: `65452b0b36fcf8f514ac55246bd9a77a13f37f0eded87230176a321750f1c89d`
- Canonical UTF-8 size: `346` bytes

This is actual project evidence, not a challenge, fixture, prediction, outcome, user identity, or a Walrus receipt. It remains ineligible for submission until the operator completes the six-step procedure above and explicitly authorizes this exact UUID/digest.

## Milestone 7.5 genuine Mainnet write evidence

On 2026-10-29, the operator-approved record above was submitted exactly once to the Walrus Foundation managed Mainnet relayer with approval ID `STAKEMATE-WALRUS-20261028-001`. The local receipt journal first persisted `prepared`, then recorded provider job ID `2c3daee4-3bfb-4c9e-a07c-210d49fd1245` as `accepted`. The first bounded completion wait did not complete, so no second `remember()` request was made. A later explicit reconciliation only polled that recorded job and completed the receipt with non-empty blob ID `nnH9M1xnrSE4WDvXxuBktpSEcmXarWzDa39r86Sq5uQ`.

One bounded read-only recall verification was attempted with a specific package-verification query. It returned one result but did not match the completed blob ID and exact record text, so recall verification is **not confirmed** and no further recall was retried in this operation. The completed provider receipt and blob ID are genuine evidence of this single write; this result does not count as independently recalled verification. `WALRUS_MEMORY_WRITES_ENABLED` remained false in `.env.local` before and after the controlled process.

## Operator sequence

1. Confirm Mainnet Memory fees/funding and obtain written operator approval.
2. Create/select one dedicated Walrus Memory account and register a dedicated Ed25519 delegate key through the official Playground or account-contract flow. Store the returned account object ID and private delegate key only in the host secret manager.
3. Set Mainnet credentials plus `WALRUS_MEMORY_RECEIPTS_PATH` on durable restricted storage. Keep `WALRUS_MEMORY_WRITES_ENABLED=false` initially.
4. Call the public health and authenticated account-readiness routes. Record only their safe status codes; never record secrets or recalled plaintext in public evidence.
5. After approval, enable writes in the server environment. Submit one genuine record at a time. Confirm the journal records `accepted`, then wait for `completed` with a non-empty `blobId`.
6. Use a bounded, specific `recall` query to verify each completed record. Preserve the verification result reference privately and update the evidence row.
7. At ten completed, distinct digests, export a redacted evidence manifest. It must contain no delegate keys, private keys, recalled sensitive text, or fabricated transaction claims.

## Recovery and stop conditions

If a journal contains `accepted` without `completed`, stop counting it and use the job ID with the official SDK/relayer support flow to verify its final state. If account readiness fails, fees are uncertain, the durable store is unavailable, or any record cannot be independently verified, keep writes disabled and report the blocker. The receipt file is restart-safe for one process; a multi-instance deployment requires a transactional shared `ReceiptStore` before writes.
