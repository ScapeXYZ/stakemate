import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { postgresSslForDatabaseUrl } from "@/lib/server/postgres-connection-security";
import type { Session } from "@/lib/server/postgres-invitations";
import type { Profile } from "@/lib/server/invitations";

export const mcpPrivateScopes = ["duels:prepare", "credibility:read", "invitations:read"] as const;
type McpPrivateScope = (typeof mcpPrivateScopes)[number];
type AuthorizationRow = { id: string; session_id: string; profile_id: string; wallet_address: string; username: string; scopes: unknown; requested_at: Date; pairing_expires_at: Date; consumed_at: Date | null; authorization_expires_at: Date; revoked_at: Date | null };
const pairingLifetimeMs = 5 * 60_000;
const authorizationLifetimeMs = 60 * 60_000;
const codeHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export class McpAuthorizationError extends Error {
  constructor(readonly code: "MCP_BROKER_ISOLATED_PILOT_REQUIRED" | "MCP_PAIRING_INVALID" | "MCP_AUTHORIZATION_REVOKED" | "MCP_BROKER_KEY_REQUIRED" | "MCP_CONTEXT_DIRECTORY_INVALID", message: string) { super(message); }
}

/** Never permits broker records or context files outside the exact disposable pilot. */
export function assertIsolatedMcpBrokerEnvironment() {
  const databaseUrl = process.env.DATABASE_URL;
  const origin = process.env.STAKEMATE_PUBLIC_ORIGIN;
  if (process.env.STAKEMATE_MCP_BROKER_ENABLED !== "true" || !databaseUrl || !origin) throw new McpAuthorizationError("MCP_BROKER_ISOLATED_PILOT_REQUIRED", "MCP broker is disabled outside the explicit isolated pilot.");
  let database: URL; let publicOrigin: URL;
  try { database = new URL(databaseUrl); publicOrigin = new URL(origin); } catch { throw new McpAuthorizationError("MCP_BROKER_ISOLATED_PILOT_REQUIRED", "MCP broker requires the isolated local pilot configuration."); }
  if (!(["localhost", "127.0.0.1"].includes(database.hostname) && database.port === "55435" && publicOrigin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(publicOrigin.hostname) && publicOrigin.port === "3001")) throw new McpAuthorizationError("MCP_BROKER_ISOLATED_PILOT_REQUIRED", "MCP broker refuses non-disposable databases and non-local origins.");
}

function database() {
  assertIsolatedMcpBrokerEnvironment();
  return postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, ssl: postgresSslForDatabaseUrl(process.env.DATABASE_URL!), idle_timeout: 10, connect_timeout: 10 });
}
function scopes(value: unknown): McpPrivateScope[] {
  if (!Array.isArray(value) || value.length !== mcpPrivateScopes.length || value.some((item) => !mcpPrivateScopes.includes(item as McpPrivateScope))) throw new Error("Invalid MCP authorization scopes.");
  return [...value] as McpPrivateScope[];
}

export async function createMcpPairing(session: Session, profile: Profile, now = new Date()) {
  assertIsolatedMcpBrokerEnvironment();
  if (normalizeSuiAddress(session.walletAddress).toLowerCase() !== profile.walletAddress) throw new McpAuthorizationError("MCP_PAIRING_INVALID", "Authenticated wallet no longer matches its permanent username.");
  const rawCode = randomBytes(32).toString("base64url"); const id = randomUUID(); const sql = database();
  try {
    await sql`insert into stakemate_mcp_authorizations (id, session_id, profile_id, wallet_address, username, scopes, pairing_code_hash, requested_at, pairing_expires_at, consumed_at, authorization_expires_at, revoked_at) values (${id}, ${session.id}, ${profile.id}, ${profile.walletAddress}, ${profile.username}, ${sql.json(mcpPrivateScopes)}, ${codeHash(rawCode)}, ${now.toISOString()}, ${new Date(now.getTime() + pairingLifetimeMs).toISOString()}, null, ${new Date(now.getTime() + authorizationLifetimeMs).toISOString()}, null)`;
    return { pairingCode: rawCode, expiresAt: new Date(now.getTime() + pairingLifetimeMs).toISOString(), username: profile.username };
  } catch (error) { void error; throw new McpAuthorizationError("MCP_PAIRING_INVALID", "Unable to create a local MCP pairing authorization."); } finally { await sql.end({ timeout: 2 }); }
}

