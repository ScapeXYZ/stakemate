# Remote MCP authorization persistence boundary

This foundation supports a future hosted HTTPS MCP deployment. It does **not** enable `/api/mcp`, create OAuth credentials, or expose a public endpoint.

## Stored authorization facts

`0005_remote_mcp_authorizations.sql` adds a server-only, RLS-enabled table for:

- OAuth subject and client ID;
- immutable StakeMate profile ID and its normalized wallet-address snapshot;
- explicitly approved private MCP scopes;
- a SHA-256 hash of the OAuth token identifier (`jti`), never a raw bearer token, refresh token, wallet key, browser session, or HMAC key;
- grant, expiry, revocation, and last-authenticated timestamps.

The database trigger verifies the profile/wallet binding at insert time. It makes identity, client, scope, token-ID hash, and expiry immutable; revocation cannot be removed. Runtime lookup joins the current profile record to the stored wallet snapshot, so a malformed or inconsistent row fails closed.

## Authorization decision

For every remote private-tool request, the future resource server must:

1. Verify the OAuth access token signature, issuer, audience, expiry, client ID, and non-empty `jti`.
2. Hash only the `jti` with StakeMate's domain-separated hash function.
3. Look up an active record by OAuth subject, client ID, and token-ID hash.
4. Require requested token scopes to be a subset of approved scopes, and grant only that subset to the MCP principal.
5. Refuse absent/revoked/expired consent, profile-wallet drift, malformed records, and database/JWKS failures.

An OAuth identity alone is never a wallet identity. The future consent screen must obtain the existing authenticated StakeMate wallet session server-side and bind the profile selected by that session, never a wallet supplied by OAuth or an MCP client.

## Consent-request preview boundary

`0006_remote_mcp_consent_requests.sql` adds a separate, RLS-enabled pending-consent record. It stores only a domain-separated SHA-256 hash of a random `state` value and CSRF value, the OAuth subject, client ID, requested allowlisted read-only scopes, timestamps, and a one-time decision. It never stores either raw challenge, an OAuth access token, browser session, wallet key, or private Walrus content.

The authenticated `/mcp/consent/[id]` page obtains the profile and normalized wallet only from the StakeMate browser session. It displays the requesting client ID and permissions and exposes explicit **Approve** and **Deny** actions; there is no automatic approval. The decision query atomically checks the pending status, expiry, state, CSRF value, and current profile/wallet binding before recording it. A second decision, an expired request, state/CSRF forgery, scope substitution, or a profile/wallet mismatch fails closed. Browser-origin checks and a per-request HttpOnly CSRF cookie are required for a live decision.

The application write freeze intentionally makes the page preview-only: it reports that action is unavailable and does not create a consent request, issue a token, or activate MCP. The local development authorization endpoint likewise stops before creating its short-lived request or cookie while the freeze remains active. This is deliberate until a reviewed authorization server provides the OAuth authorization-request, client validation, PKCE, state handoff, and token lifecycle. The consent-management section on the Activity page can read the authenticated wallet's persisted connections, but revocation is likewise blocked while the freeze remains enabled.

The local-only development authorization preview now validates a static client registry, exact redirect URI, `response_type=code`, caller state, read-only scopes, and PKCE `S256` before it can attempt a consent-preview write. Migration `0007` binds a request to hashes of caller state and internal state, the registered redirect URI, and PKCE challenge. It remains unable to create a request under the write freeze and cannot issue a code or token. See [Local OAuth preview](LOCAL_MCP_OAUTH_PREVIEW.md).

Migration `0008` adds the isolated, hash-only authorization-code lifecycle primitive. It atomically verifies S256 PKCE and consumes a code only while its linked authorization remains profile/wallet-consistent and unrevoked. It has no HTTP endpoint and cannot issue access or refresh tokens. See [Authorization-code lifecycle](REMOTE_MCP_AUTHORIZATION_CODE_LIFECYCLE.md).

## Migration rehearsal

The disposable PostgreSQL 17 rehearsal applies `0005` and `0006` only after the profile baseline is present. The two migrations can run in one transaction and roll back cleanly; the rehearsal verifies both tables are absent after rollback. Trigger tests cover immutable authorization fields, profile/wallet binding, and the one-time pending-to-decision transition. RLS is enabled on both tables. This procedure is limited to the loopback disposable database and is not a production migration plan.

## Operations and boundaries

`PostgresRemoteConsentLookup` is server-only. Its `grant` and `revoke` methods obey the existing application write freeze and are not called by any route in this milestone. `/api/mcp` remains disabled.

Before enabling hosted MCP, add reviewed OAuth authorization/token/revocation and metadata endpoints, client validation, PKCE handoff, HTTPS-only cookies, rate-limited token validation, privacy-preserving audit events, key rotation, and a separately approved production migration rehearsal. See [Remote MCP deployment](REMOTE_MCP_DEPLOYMENT.md).
