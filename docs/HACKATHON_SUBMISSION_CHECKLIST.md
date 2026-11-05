# StakeMate final hackathon submission checklist

## Public links

- [ ] Production site: https://stakemate.isholadigital.tech — HTTP 200 verified during this work session.
- [ ] Source repository: https://github.com/ScapeXYZ/stakemate — public `main` resolved to `ea0be9937363` during this work session.
- [ ] Redacted Mainnet/Tatum evidence: [HACKATHON_EVIDENCE_MANIFEST.md](HACKATHON_EVIDENCE_MANIFEST.md).
- [ ] Technical blog text: [HACKATHON_TECHNICAL_BLOG.md](HACKATHON_TECHNICAL_BLOG.md).
- [ ] Demo narration: [HACKATHON_DEMO_SCRIPT.md](HACKATHON_DEMO_SCRIPT.md).

## Evidence to cite

- [ ] Walrus batch digest: `590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f`.
- [ ] Say exactly: historical verification recorded 10 completed receipts, 10 distinct blob IDs, 10 aggregator HTTP 200 responses, and 10 canonical recall matches.
- [ ] Tatum Testnet observation: chain `69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD`; package `0x3ad668c9afb9fe8540c9a3567aaee1e637f6392d414be3611f137658ef238392`; transaction `7WoZafsGnmWtqX91PHwX3vBAyMfU9bXQG9iNU7AEEDVf` succeeded.

## Truthful feature status

| Area | Submission wording |
| --- | --- |
| Walrus | Historical 10-record Mainnet publication/retrieval/recall evidence exists; new writes are disabled. |
| Tatum | Read-only Testnet gRPC package and publish-transaction verification is implemented. |
| Wallets | Browser wallets authenticate and can approve their own Testnet actions; StakeMate does not receive private keys. |
| Invitations | Isolated-pilot only; not production-enabled. |
| Insights | Implemented, but production access is intentionally blocked pending approved durable evidence migration/import. |
| Settlement | Verification/queue logic exists; automatic broadcast, payouts, and unattended settlement are disabled. |
| MCP | Public read-only tools exist; private remote MCP/OAuth is disabled. |

## Manual actions still required

- [ ] Review, commit, and push these submission artifacts before sharing their repository links. The public `main` check in this work session resolved to `ea0be9937363`, which predates uncommitted local work.
- [ ] Paste the public links and the blog text into the hackathon submission form.
- [ ] Record/upload a demo only if you actually do so; use the narration above and do not claim it was recorded before then.
- [ ] Attach or privately provide the retained Walrus evidence only if the organizer requests it. Do not upload credentials, delegate keys, private receipt journals, or database URLs.
- [ ] If a live production-insights demonstration is required, obtain explicit approval for the reviewed database migration and private evidence import first. This work did not apply either.

## Do not claim

- A new Mainnet write, a video recording, a published blog post, or a completed submission.
- Mainnet custody, betting, funding, automatic payouts, or active unattended settlement.
- Perpetual Walrus retention, a contract audit, or current-wallet ownership/outcome claims from the historical batch.
