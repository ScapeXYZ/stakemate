#!/usr/bin/env node
/* Apply only the additive 0009 evidence migration after the existing 0002–0004 ledger. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const root = resolve(import.meta.dirname, "..");
const migrationId = "0009";
const migrationPath = "db/migrations/0009_durable_walrus_evidence.sql";
const execute = process.argv.includes("--execute");
const databaseUrl = process.env.STAKEMATE_MIGRATION_DATABASE_URL;
if (!databaseUrl) throw new Error("STAKEMATE_MIGRATION_DATABASE_URL_REQUIRED");
const body = await readFile(resolve(root, migrationPath), "utf8");
const checksum = createHash("sha256").update(body).digest("hex");
const sql = postgres(databaseUrl, { ssl: databaseUrl.includes("127.0.0.1") || databaseUrl.includes("localhost") ? false : "require", prepare: false, max: 1 });
try {
  const migrations = await sql`select migration_id, sha256 from schema_migrations order by migration_id`;
  const applied = new Map(migrations.map((row) => [String(row.migration_id), String(row.sha256).trim()]));
  for (const id of ["0002", "0003", "0004"]) if (!applied.has(id)) throw new Error(`WALRUS_EVIDENCE_BASELINE_${id}_MISSING`);
  const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('stakemate_walrus_manifests', 'stakemate_walrus_receipts') order by table_name`;
  if (applied.has(migrationId) && (applied.get(migrationId) !== checksum || tables.length !== 2)) throw new Error("WALRUS_EVIDENCE_MIGRATION_DRIFT");
  const plan = { migrationId, sha256: checksum, alreadyApplied: applied.has(migrationId), existingEvidenceTables: tables.map((row) => row.table_name), executionBlocked: !execute };
  if (!execute) console.log(JSON.stringify(plan, null, 2));
  else {
    if (process.env.STAKEMATE_MIGRATION_TARGET !== "production" || process.env.STAKEMATE_WALRUS_EVIDENCE_MIGRATION_APPROVED !== checksum) throw new Error("WALRUS_EVIDENCE_MIGRATION_APPROVAL_REQUIRED");
    if (!applied.has(migrationId)) await sql.begin(async (tx) => { await tx`select pg_advisory_xact_lock(9009009)`; await tx.unsafe(body); await tx`insert into schema_migrations (migration_id, sha256) values (${migrationId}, ${checksum})`; });
    console.log(JSON.stringify({ ...plan, applied: true }, null, 2));
  }
} finally { await sql.end({ timeout: 5 }); }
