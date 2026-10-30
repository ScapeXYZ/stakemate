import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authenticatedMcpContextFromEnvironment, signMcpAuthContext, type McpAuthContext } from "../src/lib/server/mcp-auth-context";

const walletAddress = `0x${"a".repeat(64)}`;
const signingKey = "test-only-hmac-key-with-at-least-thirty-two-characters";

async function useContext(context: McpAuthContext, mode = 0o600) {
  const directory = await mkdtemp(join(tmpdir(), "stakemate-mcp-auth-"));
  const file = join(directory, "context.json");
  await writeFile(file, JSON.stringify({ ...context, signature: signMcpAuthContext(context, signingKey) }), { mode });
  await chmod(file, mode);
  return { directory, file };
}

test("MCP private context is short-lived, signed, and restricted to an owner-only file", async () => {
  const now = new Date("2030-01-01T00:00:00.000Z");
  const context: McpAuthContext = { authorizationId: "11111111-1111-4111-8111-111111111111", walletAddress, scopes: ["duels:prepare"], issuedAt: "2029-12-31T23:50:00.000Z", expiresAt: "2030-01-01T00:05:00.000Z" };
  const { directory, file } = await useContext(context);
  const previousFile = process.env.STAKEMATE_MCP_AUTH_CONTEXT_FILE;
  const previousKey = process.env.STAKEMATE_MCP_CONTEXT_HMAC_KEY;
  process.env.STAKEMATE_MCP_AUTH_CONTEXT_FILE = file;
  process.env.STAKEMATE_MCP_CONTEXT_HMAC_KEY = signingKey;
  try {
    const verified = await authenticatedMcpContextFromEnvironment(now);
    assert.equal(verified?.walletAddress, walletAddress);
    assert.deepEqual(verified?.scopes, ["duels:prepare"]);
  } finally {
    if (previousFile === undefined) delete process.env.STAKEMATE_MCP_AUTH_CONTEXT_FILE; else process.env.STAKEMATE_MCP_AUTH_CONTEXT_FILE = previousFile;
    if (previousKey === undefined) delete process.env.STAKEMATE_MCP_CONTEXT_HMAC_KEY; else process.env.STAKEMATE_MCP_CONTEXT_HMAC_KEY = previousKey;
    await rm(directory, { recursive: true, force: true });
  }
});

test("MCP private context fails closed for long-lived, expired, or group-readable files", async () => {
  const now = new Date("2030-01-01T00:00:00.000Z");
  const context: McpAuthContext = { authorizationId: "22222222-2222-4222-8222-222222222222", walletAddress, scopes: ["invitations:read"], issuedAt: "2030-01-01T00:00:00.000Z", expiresAt: "2030-01-01T00:16:00.000Z" };
  const { directory, file } = await useContext(context, 0o644);
  const previousFile = process.env.STAKEMATE_MCP_AUTH_CONTEXT_FILE;
  const previousKey = process.env.STAKEMATE_MCP_CONTEXT_HMAC_KEY;
  process.env.STAKEMATE_MCP_AUTH_CONTEXT_FILE = file;
  process.env.STAKEMATE_MCP_CONTEXT_HMAC_KEY = signingKey;
  try {
    assert.equal(await authenticatedMcpContextFromEnvironment(now), null);
  } finally {
    if (previousFile === undefined) delete process.env.STAKEMATE_MCP_AUTH_CONTEXT_FILE; else process.env.STAKEMATE_MCP_AUTH_CONTEXT_FILE = previousFile;
    if (previousKey === undefined) delete process.env.STAKEMATE_MCP_CONTEXT_HMAC_KEY; else process.env.STAKEMATE_MCP_CONTEXT_HMAC_KEY = previousKey;
    await rm(directory, { recursive: true, force: true });
  }
});
