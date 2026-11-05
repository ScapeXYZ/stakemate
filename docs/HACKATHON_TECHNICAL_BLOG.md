# StakeMate: Evidence-backed memory without agent custody

Football prediction tools are easy to make persuasive and hard to make accountable. StakeMate is our attempt to keep the useful part—learning from verified history—while refusing the dangerous shortcuts: no agent-held keys, no background payouts, and no “memory” accepted merely because a model says it saw it.

StakeMate starts with immutable, wallet-authenticated football-duel terms. A fixture must be a future eligible provider fixture; both selections and the draw/void path are explicit. The application can prepare unsigned Testnet transaction previews, but it does not sign for a participant or move value on their behalf.

The memory layer is deliberately evidence-first. Each record is versioned and canonically serialized before it is hashed. A recalled record is useful only when its record ID, canonical SHA-256 digest, frozen manifest entry, and completed Walrus receipt agree. That rule matters because a completed provider job alone is not enough evidence of the exact content later being used by an agent.

For the submitted historical batch, the retained private verifier recorded 10 completed Walrus Mainnet receipts, 10 distinct blob IDs, HTTP 200 retrieval from the Mainnet aggregator for every blob, and 10 canonical recall matches. The public-safe facts and batch digest are in the [redacted evidence manifest](HACKATHON_EVIDENCE_MANIFEST.md). We do not present that batch as perpetual-storage proof, current-user history, or authorization for further writes.

Tatum supplies a separate read-only Sui Testnet evidence boundary. StakeMate uses TLS gRPC calls for service information, the pinned package object, and the publish transaction. The observed package contains `challenge_escrow`, and the recorded publication transaction succeeded. These checks are provider observations—not a substitute for an independent smart-contract audit, and not a reason to enable signing.

The most important feature is what remains off. Walrus writes are disabled. Production wallet insights fail closed until a reviewed durable manifest/receipt import is approved. Remote private MCP is disabled. Automated settlement broadcasting is disabled; any future Testnet execution still needs a managed signer review, exact authority binding, simulation, explicit approval, and durable controls.

That is the project’s claim: an agent can become more useful from durable evidence without being trusted with custody. The complete code, safety boundaries, and reproducible checks are public in the [StakeMate repository](https://github.com/ScapeXYZ/stakemate).
