# Remote MCP authorization-code lifecycle foundation

`0008_remote_mcp_authorization_codes.sql` introduces a database-backed, local-only authorization-code lifecycle primitive. It does not add an OAuth token endpoint, an authorization-code issuer route, refresh tokens, access tokens, or any public service.

## Stored facts and atomic redemption

Each row references a revocable Remote MCP authorization and snapshots its exact client ID, immutable StakeMate profile ID, normalized wallet address, approved read-only scopes, registered redirect URI, and PKCE S256 challenge. It stores only a domain-separated SHA-256 authorization-code hash. Plaintext authorization codes exist only in server-process memory returned from the isolated issuance primitive and must never be logged or persisted.

`consume` validates the verifier format and performs SHA-256/base64url S256 verification in the same PostgreSQL `UPDATE` that sets `consumed_at`. The update also requires the code to be unexpired and unused, and joins the live authorization/profile binding to require matching client, profile, wallet, authorization expiry, and non-revocation. Therefore a replay, concurrent exchange, invalid verifier, client/redirect mismatch, profile drift, expiry, or revoked authorization cannot produce a redemption result.

The table is RLS-enabled. Its trigger rejects binding/scope/wallet substitution, makes code properties immutable, and allows only one `consumed_at` transition. The code store obeys the application write freeze for both issue and consume operations.

## Current boundary

There is no route wired to this store. `/api/mcp` remains disabled. The local authorization preview cannot issue a code while the write freeze is active, and there is no token, refresh token, or callback redirect implementation. This work is a persistence and test harness only.

## Architecture review: custom lifecycle vs managed OAuth

| Concern | Current custom foundation | Managed OAuth provider |
| --- | --- | --- |
| Client registration and redirect policy | Static local registry; production registry is not built | Mature client registry, redirect validation, discovery, and rotation controls |
| Authorization UI/session binding | StakeMate-specific wallet/profile binding is implemented locally | Provider still needs a secure handoff to StakeMate’s wallet session and consent evidence |
| Authorization codes and PKCE | Hashed code storage, S256 binding, expiry, atomic use, revocation join are implemented | Provider normally supplies issuance, verifier checks, replay control, code rotation, and operational hardening |
| Tokens, refresh, key rotation, metadata | Not implemented | Usually supplied with JWKS, discovery, rotation, revocation/introspection, monitoring, and abuse controls |
| MCP compatibility | Not yet validated against a real connector | Providers may simplify standards compliance but must still support the connector’s OAuth discovery, PKCE, resource/audience, and client-registration requirements |

Duplicating a full authorization server would repeat high-risk provider functionality: client registration, redirect URI policy, authorization-code and refresh-token rotation, token signing/JWKS, metadata, revocation, consent audit, key custody/rotation, rate limiting, and incident response. The custom pieces worth retaining are the StakeMate-specific wallet-profile binding, scope policy, revocable consent lookup, and provider-to-MCP principal adapter.

Claude remote MCP connector compatibility remains unverified. Risks include its exact requirements for OAuth Protected Resource Metadata, Authorization Server Metadata, PKCE/redirect handling, client registration or CIMD/DCR policy, resource indicators/audiences, and token format/introspection. Do not claim compatibility until tested with an approved connector and a reviewed provider configuration.

## Minimum remaining work for a secure end-to-end local test

1. Select and configure a local OAuth authorization-server test adapter or managed-provider sandbox with fixed development clients, exact loopback redirects, PKCE S256, and discovery metadata.
2. Add an isolated authorization endpoint that converts an explicitly approved StakeMate consent decision into one hashed, short-lived code bound to the provider/client request; keep the write freeze policy and no public origin.
3. Add a local token-exchange test harness that atomically consumes the code after verifier validation, but returns only a non-usable test artifact until separate token review.
4. Test the adapter with Claude’s documented remote MCP OAuth flow, including metadata discovery and error handling, before any public endpoint, token issuance, or `/api/mcp` activation.
