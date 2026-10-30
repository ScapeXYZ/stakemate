# StakeMate milestones

## Milestone 7.7 — wallet-linked invitations (foundation)

- Added tested canonical invitation terms, SHA-256 hashing, lifecycle authorization, and Sui personal-message verification.
- Persistent profiles/invitations and real inboxes are blocked pending a transactional database and verified sports/crypto providers; no mock authentication or in-memory production persistence is enabled.
- Wallet signing, escrow funding/execution, and additional Walrus writes remain disabled.

## Milestone 1 — frontend prototype (current)

- Responsive Next.js interface, demo fixture picker, client validation, and explicit UI states.
- No real-money wagering, live odds, wallet signing, chain transactions, or Walrus writes.
- Unit coverage for challenge validation.

## Milestone 2 — provider foundation (current)

- Add a server-only, timeout-bounded Tatum Sui read adapter and safe health route.
- Add official Walrus Memory SDK foundation with typed record validation, deduplication, receipt jobs, and safe health route.
- Keep Walrus Memory Mainnet writes disabled until credentials, Mainnet funding/cost expectations, and operational acceptance are confirmed.
- No Sui escrow, wallet signing, or Mainnet wagering is included.

## Milestone 2 completion criteria (pending credentials)

- Verify Tatum read health against the intended network using a real API key.
- Create a dedicated Walrus Memory account/delegate key and verify health on production relayer.
- Approve costs, enable writes deliberately, perform at least 10 documented Mainnet writes, await every receipt job, and verify recall/receipt evidence.
- Replace process-local receipt tracking with a durable server-side datastore before multi-instance deployment.

## Milestone 3 — trusted data and AI

- Add licensed or user-provided sports data with source timestamps.
- Implement a transparent AI assistant with cited inputs, confidence framing, and safety guidance.
- Add result/oracle policy, dispute handling, and accessibility review.

## Milestone 3 — wallet connection foundation (current addition)

- Integrate official Sui dApp Kit with a Testnet-only client, wallet connect/disconnect, address, network, and balance states.
- Keep all transaction and funding controls disabled; no Move escrow package has been deployed.
- Confirm Walrus Memory account configuration means a Memory account object ID, not a wallet address or delegate public key.

## Milestone 4 — Testnet Move escrow package (current addition)

- Add `contracts/stakemate`: a two-party Testnet SUI escrow design with immutable terms and authority, fixed stake matching, deadline refunds, and terminal settlement states.
- Include inline Move scenario tests and a TypeScript transaction-intent interface, but keep every signing/submission path disabled.
- Do not deploy until the Sui CLI-based build/test results, dependency pin, independent security review, and explicit approval are complete.

## Milestone 4.2 — adversarial review and deployment readiness (current addition)

- Internal review added independent-authority and safe-maximum-stake protections, deadline boundary regressions, and a Testnet deployment runbook.
- The reviewed package was subsequently deployed and source-verified on Sui Testnet. Signing/submission remains disabled pending separate approval, an external review, and live Testnet operational checks.

## Milestone 5 — verified Testnet frontend integration (current addition)

- Pin the verified Testnet package and exact `challenge_escrow` ABI in browser-safe configuration.
- Add read-only, paginated challenge-event discovery plus strict challenge-object parsing.
- Add canonical terms v1 SHA-256 hashing, unsigned transaction builders, and transaction previews.
- Keep all signing, simulation, execution, and funding controls disabled pending separate approval.

## Milestone 6 — provider and evidence readiness (current addition)

- Tatum is a server-only, timeout-bounded read adapter. Testnet now uses Tatum's native TLS gRPC gateway with documented `GetServiceInfo`, `GetObject`, and `GetTransaction` calls, official Sui generated protobuf messages, and an `x-api-key` gRPC metadata header. The verified package, module, and publish transaction were read successfully on 2026-10-28.
- Walrus Memory Mainnet adds an authenticated read-only readiness route, canonical lifecycle records, and durable receipt-journal support for a future approved write workflow.
- No Walrus Memory account credentials were configured in this workspace; no Walrus write was made. Signing, funding, and all paid operations remain disabled.

## Release gates

Before any public launch: contract audit, threat model, privacy review, jurisdictional/legal review, responsible-gaming review, observability, and clear testnet/mainnet separation.
