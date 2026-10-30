import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { MEMORY_SCHEMA_VERSION, MemoryRecord, normalizeMemoryRecord, serializeMemoryRecord } from "@/lib/memory/records";
import { ProviderError } from "./errors";
import { assertApplicationWritesAllowed } from "./maintenance-write-freeze";

const MAINNET_RELAYER = "https://relayer.memory.walrus.xyz";
/** Shared by every service instance in this Node.js process; not a distributed lock. */
let processWriteQueue: Promise<void> = Promise.resolve();

export type MemoryReceipt = { recordId: string; digest: string; preparedAt: string; jobId?: string; acceptedAt?: string; completedAt?: string; blobId?: string; status: "prepared" | "accepted" | "completed" };
export type MemoryWriteResult = { duplicate: boolean; receipt: MemoryReceipt };
export type MemoryRecallResult = { records: MemoryRecord[]; provenance: { network: "mainnet"; query: string; retrievedAt: string; matchedRecordIds: string[] } };
export type MemoryDryRunEntry = { recordId: string; digest: string; canonicalBytes: number; duplicate: boolean; expectedJournalOnSubmission: { status: "accepted"; jobId: "provider-assigned"; blobId: "pending-completion" } };
export type MemoryDryRunResult = { writesEnabled: false; entries: MemoryDryRunEntry[]; uniqueCount: number; duplicateCount: number; costEstimate: { available: false; reason: string } };
type MemWalClient = { health(): Promise<unknown>; remember(text: string, namespace?: string, options?: { idempotencyKey?: string }): Promise<{ job_id: string }>; waitForRememberJob(jobId: string, options?: { timeoutMs?: number }): Promise<{ id: string; blob_id: string }>; getRememberStatus?(jobId: string): Promise<{ status: string; blob_id?: string }>; recall(options: { query: string; limit?: number }): Promise<unknown> };

function recalledJsonStrings(value: unknown, results: string[] = [], depth = 0): string[] {
  if (depth > 8 || results.length >= 100) return results;
  if (typeof value === "string") { results.push(value); return results; }
  if (Array.isArray(value)) { for (const item of value) recalledJsonStrings(item, results, depth + 1); return results; }
  if (value && typeof value === "object") for (const item of Object.values(value)) recalledJsonStrings(item, results, depth + 1);
  return results;
}

/** Accept only exact, current-version canonical records from an opaque SDK recall response. */
export function parseRecalledMemoryRecords(raw: unknown): MemoryRecord[] {
  const unique = new Map<string, MemoryRecord>();
  for (const text of recalledJsonStrings(raw)) {
    try {
      const parsed = JSON.parse(text) as { schemaVersion?: unknown } & Record<string, unknown>;
      if (parsed.schemaVersion !== MEMORY_SCHEMA_VERSION) continue;
      const { schemaVersion: _schemaVersion, ...recordInput } = parsed;
      const record = normalizeMemoryRecord(recordInput);
      if (serializeMemoryRecord(record) === text) unique.set(record.id, record);
    } catch { /* Recall text is untrusted until it is canonical and schema-valid. */ }
  }
  return [...unique.values()];
}

export interface ReceiptStore { get(digest: string): Promise<MemoryReceipt | undefined>; put(receipt: MemoryReceipt): Promise<void>; }

/** Reject paths that could be published or accidentally committed with the application. */
export function assertSafeReceiptPath(receiptPath: string): string {
  if (!isAbsolute(receiptPath)) throw new ProviderError("Walrus receipt storage must use an absolute path.", "INVALID_RESPONSE");
  const resolved = resolve(receiptPath);
  const repositoryRoot = resolve(/* turbopackIgnore: true */ process.cwd());
  const fromRepository = relative(repositoryRoot, resolved);
  if (fromRepository === "" || (!fromRepository.startsWith("..") && !isAbsolute(fromRepository))) throw new ProviderError("Walrus receipt storage must be outside the repository, public assets, and Git metadata.", "INVALID_RESPONSE");
  return resolved;
}

/** Process-local receipt store for this foundation. Replace with durable storage before horizontally scaling. */
export class MemoryReceiptStore {
  private readonly receipts = new Map<string, MemoryReceipt>();
  async get(digest: string) { return this.receipts.get(digest); }
  async put(receipt: MemoryReceipt) { this.receipts.set(receipt.digest, receipt); }
}

