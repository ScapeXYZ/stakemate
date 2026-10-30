# Provider integration setup

This foundation is server-side only. Never place a Tatum key, Walrus Memory delegate key, or Memory account ID in `NEXT_PUBLIC_*`, browser code, commits, logs, or screenshots.

## 1. Tatum Sui RPC

1. Create an account at the [Tatum Dashboard](https://dashboard.tatum.io) and create an API key.
2. Keep the key in the deployment secret manager as `TATUM_API_KEY`.
3. Select `TATUM_SUI_NETWORK` (`testnet` is the default). Tatum Testnet uses native TLS gRPC at `sui-testnet-grpc.gateway.tatum.io:443`; do not configure the legacy Testnet JSON-RPC URL. An exceptional gRPC authority override can be supplied as `TATUM_SUI_GRPC_ENDPOINT` only when directed by Tatum.
4. Call `GET /api/health/tatum`. A configured provider returns `{ "ok": true, "network": "…", "chainIdentifier": "…" }`; it never returns the key.

The Testnet adapter uses Tatum's documented `x-api-key` gRPC metadata with `GetServiceInfo`, `GetObject`, and `GetTransaction`; it uses the official generated Sui protobuf messages shipped with `@mysten/sui` and a server-only `@grpc/grpc-js` TLS transport. All calls are read-only and deadline-bounded. Do not add transaction submission here. See [Tatum's Sui RPC reference](https://docs.tatum.io/reference/rpc-sui) and [Tatum's Sui JSON-RPC-to-gRPC migration guide](https://docs.tatum.io/oa/docs/sui-migration-guide-from-json-rpc-to-grpc).

## 2. Walrus Memory Mainnet

1. Visit the [Walrus Memory Playground](https://memory.walrus.xyz), connect the wallet that will own the dedicated StakeMate Memory account, and use its account/delegate-key setup flow. The official SDK also exposes an operator-controlled contract path: `createAccount({ packageId, registryId, walletSigner })`, then `addDelegateKey({ accountId, publicKey, label, walletSigner })`. Those actions sign Sui transactions and are deliberately not implemented in StakeMate.
2. Record the returned `accountId` from `createAccount` (or the Playground account view) as `WALRUS_MEMORY_ACCOUNT_ID`; generate/register a dedicated Ed25519 delegate key and put only its private value in `WALRUS_MEMORY_DELEGATE_KEY` through the deployment secret manager.
3. Keep `WALRUS_MEMORY_NETWORK=mainnet`, `WALRUS_MEMORY_RELAYER_URL=https://relayer.memory.walrus.xyz`, and a unique `WALRUS_MEMORY_NAMESPACE=stakemate`.
4. With writes still disabled, call `GET /api/health/walrus` for relayer health, then `GET /api/health/walrus/account` for an authenticated read-only readiness probe. The latter calls `health()` and a bounded `recall()` but discards all recalled content. It proves the supplied account/delegate credentials are accepted by the configured Mainnet relayer; it does not prove a write occurred.

This project uses the documented `@mysten-incubation/memwal` SDK—not generic Walrus blob storage. The SDK uses the production relayer, account ID, delegate key, `remember`, `waitForRememberJob`, and `recall` APIs. Review the official [Walrus Memory Quick Start](https://github.com/MystenLabs/walrus-memory/blob/dev/docs/getting-started/quick-start.md) before enabling it.

### What `WALRUS_MEMORY_ACCOUNT_ID` is

`WALRUS_MEMORY_ACCOUNT_ID` is the **Walrus Memory account object ID on Sui**. It is neither the address of the wallet used to sign in nor the delegate key's public key or its derived Sui address. The official Memory SDK scopes access by the account owner and namespace; the delegate key is an authorization credential registered against that account. Retrieve the ID from the account creation result (`account.accountId`) or Memory Playground account view. Do not derive or substitute it from the connected wallet address or delegate key.

The adapter cannot verify a configured account ID without both account credentials, and this repository did not attempt to create, select, or inspect an account because no credentials were supplied.

## 2a. Sui Testnet wallet UI

StakeMate uses the official `@mysten/dapp-kit-react` and `@mysten/sui` packages with a `SuiGrpcClient` configured for **Testnet only**. Install a compatible Sui wallet extension, open StakeMate, select **Connect Wallet**, then select the extension. The navigation displays the connected account's shortened address, actual configured network, and a live Testnet SUI balance with loading/error states.

Disconnect via the address button in the navigation. The UI does not construct, sign, or submit transactions. Challenge funding remains disabled—even for a Testnet wallet—until an audited Testnet Move escrow package ID and transaction flow are separately deployed and reviewed.

## 3. Mainnet writes and the 10+ write requirement

Mainnet writes are intentionally blocked unless `WALRUS_MEMORY_WRITES_ENABLED=true` is set server-side. Before setting it:

1. Confirm the current Mainnet funding, pricing, relayer, and retention expectations with Walrus Memory's official documentation or support. This repository does not estimate or assume costs.
2. Confirm the account and delegate key are a dedicated project identity, then record the approval in project operations documentation.
3. Configure `WALRUS_MEMORY_RECEIPTS_PATH` on durable host storage outside the repository/public assets, or provide a database-backed `ReceiptStore` before setting `WALRUS_MEMORY_WRITES_ENABLED=true`. Set a non-secret externally recorded `WALRUS_MEMORY_WRITE_APPROVAL_ID` too; the service refuses enabled writes without both gates.
4. Run the local `dryRun()` against candidate records first. It validates the schema and canonical JSON, computes SHA-256 deduplication digests, and makes neither a provider request nor a journal mutation. It cannot estimate an authoritative Mainnet price: use the official Walrus Cost Calculator or CLI before approval.
5. Submit distinct, schema-valid records only after approval. The service derives a SHA-256 digest from canonical schema-v1 JSON and serializes writes within one Node.js process. Before the request, it atomically journals a `prepared` intent; it sends that digest as the MemWal idempotency key, then journals provider acceptance before polling. Only after `waitForRememberJob` completes does it persist `blobId`, completion time, and `completed` status.
6. A restart with a `prepared` journal entry retries the same deterministic idempotency key; a restart with an `accepted` entry retains the job ID for recovery rather than fabricating completion. A failed/timeout polling result must be reconciled against the relayer job status before it is counted.
6. Verify records with specific `recall` queries and independently retain operator-visible job/receipt evidence. Do not call a job complete merely because it was submitted.

The local file journal is safe only for one writer on one filesystem. Multiple Node.js processes or hosts require a transactional shared `ReceiptStore` with a unique digest constraint and lease/lock before writes are enabled. No real Mainnet write has been made by this codebase.

## 4. Opt-in integration checks

The default tests use provider mocks. Live checks must only run in a controlled environment with secrets injected by the host. Do not print environment values; do not run write tests until cost approval is documented.
