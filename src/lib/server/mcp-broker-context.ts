import { mkdir, writeFile, chmod } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { signMcpAuthContext, type McpAuthContext } from "@/lib/server/mcp-auth-context";
import { McpAuthorizationError, type consumeMcpPairing } from "@/lib/server/mcp-authorization";

const contextLifetimeMs = 15 * 60_000;
const slot = (value: string) => /^[a-z0-9][a-z0-9_-]{2,31}$/u.test(value) ? value : null;

/** Only the local CLI broker imports this module; it is never bundled into an app route. */
export async function writeMcpContextForSlot(authorization: Awaited<ReturnType<typeof consumeMcpPairing>>, requestedSlot: string, now = new Date()) {
  const contextSigningKey = process.env.STAKEMATE_MCP_CONTEXT_HMAC_KEY ?? "";
  const directory = process.env.STAKEMATE_MCP_CONTEXT_DIRECTORY ?? "";
  const safeSlot = slot(requestedSlot);
  if (contextSigningKey.length < 32) throw new McpAuthorizationError("MCP_BROKER_KEY_REQUIRED", "A protected broker HMAC key is required.");
  if (!safeSlot || !isAbsolute(directory) || resolve(directory) === "/" || resolve(directory).startsWith(`${process.cwd()}/`)) throw new McpAuthorizationError("MCP_CONTEXT_DIRECTORY_INVALID", "MCP context directory must be an absolute directory outside the repository.");
  const expiresAt = new Date(Math.min(now.getTime() + contextLifetimeMs, Date.parse(authorization.authorizationExpiresAt))).toISOString();
  const context: McpAuthContext = { authorizationId: authorization.id, walletAddress: authorization.walletAddress, scopes: authorization.scopes, issuedAt: now.toISOString(), expiresAt };
  await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
  const target = join(directory, `${safeSlot}.json`);
  await writeFile(target, JSON.stringify({ ...context, signature: signMcpAuthContext(context, contextSigningKey) }), { mode: 0o600 }); await chmod(target, 0o600);
  return { contextFile: target, expiresAt, username: authorization.username };
}
