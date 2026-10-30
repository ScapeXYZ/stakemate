import { createHmac, timingSafeEqual } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { z } from "zod";

const contextSchema = z.object({
  authorizationId: z.string().uuid(),
  walletAddress: z.string(),
  scopes: z.array(z.enum(["duels:prepare", "credibility:read", "invitations:read"])).min(1),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  signature: z.string().regex(/^[0-9a-f]{64}$/i),
}).strict();

export type McpAuthContext = Omit<z.infer<typeof contextSchema>, "signature">;
const maxContextLifetimeMs = 15 * 60 * 1000;

function canonical(context: McpAuthContext) {
  return `${context.authorizationId}\n${normalizeSuiAddress(context.walletAddress).toLowerCase()}\n${[...context.scopes].sort().join(",")}\n${context.issuedAt}\n${context.expiresAt}\n`;
}

/** Verifies a short-lived wallet context issued by a local authenticated StakeMate broker. */
export async function authenticatedMcpContextFromEnvironment(now = new Date()): Promise<McpAuthContext | null> {
  const path = process.env.STAKEMATE_MCP_AUTH_CONTEXT_FILE;
  const signingKey = process.env.STAKEMATE_MCP_CONTEXT_HMAC_KEY;
  const contextPath = path ?? "";
  const contextSigningKey = signingKey ?? "";
  if (!contextPath || contextSigningKey.length < 32 || !isAbsolute(contextPath)) return null;
  try {
    const metadata = await lstat(contextPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) return null;
    const parsed = contextSchema.parse(JSON.parse(await readFile(contextPath, "utf8")));
    const context: McpAuthContext = { authorizationId: parsed.authorizationId, walletAddress: normalizeSuiAddress(parsed.walletAddress).toLowerCase(), scopes: parsed.scopes, issuedAt: parsed.issuedAt, expiresAt: parsed.expiresAt };
    const issuedAtMs = Date.parse(context.issuedAt);
    const expiresAtMs = Date.parse(context.expiresAt);
    if (issuedAtMs > now.getTime() || expiresAtMs <= now.getTime() || expiresAtMs - issuedAtMs > maxContextLifetimeMs) return null;
    const expected = createHmac("sha256", contextSigningKey).update(canonical(context)).digest();
    const received = Buffer.from(parsed.signature, "hex");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    return context;
  } catch { return null; }
}

/** Test/issuer helper. It is intentionally not exposed through any MCP tool. */
export function signMcpAuthContext(context: McpAuthContext, signingKey: string) {
  return createHmac("sha256", signingKey).update(canonical(context)).digest("hex");
}
