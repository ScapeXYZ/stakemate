# StakeMate

Ever argued with a friend about who will win a football match, where Bitcoin is heading, or what happens next in the stock market? Meet StakeMate. We're not building another sportsbook. We're building a platform where friends can turn disagreements into clear, verifiable challenges—with AI agents helping define the rules and blockchain technology bringing transparency to the outcome.

StakeMate is a safety-first peer-to-peer challenge and dispute-resolution prototype for the Tatum × Walrus Total Recall Hackathon. Its current product scope is football prediction duels: friends can define transparent terms around an eligible fixture, review the same conditions, and use verifiable evidence where supported. It uses server-side football-data.org fixture discovery, wallet-authenticated immutable terms, an isolated off-chain invitation pilot, read-only Sui evidence, and receipt-validated Walrus Memory recall.

StakeMate is not a traditional sportsbook: it does not set odds, act as a counterparty, or take custody of participant keys. That does not make any stake-bearing challenge legally exempt from gambling, financial-services, consumer-protection, or other regulation. Testnet participants may explicitly approve their own create/funding transactions in a browser wallet; StakeMate never receives their keys. Automatic settlement broadcasting and Walrus writes remain disabled pending separate operator authorization and signer-custody review.

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

## Category status

| Category | Status | Accurate scope |
| --- | --- | --- |
| Sports | Prototype | The exposed flow supports provider-backed future football 1X2 previews and an isolated-pilot invitation path. |
| Crypto | Experimental / disabled | Canonical terms and threshold-resolution code exist, but the price provider and end-to-end crypto flow are disabled. |
| Stocks | Planned | No stock challenge type, market feed, calendar logic, or settlement path exists. |
| AI-agent integration | Local read/preview only | Compatible agents can help structure a football preview through local MCP; they cannot create, fund, sign, settle, or write Walrus Memory. |

## Roadmap

### Coming December 2026

These are planned capabilities, not launched features:

- **Crypto prediction duels:** Support predictions involving crypto assets with reliable market data, transparent rules, and verifiable outcomes.
- **Stock market prediction duels:** Introduce stock-market prediction agreements with trusted financial data and clearly defined settlement conditions.
- **Expanded market coverage:** Extend the platform beyond football while preserving exact-stake escrow and transparent settlement.
- Automated settlement and payout verification.
- Live dual-provider football outcome verification.
- Expanded Walrus Memory capabilities.
- AI-agent-assisted duel creation and management.

The current product remains focused on football prediction duels. The exposed prototype does not yet support crypto or stock challenges, unattended payouts, live dual-provider agreement, new Walrus writes, or agent-authorized duel mutations.

## Deliberate limitations

- Walrus writes remain disabled (`WALRUS_MEMORY_WRITES_ENABLED=false`).
- Historical Walrus records are not shown as belonging to the current wallet unless they exactly match that wallet's current canonical invitation commitments. The existing historical batch must not be used to claim current wallet ownership or verified football outcomes.
- Remote MCP (`/api/mcp`) is disabled. It is not an official ChatGPT plugin and is not ready for public connector installation; a separately reviewed OAuth resource-server/consent deployment is required.
- Automatic settlement broadcast remains disabled. StakeMate can only queue/simulate a decision after dual-source final-result verification and its correction window; a reviewed managed signer, explicit Testnet broadcast authorization, database migration/activation, and an authenticated scheduler are still required before any outcome can be submitted. Cloudflare holds no signer key and only invokes the bounded authenticated cron endpoint.
- Production provider health is verified after deployment secret configuration; a future `503` health response is a configuration failure, not a successful fallback.
- The durable evidence implementation is additive but not yet migrated or deployed: authenticated production insights remain unavailable until migration `0009` and the approved, private 10-record import have completed successfully. It never falls back to `/tmp`.
- Sports is the only exposed challenge category. Crypto has experimental canonical-term and threshold-resolution code but its price provider and end-to-end flow are disabled. Stocks are planned only: there is no stock price feed, market-calendar logic, or settlement path.
- The local MCP server can read verified fixtures, resolve handles, prepare an authenticated football preview, and read owner-bound history. It cannot create/accept a challenge, sign, fund, settle, or write Walrus Memory. Remote private MCP/OAuth is disabled.

## Beginner guide: challenge a friend responsibly

1. Open StakeMate and connect a supported **Sui Testnet** wallet where the feature is available. Approve only the readable authentication message; never share a seed phrase or private key.
2. Choose an eligible future football fixture. The current live prototype supports only football 1X2 terms, not crypto or stock challenges.
3. Define the friend, opposing Home Win/Away Win selections, stake, and invitation window. Review every term, including the draw/void refund rule and terms hash.
4. In the isolated local pilot, invite the friend. They can review, accept, reject, or let it expire. Acceptance is acknowledgement only—not a funding approval.
5. Follow the read-only challenge status. Sui Testnet escrow and funding require each participant’s explicit wallet approval in a separately enabled flow; automated settlement and payouts are disabled.

