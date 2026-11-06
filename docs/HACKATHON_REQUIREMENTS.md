# StakeMate — Total Recall hackathon requirements

Status: **historical Mainnet publication evidence verified; new Mainnet writes and all value-moving actions remain disabled.**

## Official submission checklist

The official event page and rules require a public repository, a working 2–3 minute demo, a published blog post, Tatum RPC where relevant, and Walrus Memory integrated with at least 10 Mainnet memories. The submission form also asks for the submitter's email, Discord handle, LinkedIn, event-discovery answer, Web3 experience, Tatum ID, Sui address, Sui account ID, `MEMWAL_AGENT_ID`, project description, and experience reports for Walrus and Tatum AI Builder. Tatum AI Builder is optional and is a separate $500 bonus path.

| Mandatory requirement | StakeMate implementation | Evidence / honest status |
| --- | --- | --- |
| Walrus Memory integrated and writing on Mainnet | `@mysten-incubation/memwal`, Mainnet relayer, schema-v2 records, canonical digest and receipt validation | Historic batch verified: 10 completed receipts, 10 distinct blob IDs, 10 aggregator HTTP 200 responses, and 10 canonical recall matches. New writes are disabled. |
| At least 10 Mainnet memories | Ten historical project/lifecycle memory records | `docs/HACKATHON_EVIDENCE_MANIFEST.md`; private manifest and receipts remain outside Git. |
| Tatum RPC used where relevant | Read-only Tatum Sui Testnet gRPC adapter for service info, package/object, and transaction reads | Testnet chain ID, pinned package, and successful publish transaction recorded in the evidence manifest. No signing or broadcast. |
| Published blog post | Technical explanation of the product, learning loop, Tatum, Walrus, and safety boundaries | `docs/HACKATHON_TECHNICAL_BLOG.md` is prepared; publication URL still requires the team’s manual publishing action. |
| Working demo | Public football prototype and verified Testnet rehearsal evidence | Live app and `docs/TESTNET_REHEARSAL_EVIDENCE.md`; production invitations and automatic settlement are not enabled. A final recording/upload remains manual. |
| Public repository | GitHub repository configured as `origin` | Push could not be verified in this environment because DNS/network access to GitHub is unavailable. |
| `MEMWAL_AGENT_ID` | Must be copied from the Walrus Memory dashboard’s Delegate keys public key | Not present in the repository and not inferable from the account ID; manual dashboard lookup required. |

