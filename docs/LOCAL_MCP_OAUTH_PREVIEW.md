# Local Remote MCP OAuth authorization preview

This is a development/test-only authorization-request boundary. It is not a public OAuth authorization server, does not enable `/api/mcp`, and does not issue authorization codes, access tokens, refresh tokens, or redirects to an AI client.

## Registered local client

The server owns a static registry in `local-mcp-oauth-authorization.ts`; it is not populated by request parameters or environment variables. The sole development client is `stakemate-local-mcp-preview`, with exactly this redirect URI:

`http://127.0.0.1:3001/mcp/local-oauth-callback`

It may request only `duels:prepare`, `credibility:read`, and `invitations:read`. The registry requires an exact string match, so query-string, host, scheme, path, and trailing-slash changes are rejected.

## Preview flow

1. A local client sends a request to `/api/mcp/oauth/authorize` with exactly one `response_type=code`, `client_id`, `redirect_uri`, `state`, `scope`, `code_challenge`, and `code_challenge_method=S256`.
2. The validator rejects duplicate parameters, unknown clients, unregistered redirect URIs, unsupported scopes, malformed/short state, non-S256 PKCE, and non-code response types before any write or redirect. Invalid input is returned as a local JSON error; StakeMate never redirects to caller input.
3. The endpoint is unavailable unless `STAKEMATE_REMOTE_MCP_LOCAL_PREVIEW=true` and the StakeMate origin is exact loopback HTTP on port 3001. It resolves the wallet and immutable profile only from the authenticated StakeMate session.
4. A valid handoff records only hashes of caller state and browser consent state, plus the exact registered redirect URI and S256 challenge. These fields are immutable in migration `0007`. The server creates a separate internal consent-page state and HttpOnly CSRF cookie; it does not expose the caller's state to the browser consent page.
5. With `STAKEMATE_MAINTENANCE_WRITE_FREEZE=true` (required for this milestone), persistence is blocked before a request is created. The local endpoint returns `423`; it does not redirect, approve, deny, create a code, or issue any token. The consent UI remains preview-only.

The supplied local development route has only one possible success navigation target: StakeMate's own authenticated consent page. It never redirects to the registered callback yet. The callback and all tokens remain unimplemented.

## Remaining work before any real OAuth use

- independently review and deploy a real authorization server with HTTPS, issuer metadata, protected-resource metadata, client registration policy, PKCE verifier/code storage, authorization-code exchange, rotation/revocation, and audited key management;
- replace the local static registry with a reviewed production client registry and exact HTTPS redirect policy;
- bind each approved decision to a one-time authorization code, then atomically exchange it only after PKCE verifier validation;
- use opaque/sender-constrained short-lived tokens or equivalent introspection, authenticate every private MCP request against revocable persisted consent, and add rate limits/audit events that do not contain tokens or state;
- conduct threat modeling, browser/CSRF review, a production migration rehearsal, and explicit deployment approval before enabling `/api/mcp`.

No wallet signing, escrow/funding action, Mainnet/Walrus write, or private-memory access is part of this preview.
