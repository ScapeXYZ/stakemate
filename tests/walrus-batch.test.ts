import assert from "node:assert/strict";
import test from "node:test";
import { approvedBatch, assertSafeManifestPath, inspectWalrusBatchReceipts, prepareWalrusBatch, recallPublishedWalrusBatch, verifyFrozenWalrusBatch } from "../src/lib/server/walrus-batch";
import { MemoryReceiptStore, WalrusMemoryService } from "../src/lib/server/walrus-memory";

const records = Array.from({ length: 12 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, occurredAt: `2030-01-${String((index % 9) + 1).padStart(2, "0")}T00:00:00.000Z`, challengeId: `challenge-${index}`, actorId: "operator", type: "challenge.created" as const, fixture: `Fixture ${index}`, market: "home_win", deadline: "2030-02-01T00:00:00.000Z", provenance: { source: "canonical_postgres_invitation", sourceRef: `invitation:${index}`, verifiedAt: "2030-01-01T00:00:00.000Z", commitmentHash: `0x${String(index).padStart(64, "a")}` } }));

test("deterministically freezes exactly ten unique schema-valid records from twelve", () => {
  const first = prepareWalrusBatch(records); const second = prepareWalrusBatch([...records].reverse());
  assert.equal(first.recordCount, 10); assert.equal(first.entries.length, 10); assert.equal(first.batchDigest, second.batchDigest); assert.deepEqual(first.entries, second.entries); assert.equal(new Set(first.entries.map((entry) => entry.digest)).size, 10);
});
test("a changed candidate set rejects frozen manifest publication", () => {
  const manifest = prepareWalrusBatch(records);
  assert.throws(() => verifyFrozenWalrusBatch(manifest, records.map((record, index) => index === 0 ? { ...record, fixture: "Changed" } : record)), /WALRUS_BATCH_CONTENT_CHANGED/);
});
test("manifest files must stay outside the application repository", () => {
  assert.throws(() => assertSafeManifestPath("relative-manifest.json"), /ABSOLUTE_REQUIRED/);
  assert.throws(() => assertSafeManifestPath(`${process.cwd()}/manifest.json`), /OUTSIDE_REPOSITORY_REQUIRED/);
  assert.equal(assertSafeManifestPath("/tmp/stakemate-walrus/manifest.json"), "/tmp/stakemate-walrus/manifest.json");
});
test("publication requires an approval ID, matching approved digest, explicit confirmation, and write gate", () => {
  const manifest = prepareWalrusBatch(records); const saved = { approval: process.env.WALRUS_MEMORY_WRITE_APPROVAL_ID, digest: process.env.WALRUS_MEMORY_APPROVED_BATCH_DIGEST, writes: process.env.WALRUS_MEMORY_WRITES_ENABLED, freeze: process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE };
  try { delete process.env.WALRUS_MEMORY_WRITE_APPROVAL_ID; assert.throws(() => approvedBatch(manifest, manifest.batchDigest), /APPROVAL_ID/); process.env.WALRUS_MEMORY_WRITE_APPROVAL_ID = "operator-review-1"; process.env.WALRUS_MEMORY_APPROVED_BATCH_DIGEST = manifest.batchDigest; process.env.WALRUS_MEMORY_WRITES_ENABLED = "false"; assert.throws(() => approvedBatch(manifest, manifest.batchDigest), /WRITES_DISABLED/); process.env.WALRUS_MEMORY_WRITES_ENABLED = "true"; assert.throws(() => approvedBatch(manifest, "wrong"), /APPROVAL_DIGEST/); process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE = "true"; assert.throws(() => approvedBatch(manifest, manifest.batchDigest), /maintenance/i); } finally { if (saved.approval === undefined) delete process.env.WALRUS_MEMORY_WRITE_APPROVAL_ID; else process.env.WALRUS_MEMORY_WRITE_APPROVAL_ID = saved.approval; if (saved.digest === undefined) delete process.env.WALRUS_MEMORY_APPROVED_BATCH_DIGEST; else process.env.WALRUS_MEMORY_APPROVED_BATCH_DIGEST = saved.digest; if (saved.writes === undefined) delete process.env.WALRUS_MEMORY_WRITES_ENABLED; else process.env.WALRUS_MEMORY_WRITES_ENABLED = saved.writes; if (saved.freeze === undefined) delete process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE; else process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE = saved.freeze; }
});
test("approved batch distinguishes ten completed receipts from unavailable or mismatched receipts", async () => {
  const manifest = prepareWalrusBatch(records); const store = new MemoryReceiptStore();
  for (const item of manifest.entries) await store.put({ recordId: item.recordId, digest: item.digest, preparedAt: "2030-01-01T00:00:00.000Z", completedAt: "2030-01-01T00:01:00.000Z", status: "completed", blobId: `blob-${item.recordId}` });
  const inspected = await inspectWalrusBatchReceipts(manifest, store); assert.equal(inspected.completed.length, 10); assert.equal(inspected.unavailable.length, 0);
  await store.put({ recordId: "wrong", digest: manifest.entries[0].digest, preparedAt: "2030-01-01T00:00:00.000Z", status: "completed", blobId: "wrong" });
  assert.equal((await inspectWalrusBatchReceipts(manifest, store)).completed.length, 9);
});
test("published-batch recall does not substitute local records when provider returns none", async () => {
  const manifest = prepareWalrusBatch(records); const store = new MemoryReceiptStore();
  for (const item of manifest.entries) await store.put({ recordId: item.recordId, digest: item.digest, preparedAt: "2030-01-01T00:00:00.000Z", completedAt: "2030-01-01T00:01:00.000Z", status: "completed", blobId: `blob-${item.recordId}` });
  const service = new WalrusMemoryService(async () => ({ health: async () => ({}), remember: async () => ({ job_id: "unused" }), waitForRememberJob: async () => ({ id: "unused", blob_id: "unused" }), recall: async () => ({ results: [] }) }), store, false);
  const recalled = await recallPublishedWalrusBatch(manifest, service, store); assert.equal(recalled.receiptCount, 10); assert.equal(recalled.records.length, 0);
});
