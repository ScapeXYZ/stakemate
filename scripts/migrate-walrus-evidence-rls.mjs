#!/usr/bin/env node
/* Applies only additive 0010 RLS policies after checksum-pinned 0009. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const root = resolve(import.meta.dirname, "..");
const migrationId = "0010";
const path = "db/migrations/0010_walrus_evidence_reader_rls.sql";
const execute = process.argv.includes("--execute");
const databaseUrl = process.env.STAKEMATE_MIGRATION_DATABASE_URL;
if (!databaseUrl) throw new Error("STAKEMATE_MIGRATION_DATABASE_URL_REQUIRED");
const body = await readFile(resolve(root, path), "utf8");
const checksum = createHash("sha256").update(body).digest("hex");
const sql = postgres(databaseUrl, { ssl: databaseUrl.includes("127.0.0.1") || databaseUrl.includes("localhost") ? false : "require", prepare: false, max: 1 });
try {
  const rows = await sql`select migration_id, sha256 from schema_migrations where migration_id in ('0009', '0010') order by migration_id`;
  const applied = new Map(rows.map((row) => [String(row.migration_id), String(row.sha256).trim()]));
  if (!applied.has("0009")) throw new Error("WALRUS_EVIDENCE_0009_MISSING");
  if (applied.has(migrationId) && applied.get(migrationId) !== checksum) throw new Error("WALRUS_EVIDENCE_RLS_MIGRATION_DRIFT");
  const plan = { migrationId, sha256: checksum, alreadyApplied: applied.has(migrationId), executionBlocked: !execute };
  if (!execute) console.log(JSON.stringify(plan, null, 2));
  else {
    if (process.env.STAKEMATE_MIGRATION_TARGET !== "production" || process.env.STAKEMATE_WALRUS_EVIDENCE_RLS_MIGRATION_APPROVED !== checksum) throw new Error("WALRUS_EVIDENCE_RLS_MIGRATION_APPROVAL_REQUIRED");
    if (!applied.has(migrationId)) await sql.begin(async (tx) => { await tx`select pg_advisory_xact_lock(9009010)`; await tx.unsafe(body); await tx`insert into schema_migrations (migration_id, sha256) values (${migrationId}, ${checksum})`; });
    console.log(JSON.stringify({ ...plan, applied: true }, null, 2));
  }
} finally { await sql.end({ timeout: 5 }); }
