# StakeMate demo narration (about 2–3 minutes)

“StakeMate is a football prediction-duel prototype built around one constraint: an agent can use evidence, but it never gets custody.

First, this is the public app and repository. A participant connects a Sui Testnet wallet and signs only a readable authentication message. StakeMate creates immutable football-duel terms from an eligible future fixture. The result is a preview and an audit trail—not a hidden action. I’m not enabling funding, signing, or settlement here.

Next, the evidence layer. This redacted manifest identifies a frozen Walrus Mainnet batch with digest `590fb952…9c02f`. The private retained verifier recorded ten canonical records, ten completed receipts, and ten distinct blob IDs. Every blob returned HTTP 200 from the Mainnet aggregator, and ten authenticated recalls matched the manifest’s canonical SHA-256 digests. These are historical verification facts; I’m not doing a new Mainnet write in this demo.

Why the extra checks? A recalled item is accepted only when its record ID, canonical digest, manifest entry, and completed receipt agree. That prevents a memory result from quietly becoming a claim about a user or a football outcome without provenance.

For on-chain evidence, StakeMate uses Tatum’s read-only Sui Testnet gRPC API. The recorded check verified the Testnet chain ID, the pinned `challenge_escrow` package, its module, and the successful publish transaction. It never submits a transaction or exposes an API key.

Finally, here are the deliberate boundaries: new Walrus writes are disabled, production insights fail closed until the durable evidence import is approved, remote private MCP is disabled, and automatic settlement broadcast is disabled. StakeMate demonstrates an evidence-backed learning loop—not an unattended betting or payout system.

The repository, redacted evidence manifest, technical write-up, and the exact limitations are linked in the submission checklist.”
