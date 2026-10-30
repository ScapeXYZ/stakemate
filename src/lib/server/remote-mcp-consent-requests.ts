import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import postgres from "postgres";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { assertApplicationWritesAllowed } from "@/lib/server/maintenance-write-freeze";
import { postgresSslForDatabaseUrl } from "@/lib/server/postgres-connection-security";
import { remoteMcpPrivateScopes, type RemoteMcpPrivateScope } from "@/lib/server/remote-oauth-authorization";

const requestLifetimeMs = 10 * 60_000;
const address = (value: string) => normalizeSuiAddress(value).toLowerCase();
const digest = (purpose: "state" | "csrf", value: string) => createHash("sha256").update(`stakemate.remote-mcp.consent.${purpose}.v1\n${value}`, "utf8").digest("hex");
const scopes = (value: unknown): RemoteMcpPrivateScope[] | null => Array.isArray(value) && value.length > 0 && value.every((item): item is RemoteMcpPrivateScope => typeof item === "string" && remoteMcpPrivateScopes.includes(item as RemoteMcpPrivateScope)) && new Set(value).size === value.length ? value : null;
const equalHash = (actual: string, expected: string) => { const left = Buffer.from(actual, "hex"); const right = Buffer.from(expected, "hex"); return left.length === right.length && timingSafeEqual(left, right); };

export type RemoteMcpOauthRequestBinding = { stateHash: string; redirectUri: string; codeChallenge: string; codeChallengeMethod: "S256" };
export type RemoteMcpConsentRequest = { id: string; clientId: string; requestedScopes: RemoteMcpPrivateScope[]; expiresAt: string; state: string; csrfToken: string };
export type RemoteMcpConsentReview = Pick<RemoteMcpConsentRequest, "id" | "clientId" | "requestedScopes" | "expiresAt">;
export type RemoteMcpConsentDecision = "approved" | "denied";

/** Server-only request journal for a future OAuth consent screen. Raw state and CSRF values are returned only at creation and are never persisted. */
export class PostgresRemoteMcpConsentRequestStore {
  private readonly sql: postgres.Sql;
  constructor(databaseUrl: string) { this.sql = postgres(databaseUrl, { prepare: false, max: 1, ssl: postgresSslForDatabaseUrl(databaseUrl), idle_timeout: 20, connect_timeout: 10 }); }
  async close() { await this.sql.end({ timeout: 5 }); }

  async create(input: { oauthSubject: string; clientId: string; requestedScopes: RemoteMcpPrivateScope[]; oauthRequest?: RemoteMcpOauthRequestBinding }, now = new Date()): Promise<RemoteMcpConsentRequest> {
    assertApplicationWritesAllowed("remote_mcp_consent_request_create");
    const approved = scopes(input.requestedScopes);
    if (!input.oauthSubject.trim() || !input.clientId.trim() || !approved) throw new Error("REMOTE_MCP_CONSENT_REQUEST_INVALID");
    const id = randomUUID(); const state = randomBytes(32).toString("base64url"); const csrfToken = randomBytes(32).toString("base64url"); const expiresAt = new Date(now.getTime() + requestLifetimeMs).toISOString();
    const binding = input.oauthRequest;
    if (binding && (!/^[0-9a-f]{64}$/.test(binding.stateHash) || !binding.redirectUri || !/^[A-Za-z0-9_-]{43,128}$/.test(binding.codeChallenge) || binding.codeChallengeMethod !== "S256")) throw new Error("REMOTE_MCP_OAUTH_REQUEST_BINDING_INVALID");
    await this.sql`insert into stakemate_remote_mcp_consent_requests (id, oauth_subject, oauth_client_id, requested_scopes, state_hash, csrf_hash, requested_at, expires_at, oauth_state_hash, redirect_uri, pkce_code_challenge, pkce_code_challenge_method) values (${id}, ${input.oauthSubject}, ${input.clientId}, ${approved}, ${digest("state", state)}, ${digest("csrf", csrfToken)}, ${now.toISOString()}, ${expiresAt}, ${binding?.stateHash ?? null}, ${binding?.redirectUri ?? null}, ${binding?.codeChallenge ?? null}, ${binding?.codeChallengeMethod ?? null})`;
    return { id, clientId: input.clientId, requestedScopes: approved, expiresAt, state, csrfToken };
  }

  async review(id: string, state: string, now = new Date()): Promise<RemoteMcpConsentReview | null> {
    if (!id || !state) return null;
    const [row] = await this.sql`select id, oauth_client_id, requested_scopes, expires_at, state_hash from stakemate_remote_mcp_consent_requests where id = ${id} and decision = 'pending' and expires_at > ${now.toISOString()}`;
    if (!row || !equalHash(String(row.state_hash), digest("state", state))) return null;
    const requestedScopes = scopes(row.requested_scopes); if (!requestedScopes) return null;
    return { id: String(row.id), clientId: String(row.oauth_client_id), requestedScopes, expiresAt: new Date(row.expires_at as Date).toISOString() };
  }

  async decide(input: { id: string; state: string; csrfToken: string; decision: RemoteMcpConsentDecision; profileId: string; walletAddress: string }, now = new Date()): Promise<RemoteMcpConsentDecision | null> {
    assertApplicationWritesAllowed("remote_mcp_consent_request_decide");
    if (!input.id || !input.state || !input.csrfToken || (input.decision !== "approved" && input.decision !== "denied")) return null;
    const [row] = await this.sql`update stakemate_remote_mcp_consent_requests request set decision = ${input.decision}, decision_profile_id = profile.id, decision_wallet_address = profile.wallet_address, decided_at = ${now.toISOString()}, used_at = ${now.toISOString()}
      from stakemate_profiles profile
      where request.id = ${input.id} and request.decision = 'pending' and request.expires_at > ${now.toISOString()}
        and request.state_hash = ${digest("state", input.state)} and request.csrf_hash = ${digest("csrf", input.csrfToken)}
        and profile.id = ${input.profileId} and profile.wallet_address = ${address(input.walletAddress)}
      returning request.decision`;
    return row ? row.decision as RemoteMcpConsentDecision : null;
  }

  async connections(profileId: string, walletAddress: string) {
    const rows = await this.sql`select id, oauth_client_id, approved_scopes, authorized_at, expires_at, revoked_at from stakemate_remote_mcp_authorizations where profile_id = ${profileId} and wallet_address = ${address(walletAddress)} order by authorized_at desc`;
    return rows.flatMap((row) => { const approvedScopes = scopes(row.approved_scopes); return approvedScopes ? [{ id: String(row.id), clientId: String(row.oauth_client_id), approvedScopes, authorizedAt: new Date(row.authorized_at as Date).toISOString(), expiresAt: new Date(row.expires_at as Date).toISOString(), revokedAt: row.revoked_at ? new Date(row.revoked_at as Date).toISOString() : null }] : []; });
  }

  async revokeConnection(authorizationId: string, profileId: string, walletAddress: string, now = new Date()) {
    assertApplicationWritesAllowed("remote_mcp_connection_revoke");
    const result = await this.sql`update stakemate_remote_mcp_authorizations set revoked_at = ${now.toISOString()} where id = ${authorizationId} and profile_id = ${profileId} and wallet_address = ${address(walletAddress)} and revoked_at is null`;
    return result.count === 1;
  }
}

let singleton: PostgresRemoteMcpConsentRequestStore | undefined;
export function getRemoteMcpConsentRequestStore() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.trim()) throw new Error("DATABASE_NOT_CONFIGURED");
  singleton ??= new PostgresRemoteMcpConsentRequestStore(databaseUrl);
  return singleton;
}
