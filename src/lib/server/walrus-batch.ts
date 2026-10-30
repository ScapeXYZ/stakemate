import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { MemoryRecord } from "@/lib/memory/records";
import { normalizeMemoryRecord, serializeMemoryRecord } from "@/lib/memory/records";
import type { MemoryReceipt, ReceiptStore, WalrusMemoryService } from "@/lib/server/walrus-memory";
import { assertApplicationWritesAllowed } from "@/lib/server/maintenance-write-freeze";

export type WalrusBatchEntry = { recordId: string; type: MemoryRecord["type"]; occurredAt: string; digest: string; payloadBytes: number; provenanceRef: string | null; fixtureId: string | null };
export type WalrusBatchManifest = { version: 1; network: "mainnet"; recordCount: 10; batchDigest: string; entries: WalrusBatchEntry[] };
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
function canonical(value: unknown): string { if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`; throw new Error("BATCH_NON_JSON_VALUE"); }
function entry(input: unknown): WalrusBatchEntry { const record = normalizeMemoryRecord(input); const payload = serializeMemoryRecord(record); return { recordId: record.id, type: record.type, occurredAt: record.occurredAt, digest: sha256(payload), payloadBytes: Buffer.byteLength(payload), provenanceRef: record.provenance?.sourceRef ?? null, fixtureId: "fixtureId" in record && typeof record.fixtureId === "string" ? record.fixtureId : null }; }
function digest(entries: readonly WalrusBatchEntry[]) { return sha256(canonical({ version: 1, network: "mainnet", entries })); }

/** Sort facts, not database insertion timing; only ten strict, unique candidates qualify. */
export function prepareWalrusBatch(records: readonly unknown[]): WalrusBatchManifest {
  const all = records.map(entry).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.recordId.localeCompare(b.recordId));
  const unique = all.filter((item, index) => all.findIndex((other) => other.digest === item.digest) === index);
  if (unique.length < 10) throw new Error("WALRUS_BATCH_REQUIRES_TEN_GENUINE_UNIQUE_RECORDS");
  const entries = unique.slice(0, 10); return { version: 1, network: "mainnet", recordCount: 10, batchDigest: digest(entries), entries };
}
export function verifyFrozenWalrusBatch(manifest: WalrusBatchManifest, records: readonly unknown[]) {
  if (manifest.version !== 1 || manifest.network !== "mainnet" || manifest.recordCount !== 10 || manifest.entries.length !== 10 || manifest.batchDigest !== digest(manifest.entries)) throw new Error("WALRUS_BATCH_MANIFEST_INVALID");
  const current = prepareWalrusBatch(records); if (current.batchDigest !== manifest.batchDigest || canonical(current.entries) !== canonical(manifest.entries)) throw new Error("WALRUS_BATCH_CONTENT_CHANGED");
  return current;
}
export function assertSafeManifestPath(path: string) { if (!isAbsolute(path)) throw new Error("WALRUS_BATCH_MANIFEST_PATH_ABSOLUTE_REQUIRED"); const resolved = resolve(path); const fromRepo = relative(resolve(process.cwd()), resolved); if (fromRepo === "" || (!fromRepo.startsWith("..") && !isAbsolute(fromRepo))) throw new Error("WALRUS_BATCH_MANIFEST_PATH_OUTSIDE_REPOSITORY_REQUIRED"); return resolved; }
export async function writeWalrusBatchManifest(path: string, manifest: WalrusBatchManifest) { const target = assertSafeManifestPath(path); await mkdir(dirname(target), { recursive: true, mode: 0o700 }); const temp = `${target}.tmp`; await writeFile(temp, `${canonical(manifest)}\n`, { mode: 0o600 }); await rename(temp, target); }
export async function readWalrusBatchManifest(path: string) { const parsed = JSON.parse(await readFile(assertSafeManifestPath(path), "utf8")) as WalrusBatchManifest; if (parsed.batchDigest !== digest(parsed.entries)) throw new Error("WALRUS_BATCH_MANIFEST_INVALID"); return parsed; }
export function approvedBatch(manifest: WalrusBatchManifest, confirmation: string | undefined) { if (process.env.WALRUS_MEMORY_WRITE_APPROVAL_ID?.trim() === "") throw new Error("WALRUS_BATCH_APPROVAL_ID_REQUIRED"); if (!process.env.WALRUS_MEMORY_WRITE_APPROVAL_ID?.trim()) throw new Error("WALRUS_BATCH_APPROVAL_ID_REQUIRED"); if (process.env.WALRUS_MEMORY_APPROVED_BATCH_DIGEST !== manifest.batchDigest || confirmation !== manifest.batchDigest) throw new Error("WALRUS_BATCH_APPROVAL_DIGEST_MISMATCH"); if (process.env.WALRUS_MEMORY_WRITES_ENABLED !== "true") throw new Error("WALRUS_BATCH_WRITES_DISABLED"); assertApplicationWritesAllowed("walrus_batch_publish"); }
export async function publishFrozenWalrusBatch(service: WalrusMemoryService, manifest: WalrusBatchManifest, records: readonly unknown[], confirmation: string | undefined) { approvedBatch(manifest, confirmation); verifyFrozenWalrusBatch(manifest, records); const byDigest = new Map(records.map((record) => [entry(record).digest, record])); const receipts: MemoryReceipt[] = []; for (const item of manifest.entries) { const record = byDigest.get(item.digest); if (!record) throw new Error("WALRUS_BATCH_CONTENT_CHANGED"); receipts.push((await service.write(record)).receipt); } return receipts; }
export async function verifyWalrusBatchReceipts(manifest: WalrusBatchManifest, records: readonly unknown[], service: WalrusMemoryService, store: ReceiptStore) { verifyFrozenWalrusBatch(manifest, records); const byDigest = new Map(records.map((record) => [entry(record).digest, record])); const receipts: MemoryReceipt[] = []; for (const item of manifest.entries) { let receipt = await store.get(item.digest); if (!receipt) throw new Error("WALRUS_BATCH_RECEIPT_MISSING"); if (receipt.recordId !== item.recordId || receipt.digest !== item.digest) throw new Error("WALRUS_BATCH_RECEIPT_MISMATCH"); if (receipt.status === "accepted") receipt = await service.reconcileAccepted(byDigest.get(item.digest)!); if (receipt.status !== "completed" || !receipt.blobId?.trim()) throw new Error("WALRUS_BATCH_RECEIPT_INCOMPLETE"); receipts.push(receipt); } return receipts;
}
/** Read-only receipt inspection for dashboards and recall. It never reconciles or creates a job. */
export async function inspectWalrusBatchReceipts(manifest: WalrusBatchManifest, store: ReceiptStore) {
  const completed: Array<{ entry: WalrusBatchEntry; receipt: MemoryReceipt }> = []; const unavailable: WalrusBatchEntry[] = [];
  for (const item of manifest.entries) { const receipt = await store.get(item.digest); if (receipt?.status === "completed" && receipt.recordId === item.recordId && receipt.digest === item.digest && receipt.blobId?.trim()) completed.push({ entry: item, receipt }); else unavailable.push(item); }
  return { completed, unavailable };
}
/** Recall only known published IDs, then prove each returned payload against the frozen manifest and receipt journal. */
export async function recallPublishedWalrusBatch(manifest: WalrusBatchManifest, service: WalrusMemoryService, store: ReceiptStore) {
  const receipts = await inspectWalrusBatchReceipts(manifest, store); const expected = new Map(receipts.completed.map(({ entry, receipt }) => [entry.recordId, { digest: entry.digest, blobId: receipt.blobId! }]));
  const recalled = await service.recallValidatedRecords(manifest.entries.map((item) => item.recordId).join(" "), 50);
  const records = recalled.records.filter((record) => { const matched = expected.get(record.id); return Boolean(matched && sha256(serializeMemoryRecord(record)) === matched.digest); });
  return { records, recalledCount: recalled.records.length, rejectedCount: recalled.records.length - records.length, provenance: recalled.provenance, receiptCount: receipts.completed.length };
}
export async function recallWalrusBatch(manifest: WalrusBatchManifest, records: readonly unknown[], service: WalrusMemoryService) { verifyFrozenWalrusBatch(manifest, records); const wanted = new Map(records.map((record) => { const parsed = normalizeMemoryRecord(record); return [parsed.id, sha256(serializeMemoryRecord(parsed))]; })); const recalled = await service.recallValidatedRecords(manifest.entries.map((item) => item.recordId).join(" "), 50); const matched = recalled.records.filter((record) => wanted.get(record.id) === sha256(serializeMemoryRecord(record))).map((record) => record.id); return { matchedRecordIds: [...new Set(matched)].sort(), expectedRecordIds: manifest.entries.map((item) => item.recordId).sort(), exact: matched.length === 10 };
}