An AI agent can help clarify a request without gaining authority. Example prompts are illustrative, not claims about an upcoming fixture or current price:

- Sports: “Help me create a challenge with my friend about the winner of an upcoming Arsenal vs Chelsea match.”
- Crypto roadmap: “Draft a challenge about whether BTC exceeds $100,000 by a specified UTC deadline.”
- Stocks roadmap: “Draft a challenge about whether Apple shares close above a specified price on a particular trading day.”

For the full technical guide, category status, and FAQ, read the [technical blog](docs/HACKATHON_TECHNICAL_BLOG.md).

## How Automatic Duel Settlement Works

The intended settlement design is deliberately conditional:

1. Both participants review and approve the challenge terms. In the active prototype, invitation acceptance is not funding; separately enabled Testnet escrow/funding requires each participant’s own wallet approval.
2. The committed outcome is checked against designated authoritative providers. For football, the verification design requires matching fixture identity and regulation-time final-score evidence from the required independent sources.
3. Conflicting, stale, corrected, unavailable, or unsupported results trigger a hold: StakeMate must not declare a winner from uncertain evidence.
4. The appropriate verification and correction window must pass before a verified outcome can progress.
5. Only after all terms, evidence, authority, escrow, and operational safety conditions are satisfied could an authorized settlement release escrow according to the immutable challenge terms.

The full automatic payout process is currently disabled. StakeMate does not run unattended settlement broadcasts, managed-signature submission, or production payouts.

## FAQ

### 1. What is StakeMate?

StakeMate is a safety-first peer-to-peer challenge and dispute-resolution prototype that helps friends define transparent terms and use verifiable evidence where supported.

### 2. How is StakeMate different from a traditional betting platform?

It is designed for friend-versus-friend challenges, not house-set odds or a platform counterparty. That does not remove legal or financial-risk obligations when stakes are used.

### 3. Can I challenge a friend instead of betting against a sportsbook?

That is the intended model. The controlled football invitation flow exists in an isolated pilot; production invitation mutation is disabled.

### 4. Does StakeMate support sports challenges?

Yes, in a limited football 1X2 prototype: supported future fixtures, opposing Home Win/Away Win selections, and a draw/void refund rule. Verification and Testnet flows have separate safety gates.

### 5. Can users challenge each other about cryptocurrency prices?

Not operationally. Canonical crypto terms and deterministic threshold-resolution code exist, but the provider and end-to-end flow are disabled.

### 6. Can users create stock-market challenges?

No. Stocks are a roadmap category; there is no stock challenge type, price feed, calendar logic, or settlement flow.

### 7. Can I use an AI agent such as Codex with StakeMate?

An agent can help structure terms and, in the local MCP setup, prepare a supported football preview. Codex and other agents cannot currently create/accept challenges, sign, fund, settle, or write Walrus records through StakeMate.

### 8. How are challenge outcomes verified?

For sports, independent sources must match the committed fixture and regulation-time final score before a result can progress after its correction window. Missing, stale, conflicting, or unsupported evidence fails closed. Crypto and stocks are not operational verifiers.

### 9. How does Sui escrow work?

The Testnet Move package records fixed participants, stake, deadlines, terms hash, and outcome authority. Participants approve their own transactions. It has a draw/void refund path; it is not a live Mainnet service.

### 10. What happens if a match is cancelled or an outcome cannot be verified?

StakeMate should not declare a winner. Unsupported states, source disagreement, provider failure, or unverifiable evidence remain unavailable/disputed and require the configured void/refund/manual-review path.

### 11. What role does Walrus Memory play?

Walrus provides durable evidence-backed memory only when a recalled record matches the manifest and completed receipt. The historical batch is verified; new writes and production insights remain disabled.

### 12. What role does Tatum play?

Tatum provides read-only Sui Testnet gRPC verification of the configured chain, package, and publish transaction. It is not used to sign or submit transactions.

### 13. Is StakeMate using real money?

No Mainnet money flow is enabled. Escrow work is Sui Testnet-only. A future stake-bearing product may involve financial risk and would require legal, security, and operational approval.

### 14. Is automatic settlement live?

No. Automatic broadcast, unattended payouts, and managed-signer activation are disabled.

### 15. How can developers integrate their own AI agents?

Use the local MCP server for its documented read/preview tools and wallet-bound local authorization. Require structured terms and human approval; do not assume remote MCP/OAuth or mutation/signing tools are available.

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
