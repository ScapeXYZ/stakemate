# WorkOS Connect sandbox compatibility checklist

This checklist is preparatory only. No WorkOS account, organization, OAuth client, credential, token, public endpoint, or `/api/mcp` activation has been created by this repository.

## Confirmed from current official documentation

- **Standalone Connect** is intended for applications with an existing authentication stack. AuthKit redirects to the configured application Login URI, the application authenticates the user, then calls the WorkOS completion API; WorkOS performs OAuth consent and token issuance. [Standalone Connect](https://workos.com/docs/authkit/connect/standalone)
- For MCP, WorkOS says to enable **Client ID Metadata Document (CIMD)** under Connect → Configuration. DCR is available for compatibility with clients that do not support CIMD. [MCP documentation](https://workos.com/docs/authkit/mcp)
- WorkOS Authorization Server metadata documents HTTPS authorization, token, JWKS, introspection, registration, and S256 capabilities. [Metadata reference](https://workos.com/docs/reference/workos-connect/metadata)
- Claude's custom-connector UI currently offers three client identification choices: Claude’s published identity, automatic registration, or an administrator-provided client. Claude connects from Anthropic cloud infrastructure, so a future real endpoint must be publicly reachable; no such endpoint exists today. [Claude connector requirements](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

## Manual sandbox setup — requires explicit approval

1. Create a **WorkOS sandbox** environment only; record no credentials in this repository.
2. Create a Connect OAuth application and select **Standalone Connect** / existing-user authentication.
3. Under **Connect → Configuration**, set one sandbox-only HTTPS Login URI controlled by StakeMate. It must accept `external_auth_id`; do not accept a wallet, profile ID, client ID, scope, or redirect URI supplied outside the signed WorkOS handoff.
4. Enable **CIMD**. Do not enable DCR unless a Claude sandbox test proves Claude’s selected client-identification mode needs it. If DCR is enabled, restrict default scopes to the three read-only StakeMate scopes and document the abuse review.
5. Configure the future HTTPS MCP resource URL as a WorkOS **Resource Indicator** and set it as the default only if the chosen Claude mode omits `resource`. The exact string must become both the token `aud` and the protected-resource metadata `resource` value.
6. Configure only `duels:prepare`, `credibility:read`, and `invitations:read`; do not configure write, wallet, funding, escrow, or Walrus scopes.
7. Copy only the public AuthKit issuer URL into an approved sandbox secret/configuration channel. Do not copy WorkOS API keys, client secrets, token values, or WorkOS completion payloads into source control.

## Required identity mapping

The WorkOS `sub` is an OAuth subject, **not** a wallet address. On successful existing-user authentication, StakeMate must server-side resolve its live signed wallet session, load the immutable profile bound to that wallet, and associate the resulting WorkOS subject/client/scope set with that profile in the existing consent store.

| Provider fact | StakeMate binding | Rule |
| --- | --- | --- |
| `sub` | `oauth_subject` | Stored as provider identity only; never treated as a wallet |
| `client_id` | `oauth_client_id` | Must exactly match client metadata/registration identity |
| `aud` | MCP resource audience | Must exactly equal configured Resource Indicator |
| `jti` | hashed token identifier | Domain-hash only; never persist bearer token |
| `scope` | approved read-only scopes | Must be an exact allowed subset and match persisted consent |
| StakeMate session/profile | `profile_id` + normalized wallet snapshot | Resolved only server-side; reject any request-provided wallet |

The documented WorkOS access-token example lists `iss`, `aud`, `client_id`, `sub`, `sid`, `jti`, `exp`, and `iat`. It does **not** show a `scope` claim in that example, while WorkOS MCP guidance says permissions/scopes are included in access tokens. This claim shape and custom-scope behavior are an explicit sandbox blocker: StakeMate must inspect an actual sandbox token’s documented claims without logging its value before enabling the adapter.

## Read-only compatibility probes

`workos-connect-sandbox-probe.ts` is disabled unless `STAKEMATE_WORKOS_SANDBOX_PROBES_ENABLED=true`. Given a public sandbox AuthKit issuer, it only GETs:

- `/.well-known/oauth-authorization-server`
- the public `jwks_uri` returned by that metadata

It sends no authorization header, creates no client, follows no OAuth flow, and does not issue/exchange/store a token. It verifies exact issuer, HTTPS endpoints, authorization-code support, PKCE S256, public JWKS shape, DCR advertisement, and advertised scope presence. It does not prove CIMD is enabled; that remains a dashboard/manual check.

## Claude compatibility status

**Architecture compatible, live compatibility unverified.** Claude exposes published identity, automatic registration, and own-client modes; WorkOS supports CIMD and a DCR fallback. The actual matching mode, whether Claude sends `resource`, whether custom scopes appear in access tokens, and whether Claude accepts WorkOS metadata without a proxy must be tested with a sandbox, a public HTTPS test resource, and explicit approval. Claude's documented cloud-origin connection requirement means localhost cannot validate the full connector flow.

## Pricing and approval questions

- WorkOS says sandbox/staging use is free and AuthKit user management is free through 1M MAU, but **WorkOS Connect production pricing is not confirmed here**. Obtain a current written quote before production approval. [Pricing](https://workos.com/pricing)
- Confirm whether CIMD alone supports Claude’s published identity mode before enabling DCR. DCR increases anonymous-client-registration exposure.
- Confirm the supported scope claim, resource/audience behavior, refresh-token policy, token revocation propagation, and completion API audit/data-retention behavior.
- Obtain a security review for the Login URI/external-auth-id callback and the WorkOS completion request before code is written for it.
