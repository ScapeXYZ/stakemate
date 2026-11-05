# StakeMate

StakeMate is a safety-first football prediction-duel prototype for the Tatum × Walrus Total Recall Hackathon. It uses real, server-side football-data.org fixture discovery, wallet-authenticated immutable duel terms, an isolated off-chain invitation pilot, read-only Sui evidence, and receipt-validated Walrus Memory recall.

It is not a betting, custody, or payment application. Testnet participants may explicitly approve their own create/funding transactions in a browser wallet. StakeMate never receives their keys. Automatic settlement broadcasting and Walrus writes remain disabled pending separate operator authorization and signer-custody review.

## What works

- Public, provider-backed upcoming PL, PD, and Champions League fixture discovery; only fresh future `TIMED` fixtures qualify for a draft.
- Slush/Sui Testnet wallet connection, readable personal-message authentication, permanent wallet-bound usernames, and wallet-switch isolation.
- Canonical invitation creation/acceptance is guarded by explicit server-side lifecycle gates. An accepted invitation supplies the only terms the browser can use to create a linked Sui Testnet escrow; it is then registered and opponent funding is server-attested from the confirmed chain transaction. No UI reports enrollment or attestation when either server operation fails.
- A frozen Mainnet Walrus batch with ten canonical manifest entries and ten completed receipts. Recall accepts a record only when its manifest entry, canonical digest, and completed receipt agree.
- Read-only Tatum Sui Testnet gRPC verification of the pinned escrow package and publication transaction. Production health now returns the verified Testnet chain identifier; authenticated Walrus Mainnet readiness also returns healthy with writes disabled.
- Testnet browser-wallet challenge creation and exact opponent funding against the pinned `challenge_escrow` package. The immutable third-party outcome authority is configured as a public build-time address; participant keys are never sent to StakeMate.
- Dual-source settlement verification: football-data.org is the primary source and Sportmonks Football API v3 is selected when its separately configured server-only token is present. Both must identify the same teams and kickoff and return matching official `FT` regulation-time scores; otherwise the result remains unavailable or disputed.
- Wallet-scoped, read-only agent insights, with deterministic comparisons between no verified memory and receipt-verified memory. Recall continues while invitation writes are frozen, but it uses memory for personalization only when it can prove an immutable invitation belongs to the authenticated wallet.
- A local Claude Desktop-compatible MCP stdio server with public fixture/handle reads and short-lived, wallet-bound read/preview scopes. See [Claude Desktop MCP setup](docs/CLAUDE_DESKTOP_MCP.md).

## Deliberate limitations

- Walrus writes remain disabled (`WALRUS_MEMORY_WRITES_ENABLED=false`).
- Historical Walrus records are not shown as belonging to the current wallet unless they exactly match that wallet's current canonical invitation commitments. The existing historical batch must not be used to claim current wallet ownership or verified football outcomes.
- Remote MCP (`/api/mcp`) is disabled. It is not an official ChatGPT plugin and is not ready for public connector installation; a separately reviewed OAuth resource-server/consent deployment is required.
- Automatic settlement broadcast remains disabled. StakeMate can only queue/simulate a decision after dual-source final-result verification and its correction window; a reviewed managed signer, explicit Testnet broadcast authorization, database migration/activation, and an authenticated scheduler are still required before any outcome can be submitted. Cloudflare holds no signer key and only invokes the bounded authenticated cron endpoint.
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

Submission materials are ready in the repository:

- [Redacted evidence manifest](docs/HACKATHON_EVIDENCE_MANIFEST.md) — the October 31, 2026 verification records 10 completed Mainnet receipts, 10 distinct blob IDs, aggregator HTTP 200 retrieval evidence, and 10 canonical recall matches. Private receipts remain outside Git.
- [Technical blog](docs/HACKATHON_TECHNICAL_BLOG.md) and [2–3 minute demo narration](docs/HACKATHON_DEMO_SCRIPT.md).
- [Final submission checklist](docs/HACKATHON_SUBMISSION_CHECKLIST.md), including the honest disabled-feature summary and operator-only blockers.

Public links: [production site](https://stakemate.isholadigital.tech) and [GitHub repository](https://github.com/ScapeXYZ/stakemate). The public site is reachable, but production insights intentionally fail closed until the separately approved durable-evidence migration/import is completed.

## Testnet settlement policy

StakeMate automatically verifies official sporting results using two independent data providers. Once both sources agree, the correction window has passed, and all escrow conditions are satisfied, the authorized Testnet settlement worker can submit the outcome on-chain. The smart contract pays the verified winner or refunds participants according to the immutable challenge terms.

This paragraph describes the implemented verification and queue policy, not an active unattended broadcaster. A live settlement additionally requires an actual funded Testnet challenge, a matching on-chain terms hash and authority, a completed correction window, healthy provider coverage, a managed signer controlling the configured authority address, a passing simulation/gas check, an enabled durable scheduler, and explicit operator authorization. Mainnet execution stays disabled.
