import { getCanonicalInvitationPersistenceAdapter } from "../src/lib/server/canonical-invitation-persistence";
import { uniqueInvitationMemoryEvents } from "../src/lib/server/invitation-memory-events";
import { FileMemoryReceiptStore, getWalrusMemoryService } from "../src/lib/server/walrus-memory";
import { prepareWalrusBatch, publishFrozenWalrusBatch, readWalrusBatchManifest, recallWalrusBatch, verifyFrozenWalrusBatch, verifyWalrusBatchReceipts, writeWalrusBatchManifest } from "../src/lib/server/walrus-batch";
import { assertIsolatedPilotDatabaseUrl } from "../src/lib/server/postgres-connection-security";

const command = process.argv[2]; const value = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const manifestPath = process.env.WALRUS_MEMORY_MANIFEST_PATH ?? "/tmp/stakemate-walrus/mainnet-batch.json";
const receiptPath = process.env.WALRUS_MEMORY_RECEIPTS_PATH ?? "/tmp/stakemate-walrus/receipts.json";
async function candidates() { const url = process.env.DATABASE_URL; if (!url) throw new Error("DATABASE_NOT_CONFIGURED"); assertIsolatedPilotDatabaseUrl(url); const adapter = getCanonicalInvitationPersistenceAdapter(); try { return uniqueInvitationMemoryEvents(await adapter.allForWalrusOperator()); } finally { await adapter.close(); } }
async function run() {
  if (!command || !["prepare", "status", "publish", "verify", "recall-check"].includes(command)) throw new Error("Usage: walrus:batch <prepare|status|publish|verify|recall-check> [--confirm <batch-digest>]");
  const records = await candidates();
  if (command === "prepare") { const manifest = prepareWalrusBatch(records); await writeWalrusBatchManifest(manifestPath, manifest); console.log(JSON.stringify({ command, manifestPath, batchDigest: manifest.batchDigest, recordCount: manifest.recordCount, entries: manifest.entries.map(({ recordId, type, digest, payloadBytes, provenanceRef }) => ({ recordId, type, digest, payloadBytes, provenanceRef })) }, null, 2)); return; }
  const manifest = await readWalrusBatchManifest(manifestPath); verifyFrozenWalrusBatch(manifest, records);
  const service = getWalrusMemoryService(); const store = new FileMemoryReceiptStore(receiptPath);
  if (command === "status") { const readiness = await service.accountReadiness(); const receipts = await Promise.all(manifest.entries.map((entry) => store.get(entry.digest))); console.log(JSON.stringify({ command, manifestPath, batchDigest: manifest.batchDigest, recordCount: 10, readiness, receipts: receipts.map((receipt) => receipt ? { recordId: receipt.recordId, digest: receipt.digest, status: receipt.status, blobId: receipt.blobId ?? null } : null), costs: "Use walrus info and walrus store --dry-run for dynamic WAL/SUI cost confirmation; MemWal relayer pricing/capacity is provider-managed." }, null, 2)); return; }
  if (command === "publish") { const receipts = await publishFrozenWalrusBatch(service, manifest, records, value("--confirm")); console.log(JSON.stringify({ command, batchDigest: manifest.batchDigest, receipts: receipts.map((item) => ({ recordId: item.recordId, digest: item.digest, status: item.status, blobId: item.blobId ?? null })) }, null, 2)); return; }
  if (command === "verify") { const receipts = await verifyWalrusBatchReceipts(manifest, records, service, store); console.log(JSON.stringify({ command, batchDigest: manifest.batchDigest, verified: receipts.length, receipts: receipts.map((item) => ({ recordId: item.recordId, digest: item.digest, blobId: item.blobId })) }, null, 2)); return; }
  console.log(JSON.stringify({ command, batchDigest: manifest.batchDigest, ...(await recallWalrusBatch(manifest, records, service)) }, null, 2));
}
void run().catch((error) => { console.error(error instanceof Error ? error.message : "WALRUS_BATCH_FAILED"); process.exitCode = 1; });
