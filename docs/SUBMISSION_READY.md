# Hackathon submission readiness

Status date: 2026-10-31. This is an evidence-based status report, not an activation approval.

| Feature | Status | Evidence / limitation |
| --- | --- | --- |
| Tatum Sui Testnet reads | LOCAL LIVE PASS / DEPLOYMENT UNVERIFIED | Native TLS gRPC read-only integration verified the pinned package and publication transaction using server-only credentials. Current Vercel Production health is behind Vercel SSO (`302`), so deployed availability cannot be claimed until an authorized post-deploy check. |
| Walrus Mainnet recall | HISTORIC 10/10 PASS / DEPLOYMENT UNVERIFIED | `HACKATHON_EVIDENCE.md` records a verified 10/10 batch, blobs, receipts, and recall match; a local authenticated read-only readiness test also passed. Current Vercel Production health is behind SSO; no new write was attempted. |
| Wallet authentication | PASS | Sui personal-message challenge verification, single-use nonce consumption, HttpOnly session, and wallet/profile checks are covered by tests. |
| Invitation lifecycle | ISOLATED-PILOT ONLY | Creation, acceptance, cancellation, expiry, and immutable commitments require the explicit local disposable-Postgres gates. It is not enabled in production. |
| Sui Testnet escrow | CONTRACT/BUILDER PASS; EXECUTION DISABLED | Package `0x3ad668c9afb9fe8540c9a3567aaee1e637f6392d414be3611f137658ef238392`, transaction builders, deadline/actor checks, and Move tests exist. No app route signs, funds, broadcasts, settles, or refunds. |
| Agent insights | READ-ONLY PASS | Recall is rate-limited and wallet-session scoped. It is decoupled from invitation write freeze, but suppresses personalization unless a current immutable invitation proves the wallet binding. |
| Public MCP | PASS | The two anonymous read-only tools remain POST-only and separate from private authorization. |
| Private OAuth / MCP | DISABLED | No complete wallet-native authorization/token persistence, client-registration decision, or production consent/revocation activation exists. |

## Deployment-secret checklist

Set these only in the deployment secret manager; never commit or disclose their values:

- `TATUM_API_KEY`, `TATUM_SUI_NETWORK=testnet`, optional `TATUM_SUI_GRPC_ENDPOINT`
- `WALRUS_MEMORY_NETWORK=mainnet`, `WALRUS_MEMORY_ACCOUNT_ID`, `WALRUS_MEMORY_DELEGATE_KEY`, `WALRUS_MEMORY_RECEIPTS_PATH`, and the verified batch manifest path
- `WALRUS_MEMORY_WRITES_ENABLED=false`
- `STAKEMATE_MAINTENANCE_WRITE_FREEZE=true`
- `STAKEMATE_REMOTE_MCP_ENABLED=false`

After an approved deployment, use an authorized deployment session to run Tatum and Walrus health checks, then an authenticated, bounded Walrus account-readiness check. Record only status/results, not credentials or recalled content.

## Explicit approval boundaries

Do not enable invitation lifecycle flags, funding/signing/settlement paths, private MCP/OAuth, or Walrus writes. Each requires a reviewed activation plan. A new Walrus write additionally requires exact payload/digest, Mainnet confirmation, estimated cost, spending cap, and explicit written approval.
