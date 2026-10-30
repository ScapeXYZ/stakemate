import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { assertApplicationWritesAllowed } from "@/lib/server/maintenance-write-freeze";
import { postgresSslForDatabaseUrl } from "@/lib/server/postgres-connection-security";
import { remoteMcpPrivateScopes, type RemoteMcpPrivateScope } from "@/lib/server/remote-oauth-authorization";

const lifetimeMs = 60_000;
const address = (value: string) => normalizeSuiAddress(value).toLowerCase();
const codeHash = (value: string) => createHash("sha256").update(`stakemate.remote-mcp.authorization-code.v1\n${value}`, "utf8").digest("hex");
const s256 = (value: string) => createHash("sha256").update(value, "ascii").digest("base64url");
const verifierPattern = /^[A-Za-z0-9\-._~]{43,128}$/;
const challengePattern = /^[A-Za-z0-9_-]{43,128}$/;
const scopes = (value: unknown): RemoteMcpPrivateScope[] | null => Array.isArray(value) && value.length > 0 && new Set(value).size === value.length && value.every((item): item is RemoteMcpPrivateScope => typeof item === "string" && remoteMcpPrivateScopes.includes(item as RemoteMcpPrivateScope)) ? value : null;

export type AuthorizationCodeIssue = { authorizationId: string; clientId: string; redirectUri: string; profileId: string; walletAddress: string; scopes: RemoteMcpPrivateScope[]; codeChallenge: string; codeChallengeMethod: "S256"; expiresAt?: string };
export type ConsumedAuthorizationCode = { authorizationId: string; profileId: string; walletAddress: string; scopes: RemoteMcpPrivateScope[]; consumedAt: string };

/** Server-only lifecycle primitive. Callers must never log or persist the returned plaintext code. */
export class PostgresRemoteMcpAuthorizationCodeStore {
  private readonly sql: postgres.Sql;
  constructor(databaseUrl: string) { this.sql = postgres(databaseUrl, { prepare: false, max: 4, ssl: postgresSslForDatabaseUrl(databaseUrl), idle_timeout: 20, connect_timeout: 10 }); }
  async close() { await this.sql.end({ timeout: 5 }); }

  async issue(input: AuthorizationCodeIssue, now = new Date()) {
    assertApplicationWritesAllowed("remote_mcp_authorization_code_issue");
    const approved = scopes(input.scopes); const expiresAt = input.expiresAt ?? new Date(now.getTime() + lifetimeMs).toISOString();
    if (!input.authorizationId || !input.clientId || !input.redirectUri || !input.profileId || !approved || !challengePattern.test(input.codeChallenge) || input.codeChallengeMethod !== "S256" || Date.parse(expiresAt) <= now.getTime()) throw new Error("REMOTE_MCP_AUTHORIZATION_CODE_INVALID");
    const code = randomBytes(32).toString("base64url"); const id = randomUUID();
    const [row] = await this.sql`insert into stakemate_remote_mcp_authorization_codes (id, authorization_id, oauth_client_id, redirect_uri, profile_id, wallet_address, approved_scopes, code_hash, pkce_code_challenge, pkce_code_challenge_method, issued_at, expires_at)
      values (${id}, ${input.authorizationId}, ${input.clientId}, ${input.redirectUri}, ${input.profileId}, ${address(input.walletAddress)}, ${approved}, ${codeHash(code)}, ${input.codeChallenge}, 'S256', ${now.toISOString()}, ${expiresAt}) returning id`;
    if (!row) throw new Error("REMOTE_MCP_AUTHORIZATION_CODE_ISSUE_FAILED");
    return { id: String(row.id), code, expiresAt };
  }

  async consume(input: { code: string; clientId: string; redirectUri: string; codeVerifier: string }, now = new Date()): Promise<ConsumedAuthorizationCode | null> {
    assertApplicationWritesAllowed("remote_mcp_authorization_code_consume");
    if (!input.code || !input.clientId || !input.redirectUri || !verifierPattern.test(input.codeVerifier)) return null;
    const challenge = s256(input.codeVerifier);
    // The challenge predicate belongs in the same UPDATE as consumption so a
    // successful PKCE verification and one-time use cannot race each other.
    const [row] = await this.sql`update stakemate_remote_mcp_authorization_codes code set consumed_at = ${now.toISOString()}
      from stakemate_remote_mcp_authorizations authz join stakemate_profiles profile on profile.id = authz.profile_id and profile.wallet_address = authz.wallet_address
      where code.code_hash = ${codeHash(input.code)} and code.consumed_at is null and code.expires_at > ${now.toISOString()}
        and code.oauth_client_id = ${input.clientId} and code.redirect_uri = ${input.redirectUri}
        and code.pkce_code_challenge_method = 'S256' and code.pkce_code_challenge = ${challenge}
        and authz.id = code.authorization_id and authz.oauth_client_id = code.oauth_client_id
        and authz.profile_id = code.profile_id and authz.wallet_address = code.wallet_address
        and authz.revoked_at is null and authz.expires_at > ${now.toISOString()}
      returning code.authorization_id, code.profile_id, code.wallet_address, code.approved_scopes, code.consumed_at`;
    if (!row) return null;
    const approved = scopes(row.approved_scopes); if (!approved) return null;
    return { authorizationId: String(row.authorization_id), profileId: String(row.profile_id), walletAddress: address(String(row.wallet_address)), scopes: approved, consumedAt: new Date(row.consumed_at as Date).toISOString() };
  }
}

export const remoteMcpAuthorizationCodeHash = codeHash;
export const remoteMcpPkceS256 = s256;
