# StakeMate architecture

## Current milestone

The browser supports Testnet-only wallet connection and read-only discovery of the verified StakeMate Testnet package. Challenge creation is disabled until a licensed/reputable fixture or crypto-price adapter provides verified source data. Signing, execution, funding, and Mainnet escrow support remain disabled.

Wallet invitation protocol types live under `src/lib/server`: domain-bound, expiring Sui personal-message nonces; profiles; invitation lifecycle; immutable canonical terms; and a postgres.js adapter configured without prepared statements for Supabase transaction pooling. Tables remain migration-gated. See [INVITATIONS.md](INVITATIONS.md).

## Frontend boundaries

- `src/components`: presentational cards, navigation, challenge form, and visible UI states.
- `src/lib/challenge.ts`: pure client-safe validation. It is deliberately free of blockchain or provider code.
- `src/lib/sui-dapp-kit.ts`: browser-only official dApp Kit configuration limited to Sui Testnet and gRPC balance reads.
- `src/lib/wallet.ts`: pure funding-gate policy. No transaction construction or signing is present.
- `src/lib/escrow-config.ts`: immutable verified Testnet package/module configuration.
- `src/lib/terms.ts`: versioned canonical terms UTF-8 encoding and browser-safe SHA-256 hashing.
- `src/lib/escrow-transactions.ts`: exact-ABI unsigned transaction builders and human-readable previews; it never signs, simulates, or submits.
- `src/lib/escrow-discovery.ts`: defensive Testnet object/event parsing and cursor pagination.
- `src/lib/server`: server-only Tatum and Walrus Memory adapters, structured provider errors, and no secret-bearing responses.
- `src/lib/memory/records.ts`: validated, versioned-memory payload types for future challenge lifecycle events.
- `src/lib/outcome-verification.ts`: pure source-data validation and deterministic sports/crypto settlement gates; it never fetches or invents events/results.
- `src/app`: Next.js App Router shell and homepage.

## Future integration seams

| Concern | Planned boundary | Constraint |
| --- | --- | --- |
| Sui escrow | Verified Testnet package `0x3ad…8392`, module `challenge_escrow`; read-only discovery and unsigned builders | Signing/execution stays disabled pending separate approval and external review. |
| Tatum Sui RPC | `TatumSuiClient` via server-only route/service | Testnet/Devnet use native TLS gRPC (`GetServiceInfo`, `GetObject`, `GetTransaction`) with official Sui generated protobuf messages. `x-api-key` stays server-side; calls are bounded and read-only. |
| Walrus Memory | `WalrusMemoryService` backed by official `MemWal` | Mainnet relayer only; delegate key stays server-side; writes are false by default. |
| AI assistant | server-side `PredictionAssistant` adapter | Label provenance, uncertainty, and simulated vs live data; do not offer gambling advice. |
| Event/result sources | future licensed or reputable sports and crypto adapters | Creation remains disabled until fixture/price IDs, UTC observations, source policy, and correction/dispute rules are verified. |

## Data lifecycle (future)

1. The UI validates a proposed challenge and asks a connected wallet to approve an escrow transaction.
2. A backend verifies the transaction digest through trusted Sui/Tatum reads.
3. Validated, deduplicated challenge lifecycle records may be submitted to Walrus Memory only after explicit enablement, cost review, and provider confirmation. Receipt jobs must be awaited; the current receipt store is process-local, not production-durable.
4. Settlement only renders after verified oracle/result and contract state are available.

All external calls must have loading, empty, error, and confirmed-success states. A submission cannot be represented as complete before chain and storage verification.

## Provider health routes

- `GET /api/health/tatum` performs native gRPC `GetServiceInfo` on Testnet/Devnet (legacy JSON-RPC `sui_getChainIdentifier` only on the Mainnet compatibility path) when a Tatum key is configured.
- `GET /api/health/walrus` calls the official SDK `health()` when Mainnet Memory credentials are configured.

Both expose only `ok`, network, and safe error codes—not endpoints, keys, account IDs, or raw provider responses.

## Wallet boundary

The browser may connect a user-controlled Sui wallet through official dApp Kit. It is configured with only `testnet` and reads the selected account's Testnet SUI balance. A connected wallet does not enable funding: all signing/execution controls remain disabled despite the verified deployment. The frontend never receives or stores wallet private keys.

## Escrow boundary

The deployed Testnet package uses a shared challenge object that holds exactly two Testnet SUI deposits. It has immutable participant, stake, terms-hash, deadline, and outcome-authority fields. The authority is an explicit trusted resolver, not a trustless oracle. See [TESTNET_INTEGRATION.md](./TESTNET_INTEGRATION.md) for ABI and read-only integration details and [ESCROW_SECURITY.md](./ESCROW_SECURITY.md) for lifecycle and invariants.
