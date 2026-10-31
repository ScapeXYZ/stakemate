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

It sends no authorization header, creates no client, follows no OAuth flow, and does not issue/exchange/store a token. It verifies exact issuer, HTTPS endpoints, authorization-code support, PKCE S256, public JWKS shape, CIMD and DCR advertisement, and advertised scope presence. It cannot prove the scopes will be issued to a CIMD client.

Run it only in an isolated local process after copying the public staging issuer from WorkOS: `STAKEMATE_WORKOS_SANDBOX_PROBES_ENABLED=true STAKEMATE_WORKOS_CONNECT_ISSUER=<issuer> npm run workos:probe`. It prints only compatibility booleans and failures; it never prints credentials or tokens.

## Implemented safe foundation and current blockers

- StakeMate now has a protected-resource metadata route at `/.well-known/oauth-protected-resource`. It returns the fixed production resource `https://stakemate.isholadigital.tech/api/mcp` only when `STAKEMATE_WORKOS_CONNECT_ISSUER` is a valid, root HTTPS `*.authkit.app` issuer. This discovery route does not enable `/api/mcp`, issue tokens, or bypass the maintenance freeze.
- The issuer must be copied from WorkOS and verified through its authorization-server metadata; do not derive or guess it. The read-only probe now verifies issuer identity, HTTPS authorization/token/JWKS endpoints, authorization-code and S256 support, a public JWKS key, CIMD advertisement, and advertised custom scopes.
- No External Sign-in URI exists yet. StakeMate profiles hold wallet and username identity but no verified email address, while Standalone Connect completion requires a stable user ID and verified email. Do not configure a Login URI or implement completion until a reviewed verified-email enrollment and explicit wallet-profile-to-WorkOS-user binding design exists.
- WorkOS documents that CIMD/DCR clients cannot receive client-specific custom scopes; their metadata normally advertises only `openid`, `profile`, `email`, and `offline_access`. That does **not** determine what a dashboard-created OAuth application can issue: WorkOS documents that permissions assigned to that application are requested as scopes, and rejects only scopes that are not assigned. Therefore `customScopesAdvertised=false` is diagnostic, not a token-issuance verdict. The registered **StakeMate MCP Sandbox** application is the only no-support path worth testing for the three private scopes. Until a sandbox token proves its exact `scope`, `client_id`, `sub`, `jti`, `iss`, and `aud` claims, the existing strict verifier will correctly reject a token with only standard OIDC scopes or any unallowlisted scope.

## Safe authorization-code + PKCE sandbox test

This is a manual, sandbox-only test plan. It does not enable the MCP route, change the maintenance freeze, or require a production database write.

1. In the **staging** WorkOS dashboard, inspect the existing **StakeMate MCP Sandbox** OAuth application. Confirm it has exactly the three private permissions assigned. Copy its client ID and its already-registered redirect URI from the dashboard; do not create or guess a redirect URI.
2. In Claude, select **Use your own OAuth client** and determine from that UI whether it accepts the application as a public PKCE client or requires confidential-client credentials. Do not give Claude a WorkOS client secret unless the UI explicitly supports confidential OAuth credentials and the security owner approves that storage. If Claude only accepts a client ID, the WorkOS application must be a public application and use S256 PKCE.
3. Start authorization only from a local sandbox harness using the copied client ID, redirect URI, the fixed resource `https://stakemate.isholadigital.tech/api/mcp`, a fresh high-entropy `state`, `nonce`, and S256 PKCE verifier/challenge. Keep the verifier and authorization code in process memory; never place them in a URL log, test fixture, shell history, or source file.
4. Complete the existing-user login only for a real StakeMate account after a reviewed bridge proves that the current wallet session is bound to a user-controlled, verified email. The Login URI receives only `external_auth_id`; it must ignore request-supplied wallet/profile/scope/client/redirect values, use the authenticated server session, and call WorkOS completion with the server-selected immutable profile binding. There is no safe implementation of this step today because StakeMate profiles have no verified-email identity.
5. Exchange the code once at WorkOS only after successful browser return. Validate its JWT signature against the discovered JWKS and require the exact issuer and audience above. Record only a pass/fail matrix for: `iss`, `aud`, `client_id`, nonempty `sub`, `jti`, `exp`, S256 use, and the exact approved scope set. Do not log the code, access token, refresh token, client secret, email, subject, or any decoded values.
6. Treat any absent/extra scope, incorrect audience, missing identity binding, failed consent lookup, or failed one-time-code/replay check as a failure. Revoke the sandbox consent after the test.

The existing server components already provide the local pieces a future self-hosted path would need: one-time, 60-second PKCE-bound authorization codes; hashed code/JTI/state records; explicit, wallet-profile-bound consent; revocation; and exact private-scope validation. They deliberately do **not** expose an authorization-server endpoint or mint tokens. Building that server remains a fallback only if the registered WorkOS application cannot be used with Claude; it would require an approved external callback/consent implementation and a sandbox database, neither of which is authorized in this task.

## Claude compatibility status

**CIMD is not compatible with StakeMate's private scopes without an environment-wide WorkOS default, which this task will not request.** Claude's published-identity and automatic-registration modes create/use CIMD/DCR-style clients and therefore cannot use app-specific scope assignment. **Use your own OAuth client may be compatible** only if Claude can use the existing registered WorkOS application with its exact registered redirect URI and appropriate public-PKCE or approved confidential-client configuration. Anthropic's public help describes the choice but does not document the fields or callback URI, so that must be observed in the Claude UI rather than invented here. Claude's documented cloud-origin connection requirement means localhost cannot validate the full connector flow.

## Pricing and approval questions

- WorkOS says sandbox/staging use is free and AuthKit user management is free through 1M MAU, but **WorkOS Connect production pricing is not confirmed here**. Obtain a current written quote before production approval. [Pricing](https://workos.com/pricing)
- Confirm whether CIMD alone supports Claude’s published identity mode before enabling DCR. DCR increases anonymous-client-registration exposure.
- Confirm the supported scope claim, resource/audience behavior, refresh-token policy, token revocation propagation, and completion API audit/data-retention behavior.
- Obtain a security review for the Login URI/external-auth-id callback and the WorkOS completion request before code is written for it.
