# Remote MCP deployment requirements

`/api/mcp` is a separate official SDK Streamable HTTP transport, but is **disabled by default** and returns `404`. It is not a fallback for local stdio and does not read local pairing codes, context files, browser cookies, HMAC keys, or wallet material.

## Recommended provider: WorkOS Connect (pending approval)

Use WorkOS Connect as a managed OAuth bridge for StakeMate's existing wallet-authenticated user model, subject to a sandbox compatibility review. WorkOS documents MCP OAuth 2.1 support, PKCE, DCR, provider metadata, JWT/JWKS validation, and a bring-your-own-users bridge. StakeMate must retain wallet/profile consent binding and verify every provider token against current local consent; the provider does not become a wallet authority. See [managed provider selection](MANAGED_OAUTH_PROVIDER_SELECTION.md).

Sandbox setup, only after approval: create custom scopes `duels:prepare`, `credibility:read`, and `invitations:read`; require PKCE S256; configure the StakeMate resource audience; and use only the connector's documented client-registration/redirect policy. Configure short token lifetimes and provider revocation. Do not set provider credentials or remote-MCP enabling variables until the separate deployment review.

Before enabling it, provide a separately reviewed OAuth 2.1 authorization-server deployment with:

- public HTTPS MCP origin and issuer, exact redirect-URI allowlist, PKCE `S256`, state/nonce validation, and registered-client or secure dynamic-client-registration policy;
- durable hashed authorization-code, consent, access-token, refresh-token, expiry, rotation, and revocation records outside production Supabase until separately approved;
- authenticated StakeMate wallet consent page that resolves the wallet session and immutable username server-side, never from OAuth request parameters;
- opaque or sender-constrained access-token introspection that validates issuer, audience/resource, client ID, scopes, expiry, revocation, and wallet principal on every request;
- rate limiting, audit logging without tokens, CSP/CSRF protections on consent pages, key rotation, HTTPS-only cookies, and security review.

The deployment adapter must supply `RemoteAuthorization.verify()` to `createRemoteMcpHandler()`. It may return a principal only after all checks pass; private tools otherwise return `AUTHENTICATION_REQUIRED`. Public fixture and username tools remain available without a principal.

The disabled-by-default production persistence foundation is documented in [Remote MCP authorization persistence](REMOTE_MCP_AUTHORIZATION_PERSISTENCE.md). It binds an OAuth subject/client/token-ID hash to a current immutable StakeMate profile and wallet snapshot, but is not an OAuth server and does not activate `/api/mcp`.

For Claude Web, register the public HTTPS `/api/mcp` URL as a custom connector only after the endpoint exposes OAuth Protected Resource Metadata and Authorization Server Metadata, authorization/token/revocation endpoints, and the verified OAuth verifier. Do not configure local paths, pairing codes, database URLs, HMAC keys, wallet secrets, or provider credentials in Claude Web.
