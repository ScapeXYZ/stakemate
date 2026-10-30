import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { assertApplicationWritesAllowed } from "@/lib/server/maintenance-write-freeze";
import { postgresSslForDatabaseUrl } from "@/lib/server/postgres-connection-security";
import { remoteMcpPrivateScopes, remoteMcpTokenIdentifierHash, type RemoteConsent, type RemoteConsentLookup, type RemoteMcpPrivateScope } from "@/lib/server/remote-oauth-authorization";

export type RemoteMcpAuthorizationGrant = { oauthSubject: string; clientId: string; profileId: string; walletAddress: string; scopes: RemoteMcpPrivateScope[]; tokenIdentifier: string; expiresAt: string };
const address = (value: string) => normalizeSuiAddress(value).toLowerCase();
const isScope = (value: unknown): value is RemoteMcpPrivateScope => typeof value === "string" && remoteMcpPrivateScopes.includes(value as RemoteMcpPrivateScope);

function scopes(value: unknown): RemoteMcpPrivateScope[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !isScope(item))) return null;
  const unique = [...new Set(value)];
  return unique.length === value.length ? unique : null;
}

/** Server-only production persistence. It stores a one-way token identifier hash, never a bearer token. */
export class PostgresRemoteConsentLookup implements RemoteConsentLookup {
  private readonly sql: postgres.Sql;
  constructor(databaseUrl: string) { this.sql = postgres(databaseUrl, { prepare: false, max: 1, ssl: postgresSslForDatabaseUrl(databaseUrl), idle_timeout: 20, connect_timeout: 10 }); }
  async close() { await this.sql.end({ timeout: 5 }); }

  async activeConsent(input: { subject: string; clientId: string; tokenIdHash: string; requiredScopes: RemoteMcpPrivateScope[] }): Promise<RemoteConsent | null> {
    if (!input.subject || !input.clientId || !/^[0-9a-f]{64}$/i.test(input.tokenIdHash) || !scopes(input.requiredScopes)) return null;
    const [row] = await this.sql`select a.id, a.profile_id, a.wallet_address, a.approved_scopes, a.expires_at, a.revoked_at
      from stakemate_remote_mcp_authorizations a
      join stakemate_profiles p on p.id = a.profile_id and p.wallet_address = a.wallet_address
      where a.oauth_subject = ${input.subject} and a.oauth_client_id = ${input.clientId} and a.token_id_hash = ${input.tokenIdHash}
        and a.revoked_at is null and a.expires_at > clock_timestamp()`;
    if (!row) return null;
    const approved = scopes(row.approved_scopes);
    if (!approved || !input.requiredScopes.every((scope) => approved.includes(scope))) return null;
    return { authorizationId: String(row.id), profileId: String(row.profile_id), walletAddress: address(String(row.wallet_address)), scopes: approved, expiresAt: new Date(row.expires_at as Date).toISOString(), revokedAt: row.revoked_at ? new Date(row.revoked_at as Date).toISOString() : null };
  }

  async grant(input: RemoteMcpAuthorizationGrant, now = new Date()) {
    assertApplicationWritesAllowed("remote_mcp_consent_grant");
    const approved = scopes(input.scopes);
    if (!input.oauthSubject.trim() || !input.clientId.trim() || !input.tokenIdentifier.trim() || !approved || Date.parse(input.expiresAt) <= now.getTime()) throw new Error("REMOTE_MCP_AUTHORIZATION_INVALID");
    const walletAddress = address(input.walletAddress); const id = randomUUID();
    const [row] = await this.sql`insert into stakemate_remote_mcp_authorizations (id, oauth_subject, oauth_client_id, profile_id, wallet_address, approved_scopes, token_id_hash, authorized_at, expires_at, revoked_at, last_authenticated_at)
      select ${id}, ${input.oauthSubject}, ${input.clientId}, p.id, p.wallet_address, ${approved}, ${remoteMcpTokenIdentifierHash(input.tokenIdentifier)}, ${now.toISOString()}, ${input.expiresAt}, null, null
      from stakemate_profiles p where p.id = ${input.profileId} and p.wallet_address = ${walletAddress}
      returning id`;
    if (!row) throw new Error("REMOTE_MCP_PROFILE_WALLET_MISMATCH");
    return String(row.id);
  }

  async revoke(authorizationId: string, now = new Date()) {
    assertApplicationWritesAllowed("remote_mcp_consent_revoke");
    await this.sql`update stakemate_remote_mcp_authorizations set revoked_at = ${now.toISOString()} where id = ${authorizationId} and revoked_at is null`;
  }
}