/** Atomic-replace durable receipt journal for one process/filesystem. Production multi-instance deployments need a transactional shared ReceiptStore. */
export class FileMemoryReceiptStore implements ReceiptStore {
  constructor(private readonly filePath: string) {}
  private async all() { try { return JSON.parse(await readFile(this.filePath, "utf8")) as Record<string, MemoryReceipt>; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; } }
  async get(digest: string) { return (await this.all())[digest]; }
  async put(receipt: MemoryReceipt) { const receipts = await this.all(); receipts[receipt.digest] = receipt; await mkdir(dirname(this.filePath), { recursive: true }); const temporary = `${this.filePath}.tmp`; await writeFile(temporary, JSON.stringify(receipts), { mode: 0o600 }); await rename(temporary, this.filePath); }
}

export class WalrusMemoryService {
  constructor(private readonly createClient: () => Promise<MemWalClient>, private readonly store: ReceiptStore = new MemoryReceiptStore(), private readonly writesEnabled = process.env.WALRUS_MEMORY_WRITES_ENABLED === "true") {}

  async health(): Promise<{ ok: true; network: "mainnet" }> { await (await this.createClient()).health(); return { ok: true, network: "mainnet" }; }
  async write(recordInput: unknown): Promise<MemoryWriteResult> {
    assertApplicationWritesAllowed("walrus_memory_write");
    const work = processWriteQueue.then(() => this.writeOne(recordInput));
    processWriteQueue = work.then(() => undefined, () => undefined);
    return work;
  }
  private async writeOne(recordInput: unknown): Promise<MemoryWriteResult> {
    const record = normalizeMemoryRecord(recordInput);
    if (!this.writesEnabled) throw new ProviderError("Walrus Memory writes are disabled.", "WRITES_DISABLED");
    const digest = createHash("sha256").update(serializeMemoryRecord(record)).digest("hex");
    const prior = await this.store.get(digest);
    if (prior?.status === "completed") return { duplicate: true, receipt: prior };
    let receipt = prior;
    if (!receipt) {
      receipt = { recordId: record.id, digest, preparedAt: new Date().toISOString(), status: "prepared" };
      await this.store.put(receipt);
    }
    const client = await this.createClient();
    if (receipt.status === "prepared") {
      const job = await client.remember(serializeMemoryRecord(record), undefined, { idempotencyKey: digest });
      receipt = { ...receipt, jobId: job.job_id, acceptedAt: new Date().toISOString(), status: "accepted" };
      await this.store.put(receipt);
    }
    const completed = await client.waitForRememberJob(receipt.jobId!, { timeoutMs: 30_000 });
    if (!completed.blob_id) throw new ProviderError("Walrus Memory completed without a blob ID; receipt remains accepted for reconciliation.", "INVALID_RESPONSE");
    receipt = { ...receipt, completedAt: new Date().toISOString(), blobId: completed.blob_id, status: "completed" };
    await this.store.put(receipt);
    return { duplicate: false, receipt };
  }
  /** Polls a receipt already accepted by the relayer. It never calls remember(). */
  async reconcileAccepted(recordInput: unknown): Promise<MemoryReceipt> {
    assertApplicationWritesAllowed("walrus_memory_reconcile");
    const record = normalizeMemoryRecord(recordInput);
    const digest = createHash("sha256").update(serializeMemoryRecord(record)).digest("hex");
    const receipt = await this.store.get(digest);
    if (!receipt) throw new ProviderError("No receipt exists for this record.", "INVALID_RESPONSE");
    if (receipt.status === "completed") return receipt;
    if (receipt.status !== "accepted" || !receipt.jobId) throw new ProviderError("Only an accepted receipt with a provider job ID can be reconciled.", "INVALID_RESPONSE");
    const completed = await (await this.createClient()).waitForRememberJob(receipt.jobId, { timeoutMs: 30_000 });
    if (!completed.blob_id) throw new ProviderError("Walrus Memory completed without a blob ID; receipt remains accepted for reconciliation.", "INVALID_RESPONSE");
    const settled: MemoryReceipt = { ...receipt, completedAt: new Date().toISOString(), blobId: completed.blob_id, status: "completed" };
    await this.store.put(settled);
    return settled;
  }
  /** Validates and deduplicates candidate records without creating a client, journal entry, or provider job. */
  async dryRun(records: readonly unknown[]): Promise<MemoryDryRunResult> {
    if (this.writesEnabled) throw new ProviderError("Dry runs require WALRUS_MEMORY_WRITES_ENABLED=false.", "INVALID_RESPONSE");
    const seen = new Set<string>();
    const entries: MemoryDryRunEntry[] = [];
    for (const input of records) {
      const record = normalizeMemoryRecord(input);
      const serialized = serializeMemoryRecord(record);
      const digest = createHash("sha256").update(serialized).digest("hex");
      const duplicate = seen.has(digest) || Boolean(await this.store.get(digest));
      seen.add(digest);
      entries.push({ recordId: record.id, digest, canonicalBytes: Buffer.byteLength(serialized, "utf8"), duplicate, expectedJournalOnSubmission: { status: "accepted", jobId: "provider-assigned", blobId: "pending-completion" } });
    }
    return { writesEnabled: false, entries, uniqueCount: entries.filter((entry) => !entry.duplicate).length, duplicateCount: entries.filter((entry) => entry.duplicate).length, costEstimate: { available: false, reason: "MemWal does not provide a non-spending Mainnet write-price or account-capacity API; obtain current WAL/SUI estimates with the official Walrus CLI or Cost Calculator before approval." } };
  }
  /** Authenticated, non-writing account check. Recall results are deliberately discarded. */
  async accountReadiness(): Promise<{ ok: true; network: "mainnet"; authenticated: true }> { const client = await this.createClient(); await client.health(); await client.recall({ query: "stakemate account readiness probe", limit: 1 }); return { ok: true, network: "mainnet", authenticated: true }; }
  async recall(query: string, limit = 10): Promise<unknown> { if (!query.trim()) throw new ProviderError("A recall query is required.", "INVALID_RESPONSE"); return (await this.createClient()).recall({ query, limit }); }
  async recallValidatedRecords(query: string, limit = 10): Promise<MemoryRecallResult> {
    const raw = await this.recall(query, limit);
    const records = parseRecalledMemoryRecords(raw);
    return { records, provenance: { network: "mainnet", query, retrievedAt: new Date().toISOString(), matchedRecordIds: records.map((record) => record.id) } };
  }
}

