# StakeMate

StakeMate is a safety-first football prediction-duel prototype for the Tatum × Walrus Total Recall Hackathon. It uses real, server-side football-data.org fixture discovery, wallet-authenticated immutable duel terms, an isolated off-chain invitation pilot, read-only Sui evidence, and receipt-validated Walrus Memory recall.

It is not a betting, custody, or payment application. No UI, API, or MCP tool can sign a transaction, fund escrow, broadcast to Sui, settle a duel, or write Walrus Memory.

## What works

- Public, provider-backed upcoming PL, PD, and Champions League fixture discovery; only fresh future `TIMED` fixtures qualify for a draft.
- Slush/Sui Testnet wallet connection, readable personal-message authentication, permanent wallet-bound usernames, and wallet-switch isolation.
- An `localhost:3001`-only, disposable PostgreSQL pilot for canonical off-chain invitation creation, receipt, acceptance, rejection, cancellation, expiry, and read-only evidence. Acceptance is never funding.
- A frozen Mainnet Walrus batch with ten canonical manifest entries and ten completed receipts. Recall accepts a record only when its manifest entry, canonical digest, and completed receipt agree.
- Read-only Tatum Sui Testnet gRPC verification of the pinned escrow package and publication transaction. Production health now returns the verified Testnet chain identifier; authenticated Walrus Mainnet readiness also returns healthy with writes disabled.
- Wallet-scoped, read-only agent insights, with deterministic comparisons between no verified memory and receipt-verified memory. Recall continues while invitation writes are frozen, but it uses memory for personalization only when it can prove an immutable invitation belongs to the authenticated wallet.
- A local Claude Desktop-compatible MCP stdio server with public fixture/handle reads and short-lived, wallet-bound read/preview scopes. See [Claude Desktop MCP setup](docs/CLAUDE_DESKTOP_MCP.md).

## Deliberate limitations

- Walrus writes remain disabled (`WALRUS_MEMORY_WRITES_ENABLED=false`).
- Historical Walrus records are not shown as belonging to the current wallet unless they exactly match that wallet's current canonical invitation commitments. The existing historical batch must not be used to claim current wallet ownership or verified football outcomes.
- Remote MCP (`/api/mcp`) is disabled. It is not an official ChatGPT plugin and is not ready for public connector installation; a separately reviewed OAuth resource-server/consent deployment is required.
- Funding, signing, broadcast, escrow settlement, and invitation mutations outside the isolated pilot are disabled.
- Production provider health is verified after deployment secret configuration; a future `503` health response is a configuration failure, not a successful fallback.
- The durable evidence implementation is additive but not yet migrated or deployed: authenticated production insights remain unavailable until migration `0009` and the approved, private 10-record import have completed successfully. It never falls back to `/tmp`.

## Local setup

Use Node.js 22+, PostgreSQL 17 for the disposable pilot, and server-side secret injection. Start from the safe, secret-free [`.env.example`](.env.example) and the local-only [`.env.isolated-two-wallet-pilot.example`](.env.isolated-two-wallet-pilot.example). Never copy wallet keys, browser cookies, provider keys, Walrus delegate keys, or database URLs into browser variables, Git, terminal output, or screenshots.

```bash
npm ci
npm test
npx tsc --noEmit
npm run lint
npm run build
```

For the two-wallet pilot, follow the exact safeguards in [the isolated-pilot runbook](docs/ISOLATED_REAL_TWO_WALLET_PILOT.md). It must use its disposable loopback database and bind to `127.0.0.1:3001`; do not run these lifecycle flags in a deployed environment.

## Deployment architecture

Deploy a Node.js Next.js server behind HTTPS with a managed PostgreSQL instance that enforces TLS. Put all provider credentials, OAuth keys, and Walrus delegate credentials in the host secret manager. The production insight route uses the dedicated, read-only `STAKEMATE_WALRUS_EVIDENCE_DATABASE_URL` and reads only the approved `stakemate_walrus_manifests` and `stakemate_walrus_receipts` tables; it never reads an ephemeral filesystem journal or falls back to `DATABASE_URL`. Both evidence URLs must differ from `DATABASE_URL`. Apply reviewed additive migrations `0009`, `0010`, and `0011`; `0011` hard-pins the database itself to batch `590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f`. Provision the separate least-privilege roles, and perform the private operator import before exposing that route. Keep the app write freeze on and both invitation lifecycle gates off until a separately approved launch.

For multi-instance deployments, replace the local receipt file with a transactional shared receipt store and use a durable, rate-limited OAuth consent/revocation store before enabling remote MCP. The details and security requirements are in [Remote MCP deployment](docs/REMOTE_MCP_DEPLOYMENT.md) and [Integration setup](docs/INTEGRATION_SETUP.md).

## Demo and submission

Use [the demo checklist](docs/DEMO_CHECKLIST.md) to present the two-wallet flow, receipt-backed Walrus recall, local MCP pairing, and safety boundaries. The truthful requirement status is maintained in [Hackathon requirements](docs/HACKATHON_REQUIREMENTS.md).
