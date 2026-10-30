# Managed OAuth provider selection for hosted StakeMate MCP

## Recommendation: WorkOS Connect, with StakeMate as the existing-user application

Choose **WorkOS Connect** for the next design/prototype milestone, not a production rollout. It is the closest match for StakeMate because its documented MCP OAuth bridge supports bringing an existing app/user store: WorkOS handles clients, consent, tokens, DCR, and authorization-server metadata while the application keeps its own user authentication. StakeMate's wallet-authenticated browser session and immutable profile binding should remain the only source of wallet identity.

WorkOS documents OAuth 2.1 MCP support, PKCE and DCR, plus the authorization-server metadata needed by MCP clients. Its metadata advertises `S256`, authorization-code and refresh-token grants, introspection, registration, and token endpoints. [WorkOS MCP auth guide](https://workos.com/blog/mcp-auth-developer-guide), [metadata reference](https://workos.com/docs/reference/workos-connect/metadata), and [MCP overview](https://workos.com/mcp) are the implementation evidence.

## Comparison

| Provider | MCP/client onboarding | Wallet-consent fit | Development cost evidence | Decision |
| --- | --- | --- | --- | --- |
| **WorkOS Connect** | Provider documents OAuth 2.1, PKCE, DCR, JWT/JWKS validation, AS metadata, and an MCP bridge for existing users | Strong: keep StakeMate wallet session/profile model and hand off only the authenticated application user | WorkOS says staging is free; AuthKit user management is free through 1M MAU. Confirm Connect production pricing before purchase. [Pricing](https://workos.com/pricing) | **Recommended** |
| Clerk OAuth Applications | [Custom scopes, CIMD, optional DCR, PKCE S256, JWT/JWKS or opaque tokens, and consent UI](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth) are documented | Viable, but StakeMate must design a secure wallet-session-to-Clerk identity/consent bridge; it is less explicitly MCP-bridge-focused | Clerk documents development access, but verify current production pricing and feature gates before selecting | Strong fallback |
| Auth0 | Mature OAuth platform, but its [documented DCR mode is open registration](https://support.auth0.com/center/s/article/Dynamic-Client-Registration) and recommended only for narrow cases | Viable but more assembly and policy review is required for wallet consent and Claude onboarding | Obtain a current quote/plan from Auth0 before evaluating cost | Not selected for first prototype |

Costs are not a production commitment. Provider pricing and MCP support can change; recheck plans and exact connector requirements immediately before procurement or deployment.

## End-to-end target architecture (not enabled)

```mermaid
sequenceDiagram
  participant Claude as Claude MCP client
  participant MCP as StakeMate HTTPS MCP resource
  participant WorkOS as WorkOS Connect authorization server
  participant Consent as StakeMate wallet consent bridge
  participant DB as StakeMate consent/profile database

  Claude->>MCP: Request tool without bearer token
  MCP-->>Claude: 401 + protected-resource metadata
  Claude->>WorkOS: Discover/register client, PKCE S256 authorization request
  WorkOS->>Consent: Existing-user sign-in / explicit consent handoff
  Consent->>DB: Resolve live wallet session + immutable profile; record approval
  WorkOS-->>Claude: Short-lived provider token after approved flow
  Claude->>MCP: Bearer token
  MCP->>WorkOS: Verify JWT against issuer/audience/JWKS
  MCP->>DB: Recheck client, scopes, revocation, profile/wallet binding
  MCP-->>Claude: Only authorized read-only tool result
```

The diagram is an intended design, not a statement that WorkOS, Claude, or a hosted endpoint has been configured. `/api/mcp` remains disabled; no discovery endpoint, registration endpoint, callback, token issuance, or provider account is active.

## Component disposition

Remain:

- StakeMate wallet session validation, profile/wallet immutability, consent records, revocation checks, scope allowlist, and server-side authorization lookup.
- JWT issuer/audience/JWKS validation, now exposed through the provider-neutral local adapter.

Adapt:

- Map WorkOS subject/client claims to the existing `RemoteConsentLookup` record; retain provider token `jti` hashing only if WorkOS token semantics support it after a sandbox review.
- Replace local client-registry and consent-preview handoff with a reviewed WorkOS existing-user bridge.

Retire from a public path:

- Custom OAuth authorization-request, code-issue, code-consume, refresh-token, and client-registration behavior. The existing local-only code lifecycle remains a test/rehearsal artifact, not a parallel production authorization server.

## Provider adapter boundary

`managed-oauth-provider-adapter.ts` is local-only and has no provider credentials. It accepts only HTTPS issuer/audience/JWKS configuration, delegates JWT checks to the existing verifier, and fails closed on invalid configuration, token claims, consent lookup failure, or JWKS outage. Tests use generated local keys and mocked JWKS responses.

Before a secure end-to-end local test, obtain explicit provider selection approval, create only a sandbox tenant, validate WorkOS Connect's existing-user handoff with StakeMate wallet sessions, verify exact Claude connector metadata/DCR behavior, and independently review subject/client/jti claims. Do not enable `/api/mcp`, issue usable tokens, or add public metadata until then.

See the detailed [WorkOS sandbox checklist](WORKOS_CONNECT_SANDBOX_CHECKLIST.md) for dashboard steps, current compatibility evidence, and unresolved claim/Claude-flow questions.