async function createConfiguredClient(): Promise<MemWalClient> {
  const key = process.env.WALRUS_MEMORY_DELEGATE_KEY;
  const accountId = process.env.WALRUS_MEMORY_ACCOUNT_ID;
  const network = process.env.WALRUS_MEMORY_NETWORK ?? "mainnet";
  if (network !== "mainnet") throw new ProviderError("Walrus Memory adapter is explicitly configured for mainnet only.", "INVALID_RESPONSE");
  if (!key || !accountId) throw new ProviderError("Walrus Memory is not configured.", "NOT_CONFIGURED");
  if (!/^0x[0-9a-fA-F]{64}$/.test(accountId)) throw new ProviderError("Walrus Memory account ID must be a Sui object ID.", "INVALID_RESPONSE");
  const { MemWal } = await import("@mysten-incubation/memwal");
  return MemWal.create({ key, accountId, serverUrl: process.env.WALRUS_MEMORY_RELAYER_URL ?? MAINNET_RELAYER, namespace: process.env.WALRUS_MEMORY_NAMESPACE ?? "stakemate" }) as MemWalClient;
}

export function getWalrusMemoryService(): WalrusMemoryService {
  const writesEnabled = process.env.WALRUS_MEMORY_WRITES_ENABLED === "true";
  const receiptPath = process.env.WALRUS_MEMORY_RECEIPTS_PATH;
  const approvalId = process.env.WALRUS_MEMORY_WRITE_APPROVAL_ID?.trim();
  if (writesEnabled && !receiptPath) throw new ProviderError("Durable receipt storage is required before enabling Walrus Memory writes.", "INVALID_RESPONSE");
  if (writesEnabled && !approvalId) throw new ProviderError("A non-secret operator approval ID is required before enabling Walrus Memory writes.", "INVALID_RESPONSE");
  const safeReceiptPath = receiptPath ? assertSafeReceiptPath(receiptPath) : undefined;
  return new WalrusMemoryService(createConfiguredClient, safeReceiptPath ? new FileMemoryReceiptStore(safeReceiptPath) : new MemoryReceiptStore(), writesEnabled);
}
