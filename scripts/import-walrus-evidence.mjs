#!/usr/bin/env node
/* Imports only completed entries already present in the private operator journal. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const root = resolve(import.meta.dirname, "..");
const expectedBatchDigest = "590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f";
const evidenceDir = process.env.STAKEMATE_WALRUS_EVIDENCE_DIR;
const databaseUrl = process.env.STAKEMATE_WALRUS_EVIDENCE_IMPORT_DATABASE_URL;
const execute = process.argv.includes("--execute");
if (!evidenceDir) throw new Error("WALRUS_EVIDENCE_DIR_REQUIRED");
if (!databaseUrl) throw new Error("WALRUS_EVIDENCE_IMPORT_DATABASE_URL_REQUIRED");
if (databaseUrl === process.env.DATABASE_URL) throw new Error("WALRUS_EVIDENCE_IMPORT_DATABASE_MUST_BE_DEDICATED");
const manifest = JSON.parse(await readFile(resolve(evidenceDir, "mainnet-batch.json"), "utf8"));
const journal = JSON.parse(await readFile(resolve(evidenceDir, "receipts.json"), "utf8"));
const canonical = (value) => value === null || ["boolean", "number", "string"].includes(typeof value) ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
const digest = (value) => createHash("sha256").update(value, "utf8").digest("hex");
if (manifest.version !== 1 || manifest.network !== "mainnet" || manifest.recordCount !== 10 || !Array.isArray(manifest.entries) || manifest.entries.length !== 10 || manifest.batchDigest !== digest(canonical({ version: 1, network: "mainnet", entries: manifest.entries }))) throw new Error("WALRUS_EVIDENCE_MANIFEST_INVALID");
if (manifest.batchDigest !== expectedBatchDigest) throw new Error("WALRUS_EVIDENCE_UNEXPECTED_BATCH_DIGEST");
const rows = manifest.entries.map((entry) => {
  const receipt = journal[entry.digest];
  if (!receipt || receipt.status !== "completed" || receipt.recordId !== entry.recordId || receipt.digest !== entry.digest || !receipt.blobId || !receipt.completedAt || !receipt.preparedAt) throw new Error("WALRUS_EVIDENCE_RECEIPT_INVALID");
  if (!/^[0-9a-f]{64}$/.test(entry.digest) || !/^[0-9a-f-]{36}$/i.test(entry.recordId)) throw new Error("WALRUS_EVIDENCE_IDENTIFIER_INVALID");
  return receipt;
});
if (new Set(manifest.entries.map((entry) => entry.digest)).size !== 10 || new Set(manifest.entries.map((entry) => entry.recordId.toLowerCase())).size !== 10) throw new Error("WALRUS_EVIDENCE_MANIFEST_IDENTIFIERS_NOT_UNIQUE");
if (new Set(rows.map((row) => row.blobId)).size !== 10) throw new Error("WALRUS_EVIDENCE_BLOB_IDS_NOT_UNIQUE");
for (const row of rows) { const prepared = Date.parse(row.preparedAt); const accepted = row.acceptedAt ? Date.parse(row.acceptedAt) : undefined; const completed = Date.parse(row.completedAt); if (!Number.isFinite(prepared) || !Number.isFinite(completed) || completed < prepared || (accepted !== undefined && (!Number.isFinite(accepted) || accepted < prepared || completed < accepted))) throw new Error("WALRUS_EVIDENCE_RECEIPT_TIMESTAMPS_INVALID"); }
const summary = { batchDigest: manifest.batchDigest, manifestEntries: manifest.entries.length, completedReceipts: rows.length, uniqueBlobIds: new Set(rows.map((row) => row.blobId)).size, executionBlocked: !execute };
if (!execute) { console.log(JSON.stringify(summary, null, 2)); process.exit(0); }
if (process.env.STAKEMATE_WALRUS_EVIDENCE_IMPORT_APPROVED !== manifest.batchDigest) throw new Error("WALRUS_EVIDENCE_IMPORT_APPROVAL_REQUIRED");
const sql = postgres(databaseUrl, { ssl: databaseUrl.includes("127.0.0.1") || databaseUrl.includes("localhost") ? false : "require", prepare: false, max: 1 });
try { await sql.begin(async (tx) => {
  const existingManifest = await tx`select manifest from stakemate_walrus_manifests where batch_digest = ${manifest.batchDigest} for update`;
  if (existingManifest.length && canonical(existingManifest[0].manifest) !== canonical(manifest)) throw new Error("WALRUS_EVIDENCE_MANIFEST_CONFLICT");
  if (!existingManifest.length) await tx`insert into stakemate_walrus_manifests (batch_digest, version, network, record_count, manifest) values (${manifest.batchDigest}, ${manifest.version}, ${manifest.network}, ${manifest.recordCount}, ${tx.json(manifest)})`;
  for (const receipt of rows) {
    const existing = await tx`select batch_digest, record_id, job_id, blob_id, prepared_at, accepted_at, completed_at, status from stakemate_walrus_receipts where digest = ${receipt.digest} for update`;
    if (existing.length) {
      const current = existing[0];
      if (String(current.batch_digest).trim() !== manifest.batchDigest || String(current.record_id) !== receipt.recordId || (current.job_id === null ? null : String(current.job_id)) !== (receipt.jobId ?? null) || String(current.blob_id) !== receipt.blobId || new Date(current.prepared_at).toISOString() !== new Date(receipt.preparedAt).toISOString() || (current.accepted_at === null ? null : new Date(current.accepted_at).toISOString()) !== (receipt.acceptedAt ? new Date(receipt.acceptedAt).toISOString() : null) || new Date(current.completed_at).toISOString() !== new Date(receipt.completedAt).toISOString() || String(current.status) !== "completed") throw new Error("WALRUS_EVIDENCE_RECEIPT_CONFLICT");
    } else await tx`insert into stakemate_walrus_receipts (digest, batch_digest, record_id, job_id, blob_id, prepared_at, accepted_at, completed_at, status) values (${receipt.digest}, ${manifest.batchDigest}, ${receipt.recordId}, ${receipt.jobId ?? null}, ${receipt.blobId}, ${receipt.preparedAt}, ${receipt.acceptedAt ?? null}, ${receipt.completedAt}, 'completed')`;
  }
}); console.log(JSON.stringify({ ...summary, imported: true }, null, 2)); } finally { await sql.end({ timeout: 5 }); }
