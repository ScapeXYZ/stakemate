import postgres from "postgres";
import { validateWalrusBatchManifest, type WalrusBatchManifest } from "./walrus-batch";
import type { MemoryReceipt, ReceiptStore } from "./walrus-memory";
import { postgresSslForDatabaseUrl } from "./postgres-connection-security";

function iso(value: unknown, name: string) {
  const parsed = new Date(value as Date);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`WALRUS_EVIDENCE_${name.toUpperCase()}_INVALID`);
  return parsed.toISOString();
}

function receipt(row: Record<string, unknown>): MemoryReceipt {
  return {
    recordId: String(row.record_id), digest: String(row.digest), jobId: row.job_id ? String(row.job_id) : undefined,
    blobId: String(row.blob_id), preparedAt: iso(row.prepared_at, "prepared_at"), acceptedAt: row.accepted_at ? iso(row.accepted_at, "accepted_at") : undefined,
    completedAt: iso(row.completed_at, "completed_at"), status: "completed",
  };
}

/** Server-only, shared read model for authentic already-published Walrus evidence. */
export class PostgresWalrusEvidenceStore implements ReceiptStore {
  private readonly sql: postgres.Sql;
  constructor(databaseUrl: string) { this.sql = postgres(databaseUrl, { prepare: false, max: 2, ssl: postgresSslForDatabaseUrl(databaseUrl), idle_timeout: 20, connect_timeout: 10 }); }
  async close() { await this.sql.end({ timeout: 5 }); }

  async manifest(): Promise<WalrusBatchManifest | null> {
    const [row] = await this.sql`select batch_digest, version, record_count, manifest from stakemate_walrus_manifests where network = 'mainnet' order by imported_at desc limit 1`;
    if (!row) return null;
    const manifest = validateWalrusBatchManifest(row.manifest);
    if (String(row.batch_digest).trim() !== manifest.batchDigest || Number(row.version) !== manifest.version || Number(row.record_count) !== manifest.recordCount) throw new Error("WALRUS_EVIDENCE_MANIFEST_ROW_MISMATCH");
    return manifest;
  }
  async get(digest: string) {
    if (!/^[0-9a-f]{64}$/i.test(digest)) return undefined;
    const [row] = await this.sql`select digest, record_id, job_id, blob_id, prepared_at, accepted_at, completed_at from stakemate_walrus_receipts where digest = ${digest.toLowerCase()}`;
    return row ? receipt(row) : undefined;
  }
  /** Application recall never writes evidence. Import is an operator-only transaction. */
  async put(): Promise<void> { throw new Error("WALRUS_EVIDENCE_READ_ONLY"); }
}

export function getPostgresWalrusEvidenceStore() {
  // Evidence recall intentionally has its own least-privilege connection. It
  // must never inherit the broader application connection used for sessions
  // and invitation administration.
  const databaseUrl = process.env.STAKEMATE_WALRUS_EVIDENCE_DATABASE_URL;
  if (!databaseUrl?.trim()) throw new Error("WALRUS_EVIDENCE_DATABASE_NOT_CONFIGURED");
  return new PostgresWalrusEvidenceStore(databaseUrl);
}
