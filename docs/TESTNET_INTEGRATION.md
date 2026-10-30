# StakeMate Testnet integration

## Verified deployment

- Network: Sui Testnet only
- Package: `0x3ad668c9afb9fe8540c9a3567aaee1e637f6392d414be3611f137658ef238392`
- Module: `challenge_escrow`
- Publish transaction: `7WoZafsGnmWtqX91PHwX3vBAyMfU9bXQG9iNU7AEEDVf`
- Upgrade capability: retained outside browser code; it is never used by this application.

The frontend pins the package address in `src/lib/escrow-config.ts`. It is Testnet-only and exposes no environment override for a package ID.

## ABI used by unsigned builders

The source and deployed package expose these entry functions; implicit `TxContext` parameters are omitted from transaction arguments:

| Function | Explicit transaction arguments |
| --- | --- |
| `create` | `address opponent`, `Coin<SUI> stake`, `vector<u8> terms_hash`, `u64 funding_deadline_ms`, `u64 outcome_deadline_ms`, `address outcome_authority`, `&Clock` |
| `accept_and_fund` | `&mut Challenge`, `Coin<SUI> stake`, `&Clock` |
| `submit_outcome` | `&mut Challenge`, `u8 outcome` (`0`, `1`, or `2`), `&Clock` |
| `cancel_unfunded` | `&mut Challenge` |
| `refund_expired_funding` | `&mut Challenge`, `&Clock` |
| `void_unreported_outcome` | `&mut Challenge`, `&Clock` |

Read-only discovery uses the official Sui GraphQL Testnet client for paginated module-event queries and the existing official gRPC wallet client for wallet/balance reads. It filters events from `package::challenge_escrow` and parses only objects of the exact `Challenge` type. Unexpected RPC data is rejected rather than inferred. Pagination cursors are passed only back to the Testnet client.

## Canonical terms v1

Before hashing, addresses are lowercase 32-byte `0x` hex strings; text is NFC-normalized, trimmed, non-empty, and may not contain CR/LF. Integers are base-10 unsigned strings without separators. UTF-8 bytes of the following fixed-order, LF-delimited record—including the final LF—are SHA-256 hashed:

```text
stakemate.challenge-terms.v1
creator=<address>
opponent=<address>
stakeMist=<u64 decimal>
fixture=<text>
market=<text>
fundingDeadlineMs=<u64 decimal>
outcomeDeadlineMs=<u64 decimal>
outcomeAuthority=<address>
```

Test vector SHA-256: the terms in `tests/terms.test.ts` hash to `d11c78d1f6467a42be7884fe79e9ecca909b34ecb6166daec21be3e01d948de2` (without `0x`). Both participants must independently reproduce and compare this digest before any future approval to sign.

## Deliberate execution boundary

`src/lib/escrow-transactions.ts` builds unsigned `Transaction` objects only so ABI arguments can be tested and previewed. It does not call wallet signing, transaction execution, dry-run, or gas estimation. Previews therefore label gas as unavailable. The UI remains demo/read-only and all funding controls remain disabled.

Before enabling signing: reverify package/source, independently review the exact frontend transaction flow, validate shared-object and coin selection behavior with disposable Testnet accounts, establish authority operations, and obtain explicit approval. This integration is not an independent audit and does not support Mainnet or real-money wagering.

## Exact-stake rule

The verified package records the creator's `Coin<SUI>` value as immutable `stake_mist`. `accept_and_fund` aborts unless the opponent `Coin<SUI>` value equals that amount exactly. Underpayment and overpayment both abort atomically; neither is counted as funding and no excess can be retained by the challenge. Zero creator stakes and repeated funding are also rejected.

The unsigned frontend builder uses only `bigint` MIST base units. It splits a larger selected wallet/gas coin into an exact `Coin<SUI>` for the Move call; the unsplit remainder stays in the wallet transaction. It requires the UI-observed `expectedStakeMist` to equal the split amount before building. Signing and execution remain disabled.

## Invitation and funding timing

Off-chain invitation expiry is not an escrow deadline. It is calculated by the server from successful creation time and may only be 10 or 15 minutes (15 by default). Pending invitations reject acceptance at or after that server expiry. Rejected, expired, and cancelled invitations are never fundable.

After acceptance, the future escrow creation flow must calculate a separate 15-minute funding deadline from acceptance, and only proceed when that deadline is strictly before the immutable outcome deadline. The existing Move package already enforces `clock < funding_deadline_ms` for opponent funding and makes timeout refunds available at `clock >= funding_deadline_ms`.

## Manual Slush wallet-authentication test

No transaction, token transfer, or escrow funding is involved.

```bash
cd ~/stakemate
STAKEMATE_PUBLIC_ORIGIN=http://localhost:3000 npm run dev
```

1. In Slush, select Sui Testnet and open `http://localhost:3000`.
2. Connect Slush, select **Authenticate wallet**, and inspect the readable `StakeMate wallet authentication` message.
3. Approve only that personal-message signature. It must not request transaction approval.
4. Claim a username, reload/load the inbox, and verify the account shows an empty inbox.
5. Try the same username from a second wallet to confirm the collision is rejected.

Never enter, export, or share a seed phrase/private key. A successful UI flow must be separately recorded as a real wallet-signature verification; it is not asserted by automated tests.
