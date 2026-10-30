import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError } from "../src/lib/server/errors";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeReceiptPath, FileMemoryReceiptStore, MemoryReceiptStore, parseRecalledMemoryRecords, WalrusMemoryService } from "../src/lib/server/walrus-memory";
import { serializeMemoryRecord } from "../src/lib/memory/records";

const record = { id: "71c6a3d1-9041-4947-b4cc-3779453f1daa", occurredAt: "2026-01-01T00:00:00.000Z", challengeId: "demo-1", actorId: "alex", type: "challenge.created" as const, fixture: "Demo FC vs Example United", market: "home_win", deadline: "2026-02-01T00:00:00.000Z" };
test("writes a validated record once and tracks its receipt", async () => {
  let remembers = 0;
  const client = { health: async () => ({}), remember: async () => { remembers++; return { job_id: "job-1" }; }, waitForRememberJob: async () => ({ id: "memory-1", blob_id: "blob-1" }), recall: async () => ({ results: [] }) };
  const service = new WalrusMemoryService(async () => client, new MemoryReceiptStore(), true);
  const first = await service.write(record);
  const second = await service.write(record);
  assert.equal(first.duplicate, false); assert.equal(second.duplicate, true); assert.equal(remembers, 1); assert.equal(first.receipt.jobId, "job-1"); assert.equal(first.receipt.blobId, "blob-1"); assert.equal(first.receipt.status, "completed"); assert.ok(first.receipt.preparedAt);
});
test("account readiness performs a read-only authenticated recall", async () => {
  let recalls = 0;
  const client = { health: async () => ({}), remember: async () => ({ job_id: "unused" }), waitForRememberJob: async () => ({ id: "unused", blob_id: "unused" }), recall: async () => { recalls++; return { results: [] }; } };
  const readiness = await new WalrusMemoryService(async () => client, new MemoryReceiptStore(), false).accountReadiness();
  assert.equal(readiness.authenticated, true); assert.equal(recalls, 1);
});
test("recall accepts only canonical current-schema records and records read provenance", async () => {
  const canonical = serializeMemoryRecord(record);
  const client = { health: async () => ({}), remember: async () => ({ job_id: "unused" }), waitForRememberJob: async () => ({ id: "unused", blob_id: "unused" }), recall: async () => ({ results: [{ text: canonical }, { text: JSON.stringify({ schemaVersion: 2, ...record, fixture: "tampered" }) }] }) };
  const recalled = await new WalrusMemoryService(async () => client, new MemoryReceiptStore(), false).recallValidatedRecords("demo-1", 2);
  assert.deepEqual(recalled.records, [record]);
  assert.deepEqual(recalled.provenance.matchedRecordIds, [record.id]);
  assert.equal(recalled.provenance.network, "mainnet");
  assert.deepEqual(parseRecalledMemoryRecords({ text: "not json" }), []);
});
test("does not send records when writes are disabled", async () => {
  const service = new WalrusMemoryService(async () => { throw new Error("should not create a client"); }, new MemoryReceiptStore(), false);
  await assert.rejects(() => service.write(record), (error: unknown) => error instanceof ProviderError && error.code === "WRITES_DISABLED");
});
test("dry run validates canonical records without creating a client or journal receipt", async () => {
  const service = new WalrusMemoryService(async () => { throw new Error("dry run must not create a client"); }, new MemoryReceiptStore(), false);
  const result = await service.dryRun([record, { ...record, id: "29a5768d-6dcd-45ee-a934-a24d2a7edc01" }, record]);
  assert.equal(result.writesEnabled, false); assert.equal(result.uniqueCount, 2); assert.equal(result.duplicateCount, 1); assert.equal(result.entries[0].canonicalBytes > 0, true); assert.equal(result.entries[0].expectedJournalOnSubmission.jobId, "provider-assigned"); assert.equal(result.costEstimate.available, false);
});
test("process-wide write queue prevents duplicate concurrent remember calls across service instances", async () => {
  let remembers = 0;
  const client = { health: async () => ({}), remember: async (_text: string, _namespace?: string, options?: { idempotencyKey?: string }) => { remembers++; assert.equal(options?.idempotencyKey?.length, 64); await new Promise((resolve) => setTimeout(resolve, 5)); return { job_id: "job-queue" }; }, waitForRememberJob: async () => ({ id: "memory-queue", blob_id: "blob-queue" }), recall: async () => ({ results: [] }) };
  const store = new MemoryReceiptStore();
  const [first, second] = await Promise.all([new WalrusMemoryService(async () => client, store, true).write(record), new WalrusMemoryService(async () => client, store, true).write(record)]);
  assert.equal(remembers, 1); assert.equal(first.duplicate, false); assert.equal(second.duplicate, true);
});
test("prepared receipt resumes with the deterministic idempotency key after a restart", async () => {
  const digest = createHash("sha256").update(serializeMemoryRecord(record)).digest("hex");
  const store = new MemoryReceiptStore();
  await store.put({ recordId: record.id, digest, preparedAt: "2026-10-28T00:00:00.000Z", status: "prepared" });
  let remembers = 0;
  const client = { health: async () => ({}), remember: async (_text: string, _namespace?: string, options?: { idempotencyKey?: string }) => { remembers++; assert.equal(options?.idempotencyKey, digest); return { job_id: "resumed-job" }; }, waitForRememberJob: async () => ({ id: "resumed-job", blob_id: "resumed-blob" }), recall: async () => ({ results: [] }) };
  const result = await new WalrusMemoryService(async () => client, store, true).write(record);
  assert.equal(remembers, 1); assert.equal(result.receipt.status, "completed"); assert.equal(result.receipt.jobId, "resumed-job");
});
test("accepted receipt resumes polling without submitting another remember request", async () => {
  const digest = createHash("sha256").update(serializeMemoryRecord(record)).digest("hex");
  const store = new MemoryReceiptStore();
  await store.put({ recordId: record.id, digest, preparedAt: "2026-10-28T00:00:00.000Z", acceptedAt: "2026-10-28T00:00:01.000Z", jobId: "accepted-job", status: "accepted" });
  let remembers = 0; let waits = 0;
  const client = { health: async () => ({}), remember: async () => { remembers++; return { job_id: "unexpected" }; }, waitForRememberJob: async (jobId: string) => { waits++; assert.equal(jobId, "accepted-job"); return { id: jobId, blob_id: "accepted-blob" }; }, recall: async () => ({ results: [] }) };
  const result = await new WalrusMemoryService(async () => client, store, true).write(record);
  assert.equal(remembers, 0); assert.equal(waits, 1); assert.equal(result.receipt.status, "completed");
});
test("explicit reconciliation polls an accepted receipt without remember", async () => {
  const digest = createHash("sha256").update(serializeMemoryRecord(record)).digest("hex");
  const store = new MemoryReceiptStore();
  await store.put({ recordId: record.id, digest, preparedAt: "2026-10-28T00:00:00.000Z", acceptedAt: "2026-10-28T00:00:01.000Z", jobId: "reconcile-job", status: "accepted" });
  let remembers = 0;
  const client = { health: async () => ({}), remember: async () => { remembers++; return { job_id: "unexpected" }; }, waitForRememberJob: async () => ({ id: "reconcile-job", blob_id: "reconcile-blob" }), recall: async () => ({ results: [] }) };
  const receipt = await new WalrusMemoryService(async () => client, store, true).reconcileAccepted(record);
  assert.equal(remembers, 0); assert.equal(receipt.status, "completed"); assert.equal(receipt.blobId, "reconcile-blob");
});
test("receipt path must be absolute and outside the repository", () => {
  assert.throws(() => assertSafeReceiptPath("receipts.json"), ProviderError);
  assert.throws(() => assertSafeReceiptPath(`${process.cwd()}/public/receipts.json`), ProviderError);
  assert.equal(assertSafeReceiptPath("/var/lib/stakemate/walrus-memory-receipts.json"), "/var/lib/stakemate/walrus-memory-receipts.json");
});
test("file receipt journal atomically persists a private receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stakemate-receipt-"));
  const receiptPath = join(directory, "receipts.json");
  try {
    const store = new FileMemoryReceiptStore(receiptPath);
    await store.put({ recordId: record.id, digest: "a".repeat(64), preparedAt: "2026-10-28T00:00:00.000Z", status: "prepared" });
    const persisted = JSON.parse(await readFile(receiptPath, "utf8")) as Record<string, { status: string }>;
    assert.equal(persisted["a".repeat(64)]?.status, "prepared");
    assert.equal((await stat(receiptPath)).mode & 0o077, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
