import { createHash } from "node:crypto";
import { assertApplicationWritesAllowed } from "@/lib/server/maintenance-write-freeze";
import type { Profile } from "@/lib/server/invitations";
import { remoteMcpPrivateScopes, type RemoteMcpPrivateScope } from "@/lib/server/remote-oauth-authorization";
import type { PostgresRemoteMcpConsentRequestStore, RemoteMcpConsentRequest } from "@/lib/server/remote-mcp-consent-requests";

export type LocalMcpOAuthClient = Readonly<{ clientId: string; redirectUris: readonly string[]; allowedScopes: readonly RemoteMcpPrivateScope[] }>;

/**
 * Deliberately static development registry. It is not dynamic registration and
 * must never be populated from an OAuth request, environment string, or UI.
 */
export const localMcpOAuthClients: readonly LocalMcpOAuthClient[] = [
  { clientId: "stakemate-local-mcp-preview", redirectUris: ["http://127.0.0.1:3001/mcp/local-oauth-callback"], allowedScopes: remoteMcpPrivateScopes },
] as const;

export type ValidatedLocalAuthorizationRequest = Readonly<{ client: LocalMcpOAuthClient; state: string; redirectUri: string; scopes: RemoteMcpPrivateScope[]; codeChallenge: string; codeChallengeMethod: "S256" }>;
export type LocalAuthorizationRequestError = "invalid_request" | "unauthorized_client" | "invalid_scope";
export type LocalAuthorizationRequestValidation = { ok: true; request: ValidatedLocalAuthorizationRequest } | { ok: false; error: LocalAuthorizationRequestError };

const statePattern = /^[\x21-\x7e]{8,512}$/;
const challengePattern = /^[A-Za-z0-9_-]{43,128}$/;
const stateHash = (value: string) => createHash("sha256").update(`stakemate.remote-mcp.oauth-state.v1\n${value}`, "utf8").digest("hex");

function one(input: URLSearchParams, key: string) {
  const values = input.getAll(key);
  return values.length === 1 ? values[0] : null;
}

/** Validate before any redirect or persistent write. No error includes caller-provided values. */
export function validateLocalAuthorizationRequest(input: URLSearchParams, registry: readonly LocalMcpOAuthClient[] = localMcpOAuthClients): LocalAuthorizationRequestValidation {
  const responseType = one(input, "response_type"); const clientId = one(input, "client_id"); const redirectUri = one(input, "redirect_uri"); const state = one(input, "state"); const scope = one(input, "scope"); const challenge = one(input, "code_challenge"); const method = one(input, "code_challenge_method");
  if (!responseType || !clientId || !redirectUri || !state || !scope || !challenge || !method || responseType !== "code" || method !== "S256" || !statePattern.test(state) || !challengePattern.test(challenge)) return { ok: false, error: "invalid_request" };
  const client = registry.find((candidate) => candidate.clientId === clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) return { ok: false, error: "unauthorized_client" };
  if (scope.trim() !== scope || scope.includes("  ")) return { ok: false, error: "invalid_scope" };
  const requested = scope.split(" ");
  if (!requested.length || new Set(requested).size !== requested.length || !requested.every((item): item is RemoteMcpPrivateScope => remoteMcpPrivateScopes.includes(item as RemoteMcpPrivateScope) && client.allowedScopes.includes(item as RemoteMcpPrivateScope))) return { ok: false, error: "invalid_scope" };
  return { ok: true, request: { client, state, redirectUri, scopes: requested as RemoteMcpPrivateScope[], codeChallenge: challenge, codeChallengeMethod: "S256" } };
}

export function localMcpAuthorizationPreviewEnabled() {
  const publicOrigin = process.env.STAKEMATE_PUBLIC_ORIGIN;
  try { const origin = new URL(publicOrigin ?? ""); return process.env.STAKEMATE_REMOTE_MCP_LOCAL_PREVIEW === "true" && origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname) && origin.port === "3001"; } catch { return false; }
}

/**
 * This path creates only a consent *preview* request. It cannot issue an
 * authorization code, token, or redirect to the client. The application write
 * freeze is checked before persistence, so the shipped configuration fails closed.
 */
export async function createLocalAuthorizationConsentPreview(validated: ValidatedLocalAuthorizationRequest, profile: Profile, store: Pick<PostgresRemoteMcpConsentRequestStore, "create">, now = new Date()): Promise<RemoteMcpConsentRequest> {
  assertApplicationWritesAllowed("remote_mcp_local_authorization_preview_create");
  return store.create({ oauthSubject: `local-preview-profile:${profile.id}`, clientId: validated.client.clientId, requestedScopes: validated.scopes, oauthRequest: { stateHash: stateHash(validated.state), redirectUri: validated.redirectUri, codeChallenge: validated.codeChallenge, codeChallengeMethod: validated.codeChallengeMethod } }, now);
}