Official deadline: **10 November 2026 at 17:00 UTC**. Source: [official submission page](https://recall-tatum-walrus.vercel.app/) and [event rules](https://thewalrussessions.wal.app/tatum-total-recall).

## Walrus Memory Mainnet learning loop

| Requirement | Status | Proof / implementation | Blocker |
| --- | --- | --- | --- |
| Official Mainnet Memory client | Implemented, disabled | `src/lib/server/walrus-memory.ts` uses `@mysten-incubation/memwal`, the Mainnet relayer, account/delegate credentials held server-side, canonical idempotency digest, receipt journal, reconciliation, and recall. [Official quick start](https://github.com/MystenLabs/walrus-memory/blob/dev/docs/getting-started/quick-start.md) | Credentials are not read or displayed by this work. |
| Versioned learning schema | Implemented | `src/lib/memory/records.ts` schema v2: predictions, challenge history, match results, credibility scores, and agent-learning records. Existing lifecycle record shapes are retained under the v2 envelope. | Genuine, consented lifecycle data is required. |
| Provenance and influence | Implemented locally | `recallValidatedRecords()` accepts only exact canonical schema-v2 records and returns Mainnet/query/time/record-ID provenance. `recommendFromCredibilityMemories()` changes a recommendation only from validated recalled credibility records. | A completed Mainnet receipt plus successful recall is required before claiming live influence. |
| Ten completed Mainnet records | Historic verification: 10/10 | On 2026-10-31, the private verifier matched 10 canonical schema-v2 records to the frozen manifest; the retained journal has 10 completed receipts with distinct blob IDs and the aggregator retrieval check recorded HTTP 200 for all 10. See [evidence manifest](HACKATHON_EVIDENCE_MANIFEST.md). | This establishes the historical batch only. It does not authorize another write, prove indefinite retention, or make production wallet insights available. |

No candidate is a Mainnet write merely because it passes a dry run. A write requires `WALRUS_MEMORY_WRITES_ENABLED=true`, a durable external receipt path, and `WALRUS_MEMORY_WRITE_APPROVAL_ID`; the service refuses otherwise. The managed relayer and any account setup can have cost or sponsored-capacity implications, so approval must state a record digest and spend/usage cap before enabling the gate.

## Tatum Sui RPC

`src/lib/server/tatum-sui.ts` now uses Tatum TLS gRPC (`x-api-key` metadata) for **Mainnet, Testnet, and Devnet** health, package/object, transaction, and SUI-balance reads. Mainnet and Testnet endpoints are separate constants and no execution RPC is wrapped. See [Tatum Sui gRPC](https://docs.tatum.io/oa/reference/sui-grpc) and [its JSON-RPC migration guide](https://docs.tatum.io/oa/docs/sui-migration-guide-from-json-rpc-to-grpc).

The server-side `TATUM_API_KEY` remains required. No production or Testnet transaction, transfer, simulation, signing, or wallet key operation is authorized by this integration.

## Claude-compatible MCP design

`src/lib/server/stakemate-mcp.ts` is a working official TypeScript MCP SDK stdio server; `npm run mcp:stdio` is its entry point. A protected local broker supplies a short-lived authenticated wallet context; agent input never supplies the owner wallet. [Claude Desktop setup](CLAUDE_DESKTOP_MCP.md) documents the deliberately credential-free configuration.

| Tool | Authorization | Effect |
| --- | --- | --- |
| `stakemate_get_verified_fixtures` | public read | verified football-data.org fixture data |
| `stakemate_resolve_username` | public read | public-handle lookup |
| `stakemate_read_my_credibility` | authenticated wallet owner only | caller's validated Memory-derived credibility view |
| `stakemate_prepare_duel` | authenticated wallet owner only | immutable preview only |
| `stakemate_get_my_invitations` | authenticated wallet owner only | read-only invitation audit summary |

There is deliberately no send-invitation, accept, wallet-signing, funding, settlement, or impersonation MCP tool. Any future invitation-send tool must require a server-authenticated wallet owner and an explicit human confirmation for the exact canonical terms. MCP is an open client/server protocol; the intended Claude-compatible transport follows [Anthropic’s MCP documentation](https://docs.anthropic.com/en/docs/mcp).

## Escrow draw refund rule

`contracts/stakemate/sources/challenge_escrow.move` uses outcome `0` for a draw/void and returns the entire stored creator and opponent balances to their immutable owners. There is no contract fee or deduction from principal. Network gas is paid separately by the transaction sender and is not an escrow deduction.

The existing Move scenario suite covers creator win, opponent win, exact draw refunds, creator cancellation, duplicate settlement rejection, and unauthorized settlement rejection in `contracts/stakemate/tests/challenge_escrow_tests.move`. The contract remains Testnet-only and no funding flow is activated.

## Tatum AI Builder handoff

Recommended component: a public **“Memory-informed challenge explanation”** panel. It should show a confidence/rationale only when `recallValidatedRecords()` returns valid provenance; otherwise it must say that no personalized recommendation is available. It must never expose recall plaintext, credentials, wallet addresses beyond existing user-visible identity, or an invitation/funding action.

Manual Tatum AI Builder work: open the external AI Builder interface, supply the component brief and design assets, inspect generated code for secret exposure and action buttons, then export/review the result before adoption. StakeMate has **not** used Tatum AI Builder in this repository.

## Demo, README, and blog

See [PUBLIC_DEMO_AND_BLOG.md](PUBLIC_DEMO_AND_BLOG.md). The public narrative must show the learning loop as: verified event → proposed memory → approval-gated Mainnet receipt → provenance-validated recall → recommendation. Never represent a mock, dry run, accepted job, or unverified recall as a completed memory.
