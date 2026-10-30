import { consumeMcpPairing } from "@/lib/server/mcp-authorization";
import { writeMcpContextForSlot } from "@/lib/server/mcp-broker-context";

function argument(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }

async function readCode() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main() {
  const slot = argument("--slot");
  if (!slot) throw new Error("Usage: read -r -s code; printf '%s' \"$code\" | npm run mcp:broker -- --slot <local-slot>");
  const pairingCode = await readCode();
  if (!pairingCode) throw new Error("A pairing code must be supplied on standard input.");
  const authorization = await consumeMcpPairing(pairingCode);
  const context = await writeMcpContextForSlot(authorization, slot);
  console.error(`StakeMate MCP paired for @${context.username}; context expires ${context.expiresAt}.`);
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "MCP broker failed."); process.exitCode = 1; });
