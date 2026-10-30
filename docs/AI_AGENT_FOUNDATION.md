# AI-agent duel foundation (local-only)

`LocalOnlyAgentTools` is a provider-neutral tool core shaped for Claude-compatible MCP clients: list featured fixtures, read a verified fixture, resolve a username, and propose a preview-only duel draft. It is **not** an MCP HTTP server and has no remote listener, credentials, wallet keys, signing capability, invitation mutation, funding action, or settlement tool.

Every call requires a host-provided authenticated session, validated origin, wallet binding, least-privilege scope, bounded Zod input, and one-use request ID. Audit entries contain only tool name, request ID, wallet-bound boolean, and outcome; they do not contain credentials, terms, addresses, or provider payloads. The host, not an agent-supplied address, establishes the wallet identity.

An AI agent is an assistant acting for a user—not an independently funded wallet participant. It can propose two explicit outcomes and return a canonical immutable preview, but it cannot send or accept an invitation. If activation is ever approved, recipient handle resolution must be authenticated, the recipient must explicitly approve as their own authenticated wallet, and a human must approve any transition beyond a preview.

Featured fixture ranking is editorial and deterministic: static competition weight, ten points per reviewed prominent team, and a reviewed-rivalry bonus. It does not represent odds, popularity, real-time importance, or a market probability. Only fresh football-data.org fixtures are considered; the static list never creates a fixture.

Agent drafts call the same `buildDuelDraftTerms` and `hashDuelDraftTerms` implementation as browser drafts, which now produces the v2 football core commitment documented in [CANONICAL_FOOTBALL_DUEL_TERMS.md](CANONICAL_FOOTBALL_DUEL_TERMS.md). Agents cannot assign acceptance-only deadlines or alter an approved preview: there is no invitation, acceptance, funding, or settlement tool. Activation remains blocked pending reviewed persistence of the accepted Move commitment, licensing, result verification, operational authorization, and explicit write approval.
