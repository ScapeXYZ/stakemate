# Wallet-native OAuth: disabled implementation boundary

StakeMate is wallet-first. A Sui Testnet personal-message signature is the only authentication proof; no email address, password, or fabricated identity is used.

## WorkOS decision

WorkOS Standalone Connect is not suitable for this requirement. Its documented completion API creates or updates an AuthKit user using both an external ID **and an email**. It therefore cannot implement a genuinely email-free StakeMate identity without violating this policy. WorkOS is not in the wallet-native authorization path.

## Implemented protocol core

`src/lib/server/wallet-native-oauth.ts` supplies a disabled authorization-server core:

- authorization-code only; implicit and password grants are absent;
- public clients only, with mandatory PKCE S256 and byte-exact registered redirect URIs;
- exact MCP Resource Indicator: `https://stakemate.isholadigital.tech/api/mcp`;
- only `duels:prepare`, `credibility:read`, and `invitations:read`;
- asymmetric ES256/RS256 server-side signing key supplied as `STAKEMATE_WALLET_OAUTH_SIGNING_JWK`; public JWKS omits private material;
- five-minute, exact issuer/audience JWTs with `sub`, `client_id`, `jti`, and scope.

It does **not** expose authorization, token, JWKS, or registration routes and does not enable private MCP. It deliberately has no dynamic client registration endpoint: Claude's chosen registration mode must be observed and reviewed before adding one. No client ID or callback URI is hard-coded for Claude.

## Required implementation before activation

The remaining persistence and browser pieces cannot be safely activated while the maintenance write freeze is in force:

1. Add a reviewed sandbox migration for registered public clients, wallet-bound pending authorization requests, single-use PKCE-bound codes, consent snapshots, hashed refresh-token families, token revocation, and minimal audit events. Do not execute it against production.
2. Extend the wallet challenge to bind the pending authorization-request ID and require a fresh (<5 minute) Sui Testnet signature before consent. Wallet connection or an older browser session alone is insufficient.
3. Add the consent page and approve/deny endpoints. Approval must load the profile from the verified wallet session, not URL/body input, and atomically issue a code. Denial must consume the request without redirect substitution.
4. Add `/api/oauth/authorize`, `/api/oauth/token`, `/api/oauth/jwks`, and `/.well-known/oauth-authorization-server` only behind a new server-side activation gate. The token endpoint must atomically consume the code before issuing a JWT; refresh tokens, if approved, must be opaque, hashed, sender-bound where possible, and rotate/revoke an entire family on reuse.
5. Use the existing remote consent lookup to bind the token `jti` hash, client ID, immutable profile ID, and normalized wallet snapshot. The MCP verifier must continue to derive wallet identity only from that live server-side binding.

## Claude sandbox procedure after review

1. Create a **sandbox-only** registered public client only after observing Claude's selected OAuth-client mode. Claude presently offers published identity, automatic registration, and an operator-provided client; do not assume which applies.
2. Register Claude's exact callback URI from the UI, require PKCE S256, and allow only the three listed scopes.
3. Publish authorization-server metadata and protected-resource metadata from the same public HTTPS origin. Keep DCR absent unless Claude's observed mode requires it and its registration security design is approved.
4. With a Testnet wallet and an existing profile, run authorization, sign the displayed context-bound personal message once, review consent, and exchange the code once with its verifier.
5. Verify issuer, audience, `client_id`, `sub`, `jti`, expiry, scope subset, consent status, and wallet/profile snapshot; then revoke the connection and confirm both access and refresh tokens fail.
6. Only after the security review passes may the operator consider enabling private MCP. Keep `STAKEMATE_MAINTENANCE_WRITE_FREEZE=true` and `STAKEMATE_REMOTE_MCP_ENABLED=false` until that approval.
