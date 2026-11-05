# StakeMate hackathon evidence manifest (redacted)

Status date: 2026-10-31. This is a public-safe index of evidence, not a source of credentials, private receipts, or activation authority.

## Walrus Mainnet publication

| Field | Verified value |
| --- | --- |
| Batch digest | `590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f` |
| Manifest | schema-v1, Mainnet, 10 entries |
| Receipt journal | 10 completed receipts; 10 distinct canonical record digests; 10 distinct non-empty blob IDs |
| Retrieval check | 10/10 Mainnet aggregator requests returned HTTP 200 |
| Recall check | 10/10 authenticated recalled records matched the manifest’s canonical SHA-256 digests |
| Verification output | `Canonical records matched: 10/10` |
| Private source location | `~/stakemate-evidence/walrus-mainnet/` (not committed) |
| Repository verifier | [`scripts/verify-walrus-evidence.ts`](../scripts/verify-walrus-evidence.ts) |

The private manifest and receipt journal are intentionally not copied into Git. They can contain operational metadata and are retained separately. The checks above establish publication, retrieval, and canonical recall at the recorded time; they do not prove perpetual retention or authorize another Mainnet write.

## Tatum Sui Testnet gRPC observation

| Field | Verified value |
| --- | --- |
| Network | Testnet |
| Chain identifier | `69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD` |
| Pinned package | `0x3ad668c9afb9fe8540c9a3567aaee1e637f6392d414be3611f137658ef238392` |
| Required module | `challenge_escrow` |
| Publish transaction | `7WoZafsGnmWtqX91PHwX3vBAyMfU9bXQG9iNU7AEEDVf` (`success`) |
| Read methods | `GetServiceInfo`, `GetObject`, `GetTransaction` over TLS gRPC |
| Supporting records | [`docs/HACKATHON_EVIDENCE.md`](HACKATHON_EVIDENCE.md), [`docs/MILESTONE_7_13_AUDIT.md`](MILESTONE_7_13_AUDIT.md), [`docs/SUI_ESCROW_ATTESTATION.md`](SUI_ESCROW_ATTESTATION.md), [`src/lib/server/tatum-sui.ts`](../src/lib/server/tatum-sui.ts) |

These are read-only provider observations. They are not a contract audit, a source-equivalence claim beyond the separately recorded source verification, or permission to sign, fund, or settle.

## Safety status

- New Walrus Mainnet writes: disabled.
- Wallet signing, funding, automated settlement, and unattended payouts: disabled.
- Production agent insights: intentionally unavailable until the reviewed durable-evidence database migration and private import are approved and completed.
