# Hackathon submission readiness

Status date: 2026-10-31. This is an evidence-based status report, not an activation approval.

| Feature | Status | Evidence / limitation |
| --- | --- | --- |
| Tatum Sui Testnet reads | PRODUCTION PASS | Deployment `dpl_BKPsF4YQpZWvq9BfjGHtt3wzAMSj` returned `network: testnet` and the expected chain identifier through an authenticated Vercel read-only health check. Local live integration also verified the pinned package and successful publication transaction sequentially. |
| Walrus Mainnet recall | HISTORIC 10/10 PASS / PRODUCTION INSIGHTS BLOCKED | The private verifier and completed receipt journal were previously rechecked at 10/10 on 2026-10-31; Production `health` and authenticated bounded `account` readiness passed. The implementation now has an additive PostgreSQL manifest/receipt migration and conflict-safe private import, but neither is applied to Production, so wallet insight recall correctly fails closed rather than using Vercel `/tmp`. |
| Wallet authentication | PASS | Sui personal-message challenge verification, single-use nonce consumption, HttpOnly session, and wallet/profile checks are covered by tests. |
| Invitation lifecycle | ISOLATED-PILOT ONLY | Creation, acceptance, cancellation, expiry, and immutable commitments require the explicit local disposable-Postgres gates. It is not enabled in production. |
| Sui Testnet escrow | CONTRACT/BUILDER PASS; EXECUTION DISABLED | Package `0x3ad668c9afb9fe8540c9a3567aaee1e637f6392d414be3611f137658ef238392`, transaction builders, deadline/actor checks, and Move tests exist. No app route signs, funds, broadcasts, settles, or refunds. |
| Agent insights | IMPLEMENTED / PRODUCTION BLOCKED | Recall is rate-limited and wallet-session scoped, decoupled from invitation write freeze, and suppresses personalization unless a current immutable invitation proves the wallet binding. An authenticated production check requires the un-applied durable evidence migration/import and a real wallet session. |
| Public MCP | PASS | The two anonymous read-only tools remain POST-only and separate from private authorization. |
| Private OAuth / MCP | DISABLED | No complete wallet-native authorization/token persistence, client-registration decision, or production consent/revocation activation exists. |

## Deployment-secret checklist

Set these only in the deployment secret manager; never commit or disclose their values:

- `TATUM_API_KEY`, `TATUM_SUI_NETWORK=testnet`, optional `TATUM_SUI_GRPC_ENDPOINT`
- `DATABASE_URL` for server-only PostgreSQL reads; `STAKEMATE_MIGRATION_DATABASE_URL` only in the protected migration/import environment
- `WALRUS_MEMORY_NETWORK=mainnet`, `WALRUS_MEMORY_ACCOUNT_ID`, and `WALRUS_MEMORY_DELEGATE_KEY`. Do not configure a production filesystem manifest or receipt path for insights.
- `WALRUS_MEMORY_WRITES_ENABLED=false`
- `STAKEMATE_MAINTENANCE_WRITE_FREEZE=true`
- `STAKEMATE_REMOTE_MCP_ENABLED=false`

After an approved deployment, use an authorized deployment session to run Tatum and Walrus health checks, then an authenticated, bounded Walrus account-readiness check. Record only status/results, not credentials or recalled content.

## Explicit approval boundaries

Do not enable invitation lifecycle flags, funding/signing/settlement paths, private MCP/OAuth, or Walrus writes. Each requires a reviewed activation plan. A new Walrus write additionally requires exact payload/digest, Mainnet confirmation, estimated cost, spending cap, and explicit written approval.
