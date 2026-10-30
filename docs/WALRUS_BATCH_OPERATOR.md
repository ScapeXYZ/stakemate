# Walrus Mainnet batch operator workflow

The batch CLI is local-only. It reads canonical events from the isolated
`127.0.0.1:55435` pilot and has no HTTP route. `prepare` is non-writing; every
other command first revalidates that the persisted candidates still produce the
same frozen batch digest.

## Current prepared batch

- Manifest: `/tmp/stakemate-walrus/mainnet-batch.json` (outside Git)
- Digest: `590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f`
- Records: 10 schema-v2 canonical invitation/prediction events

## Review and approval

```bash
set -a; . ./.env.isolated-two-wallet-pilot; set +a
export WALRUS_MEMORY_MANIFEST_PATH=/tmp/stakemate-walrus/mainnet-batch.json
export WALRUS_MEMORY_RECEIPTS_PATH=/tmp/stakemate-walrus/receipts.json
npm run walrus:batch -- prepare
npm run walrus:batch -- status
```

Do not enable writes until a human has reviewed the exact digest, record count,
payload sizes, retention, wallet/account capacity, and current prices. Use the
official `walrus info` and `walrus store --dry-run` tools for current WAL/SUI
prices; MemWal does not expose a non-spending price quote.

After documented human approval only:

```bash
export WALRUS_MEMORY_WRITE_APPROVAL_ID='approved-change-or-ticket-id'
export WALRUS_MEMORY_APPROVED_BATCH_DIGEST='590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f'
export WALRUS_MEMORY_WRITES_ENABLED=true
npm run walrus:batch -- publish --confirm 590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f
npm run walrus:batch -- verify
npm run walrus:batch -- recall-check
```

`publish` refuses a missing approval ID, mismatched environment digest,
mismatched explicit confirmation, disabled write gate, maintenance freeze, or
changed candidate set. `verify` requires every receipt to be completed with a
blob ID; an accepted job is not a verified write. `recall-check` accepts only
exact schema-v2 identities and canonical digests, not unrelated recall text.

## Cost and service limitations

Walrus Mainnet storage is epoch-based (two weeks per epoch) and prices are
dynamic. Official documentation says storage is billed in WAL by encoded size,
with metadata overhead, plus SUI gas for on-chain operations; do not infer a
cost from these small JSON payloads alone. The public MemWal relayer is a
managed service: its capacity, sponsorship, retention policy, and rate limits
must be confirmed with the account owner. The relayer is distinct from direct
Walrus CLI storage pricing and can impose account quotas/rate limits.

Sources: [Walrus storage costs](https://docs.wal.app/docs/system-overview/storage-costs),
[storage epochs](https://docs.wal.app/docs/console/storage-epochs), and
[MemWal relayer overview](https://github.com/MystenLabs/MemWal/blob/dev/docs/relayer/overview.md).