export async function revokeMcpAuthorizationsForSession(session: Session, now = new Date()) {
  assertIsolatedMcpBrokerEnvironment(); const sql = database();
  try { const result = await sql`update stakemate_mcp_authorizations set revoked_at = ${now.toISOString()} where session_id = ${session.id} and wallet_address = ${normalizeSuiAddress(session.walletAddress).toLowerCase()} and revoked_at is null`; return result.count; } finally { await sql.end({ timeout: 2 }); }
}

export async function mcpAuthorizationStatusForSession(session: Session, now = new Date()) {
  assertIsolatedMcpBrokerEnvironment(); const sql = database();
  try {
    const [row] = await sql`select consumed_at, revoked_at, pairing_expires_at, authorization_expires_at from stakemate_mcp_authorizations where session_id = ${session.id} and wallet_address = ${normalizeSuiAddress(session.walletAddress).toLowerCase()} order by requested_at desc limit 1`;
    if (!row) return { connected: false, state: "not_connected" as const };
    if (row.revoked_at) return { connected: false, state: "revoked" as const };
    if (new Date(row.authorization_expires_at as Date).getTime() <= now.getTime()) return { connected: false, state: "expired" as const };
    if (!row.consumed_at && new Date(row.pairing_expires_at as Date).getTime() <= now.getTime()) return { connected: false, state: "pairing_expired" as const };
    return { connected: Boolean(row.consumed_at), state: row.consumed_at ? "connected" as const : "pairing_pending" as const };
  } finally { await sql.end({ timeout: 2 }); }
}

export async function consumeMcpPairing(pairingCode: string, now = new Date()) {
  assertIsolatedMcpBrokerEnvironment(); const sql = database();
  try {
    const [row] = await sql<AuthorizationRow[]>`update stakemate_mcp_authorizations set consumed_at = ${now.toISOString()} where pairing_code_hash = ${codeHash(pairingCode)} and consumed_at is null and revoked_at is null and pairing_expires_at > ${now.toISOString()} and authorization_expires_at > ${now.toISOString()} and exists (select 1 from stakemate_sessions s where s.id = stakemate_mcp_authorizations.session_id and s.wallet_address = stakemate_mcp_authorizations.wallet_address and s.revoked_at is null and s.expires_at > ${now.toISOString()}) returning *`;
    if (!row) throw new McpAuthorizationError("MCP_PAIRING_INVALID", "Pairing code is invalid, expired, already consumed, or revoked.");
    return { id: String(row.id), walletAddress: normalizeSuiAddress(String(row.wallet_address)).toLowerCase(), username: String(row.username), scopes: scopes(row.scopes), authorizationExpiresAt: new Date(row.authorization_expires_at).toISOString() };
  } finally { await sql.end({ timeout: 2 }); }
}

export async function mcpAuthorizationIsActive(authorizationId: string, walletAddress: string, now = new Date()) {
  try {
    assertIsolatedMcpBrokerEnvironment(); const sql = database();
    try { const [row] = await sql`select a.id from stakemate_mcp_authorizations a join stakemate_sessions s on s.id = a.session_id where a.id = ${authorizationId} and a.wallet_address = ${normalizeSuiAddress(walletAddress).toLowerCase()} and a.consumed_at is not null and a.revoked_at is null and a.authorization_expires_at > ${now.toISOString()} and s.revoked_at is null and s.expires_at > ${now.toISOString()}`; return Boolean(row); } finally { await sql.end({ timeout: 2 }); }
  } catch { return false; }
}
