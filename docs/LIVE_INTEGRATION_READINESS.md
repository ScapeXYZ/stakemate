# Live integration readiness audit

Audit scope: read-only local configuration inspection plus bounded provider checks. No Supabase access, Mainnet write, wallet transaction, signing, deployment, funding, settlement, or Walrus `remember()` call occurred.

## Checklist

| Area | Status | Evidence / exact blocker |
| --- | --- | --- |
| Walrus Mainnet endpoint | PASS | Effective endpoint is the official Foundation Production relayer: `https://relayer.memory.walrus.xyz`. The environment variable is **MISSING**, but the adapter defaults to that exact endpoint. `accountReadiness()` completed `health()` and one bounded `recall()` with recalled content discarded. |
| Walrus credentials | PASS for read-only readiness | `WALRUS_MEMORY_ACCOUNT_ID`: **PRESENT** and format-valid; `WALRUS_MEMORY_DELEGATE_KEY`: **PRESENT**. Values were not read into output. |
| Walrus write readiness | BLOCKED | `WALRUS_MEMORY_WRITES_ENABLED`: **PRESENT** and set to safe disabled mode. `WALRUS_MEMORY_WRITE_APPROVAL_ID`: **MISSING**. Ten approved, genuine records with completed receipt/blob evidence do not exist. Do not enable write mode. |
| Tatum Sui RPC | PASS | `TATUM_API_KEY`: **PRESENT**. `TATUM_SUI_NETWORK`: **MISSING**, so the code safely defaults to **testnet**. A live `GetServiceInfo` gRPC read completed successfully. |
| Tatum operations | PASS, read-only | Adapter uses TLS gRPC with server-only `x-api-key` metadata for `GetServiceInfo`, `GetObject`, `GetTransaction`, and `GetBalance`; it exposes no execution or signing method. |
| Claude-compatible MCP | BLOCKED | `LocalOnlyAgentTools` supplies tool definitions and owner-bound authorization, but it is explicitly not an MCP server. There is no `@modelcontextprotocol/sdk` dependency, transport, executable command, Claude client configuration, or external-client discovery handshake. It therefore cannot be launched or discovered yet. |
| Draw-refund rule | PASS | No Move source change in this audit. The contract’s outcome `0` returns both full stored deposits, and the local Move suite validates it. Network gas is outside escrow principal. |

## Integration contract

### Walrus Memory Mainnet

Required variables:

- `WALRUS_MEMORY_NETWORK=mainnet` (**PRESENT** and valid)
- `WALRUS_MEMORY_ACCOUNT_ID` (**PRESENT**, 32-byte Sui object-ID format)
- `WALRUS_MEMORY_DELEGATE_KEY` (**PRESENT**)
- `WALRUS_MEMORY_NAMESPACE` (optional; defaults to `stakemate`)
- `WALRUS_MEMORY_RELAYER_URL` (optional; defaults to official Production relayer above)
- `WALRUS_MEMORY_WRITES_ENABLED=false` (**PRESENT**, required safe state)
- `WALRUS_MEMORY_RECEIPTS_PATH` (**PRESENT**, required only before an enabled write)
- `WALRUS_MEMORY_WRITE_APPROVAL_ID` (**MISSING**, mandatory before an enabled write)

The adapter uses the official `@mysten-incubation/memwal` `MemWal.create({ key, accountId, serverUrl, namespace })` interface. Supported operations are `health`, `recall`, canonical-record `recallValidatedRecords`, approval-gated `remember`, completion polling, and accepted-job reconciliation. Writes use canonical SHA-256 idempotency keys and are counted only after a non-empty blob ID is journaled.

The official documentation identifies the configured default as the Foundation Production relayer and shows the same `MemWal.create` fields. It also states that managed-relayer writes can be subject to usage limits even when its server wallet sponsors WAL and SUI. [Managed relayer documentation](https://docs.wal.app/walrus-memory/relayer/public-relayer)

### Tatum Sui gRPC

Required variables:

- `TATUM_API_KEY` (**PRESENT**)
- `TATUM_SUI_NETWORK` (**MISSING**; effective default `testnet`)
- `TATUM_SUI_GRPC_ENDPOINT` (optional; defaults by network to Tatum TLS port 443)
- `TATUM_TIMEOUT_MS` (optional; defaults to 8000)

Network authorities are explicitly separated:

- Mainnet: `sui-mainnet-grpc.gateway.tatum.io:443`
- Testnet: `sui-testnet-grpc.gateway.tatum.io:443`
- Devnet: `sui-devnet-grpc.gateway.tatum.io:443`

The live probe used `LedgerService/GetServiceInfo` only. Tatum documents TLS gRPC with an `x-api-key` metadata header and read services including ledger/object and state/balance queries. [Tatum Sui RPC documentation](https://docs.tatum.io/reference/rpc-sui)

### MCP / Claude

Current tool core definitions are:

- `stakemate_list_featured_fixtures`
- `stakemate_read_fixture`
- `stakemate_resolve_username`
- `stakemate_read_my_credibility` (authenticated owner only)
- `stakemate_propose_duel_draft` (preview only)

Tool context is server-authenticated and wallet-bound. There is no agent-supplied identity authority, signing, invitation mutation, funding, or settlement tool. MCP is designed around a client/server transport; this repository currently contains only the safe tool core, not a server. [MCP introduction](https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro)

## Ten legitimate memory candidates — future/event-bound only

None of these is asserted to have occurred or to be written. Each becomes eligible only after a real event, data-minimization review, canonical serialization, explicit approval, and a completed Mainnet receipt.

1. A wallet-owner’s approved football prediction for a verified future fixture (`player.prediction`).
2. A canonical invitation actually created in the isolated pilot (`challenge.history: created`).
3. The recipient’s authenticated acceptance of that invitation (`challenge.history: accepted`).
4. The recipient’s authenticated rejection of a separate invitation (`challenge.history: rejected`).
5. A creator-authorized cancellation before acceptance (`challenge.history: cancelled`).
6. A server-observed invitation expiry (`challenge.history: expired`).
7. A football-data.org final score verified with approved result evidence (`match.result`).
8. A formally approved settlement/void outcome linked to immutable evidence (`challenge.history: settled` or `voided`), only after settlement activation approval.
9. A credibility score derived from a documented minimum completed-event sample and methodology (`player.credibility_score`).
10. An agent-learning conclusion tied to specific approved evidence references (`agent.learning`).

## Next safe commands

These commands do not enable writes or transactions:

```bash
# Re-run local contract and integration safeguards.
cd /home/temitope/stakemate
npm test
cd contracts/stakemate && sui move test

# Keep this value false; never place the delegate key in shell history.
export WALRUS_MEMORY_WRITES_ENABLED=false

# Before building an MCP transport, install/review an official SDK in a separate branch
# or approved change; do not expose keys through stdio or HTTP configuration.
npm view @modelcontextprotocol/sdk version
```

Before any Mainnet write, obtain a written approval for one exact digest, confirm relayer usage limits and retention, verify durable receipt storage, set a non-secret approval ID, and keep one writer process. The managed relayer’s funding model does not remove the need for project approval and receipt verification.
