# Settlement authority and oracle readiness

Status: simulation-only. `settlementSigningEnabled` and every broadcaster remain `false`.

## Exact trust boundary

Football-data.org and a separately licensed secondary provider supply observations, not settlement authority. The verification service checks immutable fixture ID, competition, kickoff, regulation-time scores, source identity/kind, provenance, and a correction window. It cannot prove providers are honest or independent beyond their declared identities.

The durable worker may lease and prepare a job only after database evidence and the policy gate approve it. The policy gate binds the accepted challenge digest, one expected challenge object, the pinned Testnet package/type, exact outcome authority, on-chain FUNDED state, read-only funding transaction confirmation, two declared source kinds, correction-window completion, and the derived `0`/`1`/`2` outcome. It emits an audit hash and a preview only.

The authority wallet is the final on-chain trust boundary. The Move contract checks its sender address, deadline, challenge state, and outcome range, but it cannot evaluate football evidence. Users, browsers, API routes, and AI agents are outside this boundary and receive no raw-transaction, key, signing, or broadcast interface.

## Options

| Option | Current-package compatibility | Security property |
| --- | --- | --- |
| Dedicated single authority with strict controls | Yes | One controlled key can settle; policy, HSM custody, monitoring, and pause reduce operational risk but cannot stop a stolen key. |
| Multisig/threshold authority | Conditional | The deployed contract stores one `address` and checks `tx_context::sender`. A Sui multisig account can be that address if its signed transaction presents that multisig sender; threshold policy is off-chain/account-layer, not contract-enforced. It needs a separate Testnet compatibility and custody review. |
| Upgraded oracle-aware contract | No redeployment-free path | A new package would be needed to verify threshold/oracle attestations or enforce multiple independent outcome authorizations on-chain. |

Recommendation: use a dedicated, managed single authority only for Testnet simulation after formal review; do not activate production settlement until a multisig-account proof-of-compatibility or a redeployed oracle-aware design is approved. The current package does not provide trustless football outcome verification.

## Protections available without redeployment

- Pin the exact package ID, module/type, shared challenge ID, terms hash, participants, authority, deadlines, and FUNDED state using read-only RPC evidence.
- Enforce two source kinds, correction/dispute windows, immutable evidence/audit records, one bound challenge per accepted hash, job leases, idempotency, and transaction-digest reconciliation.
- Restrict a future authority signer to `submit_outcome` against the pinned package and independently pre-approved challenge object. Keep separate limited gas funding, per-transaction amount/rate policies, an emergency key revocation path, and no inbound raw transaction API.
- Alert on policy rejection, unmatched package/hash/object/authority, unsuccessful or unexpected authority submissions, lease expiry, unconfirmed transaction digests, emergency pause, provider disagreement, and evidence correction.

These controls cannot prevent direct misuse of a fully compromised authority key. They also cannot establish that two apparently independent providers did not collude.

## Operator and audit design

The authority is a dedicated account, never a participant, employee browser wallet, or AI-agent identity. Store its key only in an audited managed signer/HSM with an allowlist and short-lived service authentication. The signer service accepts a typed policy approval reference only; it must reconstruct and verify the allowed Move target, object, exact outcome, package ID, and deadline itself. It must reject arbitrary serialized transactions, user/API/agent requests, and any approval missing immutable evidence.

Before a future broadcast, append a policy audit record containing commitment/evidence/decision hashes, object version/digest, funding transaction digest, signer policy version, and intended outcome. Afterward, reconcile the chain transaction before retrying. Emergency pause stops queue acquisition and signer authorization; disputes, corrected evidence, chain ambiguity, and provider outage escalate to human review.
