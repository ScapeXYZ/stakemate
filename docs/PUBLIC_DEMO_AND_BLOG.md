# Public demo and blog structure

## Five-minute demo

1. Connect a Testnet wallet and authenticate; show the permanent username ownership state.
2. Read a verified upcoming football fixture and produce an immutable preview. Do not send an invitation unless the separately approved isolated pilot gates are enabled.
3. Show the MCP tool definitions: fixture lookup, username resolution, owner-bound draft, and owner-bound credibility read. Point out the absence of signing and invitation-mutation tools.
4. Show a schema-v2 memory candidate and its SHA-256 dry-run digest. State plainly that it is not written.
5. Show the learning loop with a local validated-record fixture: its provenance and its resulting recommendation. Clearly label it as a local demonstration until a completed Mainnet receipt and matching recall exist.
6. Show the Move draw path: outcome `0` refunds both exact deposits; gas is separate. Do not construct or sign a transaction.

## README outline

- Problem: football predictions need durable, auditable learning without giving an agent custody.
- Architecture diagram: wallet session → canonical football terms → isolated invitation audit; event → approval-gated Walrus Memory → provenance-validated recall → recommendation; Tatum gRPC read-only chain evidence.
- Safety posture: maintenance freeze, no active funding/settlement, no agent signing, no secret exposure.
- Run locally: tests/build plus isolated-pilot instructions.
- Evidence table: only completed Walrus receipts with blob IDs count; link redacted evidence manifest when approved.
- Known limits and approval gates.

## Blog outline

1. Why “memory” must be evidence rather than a chat transcript.
2. The schema-v2 record families and canonical digest/idempotency design.
3. Mainnet write approval, managed-relayer uncertainty, receipts, and recall verification.
4. How owner-bound MCP tools avoid impersonation and custody.
5. Read-only Tatum gRPC and separate Testnet/Mainnet configuration.
6. The draw-refund invariant and why gas is outside escrow principal.
7. What remains intentionally disabled.
