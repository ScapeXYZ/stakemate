#!/usr/bin/env node
/*
 * Checksum-pinned migration controller. Dry-run is the only default mode.
 * Production execution requires a separately injected URL, an explicit target,
 * an approval flag, and a second exact confirmation phrase.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const root = resolve(import.meta.dirname, "..");
const planPath = resolve(root, "docs/MILESTONE_7_27_PRODUCTION_EXECUTION_PLAN.md");
const migrations = [
  ["0002", "db/migrations/0002_invitation_lifecycle_readiness.sql"],
  ["0003", "db/migrations/0003_canonical_duel_commitments.sql"],
  ["0004", "db/migrations/0004_durable_settlement_worker.sql"],
];
const expectedTables = ["stakemate_profiles", "stakemate_auth_nonces", "stakemate_sessions", "stakemate_invitations"];
const execute = process.argv.includes("--execute");
const disposable = process.env.STAKEMATE_DISPOSABLE_MIGRATION_REHEARSAL === "true";
const databaseUrl = process.env.STAKEMATE_MIGRATION_DATABASE_URL;
const sum = async (path) => createHash("sha256").update(await readFile(resolve(root, path))).digest("hex");
const fail = (message) => { throw new Error(message); };

async function checksums() {
  const plan = await readFile(planPath, "utf8");
  const values = await Promise.all(migrations.map(async ([id, path]) => ({ id, path, sha256: await sum(path) })));
  for (const value of values) if (!plan.includes(`\`${value.sha256}\``)) fail(`CHECKSUM_DRIFT_${value.id}`);
  return values;
}
async function baseline(sql) {
  const [identity] = await sql`select current_database() as database_name, current_setting('server_version_num')::int as server_version_num, current_user as current_user`;
  if (Math.floor(Number(identity.server_version_num) / 10000) !== 17) fail("DATABASE_MAJOR_VERSION_MISMATCH");
  const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' and table_name = any(${expectedTables}) order by table_name`;
  if (tables.length !== expectedTables.length) fail("BASELINE_TABLES_MISMATCH");
  const future = await sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('stakemate_invitation_idempotency', 'stakemate_result_evidence', 'stakemate_settlement_jobs')`;
  if (future.length) fail("DATABASE_IS_NOT_0001_BASELINE");
  const [extension] = await sql`select exists(select 1 from pg_extension where extname = 'pgcrypto') as present`;
  if (!extension.present) fail("PGCRYPTO_REQUIRED_BY_0004_MISSING");
  const rls = await sql`select count(*)::int as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname = any(${expectedTables}) and c.relrowsecurity`;
  if (rls[0].count !== expectedTables.length) fail("BASELINE_RLS_MISMATCH");
  const [ledger] = await sql`select to_regclass('public.schema_migrations') is not null as present`;
  return { targetDatabase: String(identity.database_name), serverMajor: 17, baselineTables: tables.length, rlsTables: rls[0].count, migrationLedgerPresent: ledger.present === true };
}

if (!databaseUrl) fail("STAKEMATE_MIGRATION_DATABASE_URL is required; it is read only from the protected environment.");
const migrationChecksums = await checksums();
const sql = postgres(databaseUrl, { ssl: databaseUrl.includes("127.0.0.1") || databaseUrl.includes("localhost") ? false : "require", prepare: false, max: 1 });
try {
  const identity = await baseline(sql);
  if (!execute) {
    console.log(JSON.stringify({ mode: "dry-run", migrationChecksums, identity, executionBlocked: true, requiredExecutionControls: ["--execute", "STAKEMATE_MIGRATION_TARGET=production", "STAKEMATE_MIGRATION_EXECUTION_APPROVED=true", "STAKEMATE_MIGRATION_SECOND_CONFIRMATION=APPLY_0002_0003_0004"] }, null, 2));
  } else {
    const approved = process.env.STAKEMATE_MIGRATION_TARGET === "production" && process.env.STAKEMATE_MIGRATION_EXECUTION_APPROVED === "true" && process.env.STAKEMATE_MIGRATION_SECOND_CONFIRMATION === "APPLY_0002_0003_0004";
    if (!approved && !disposable) fail("PRODUCTION_EXECUTION_REQUIRES_EXPLICIT_APPROVAL_AND_SECOND_CONFIRMATION");
    if (identity.migrationLedgerPresent) fail("MIGRATION_LEDGER_ALREADY_EXISTS_REQUIRES_MANUAL_RECONCILIATION");
    await sql.begin(async (tx) => {
      await tx.unsafe("create table schema_migrations (migration_id text primary key, sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'), applied_at timestamptz not null default clock_timestamp(), applied_by text not null default current_user)");
      for (const migration of migrationChecksums) {
        await tx.unsafe(await readFile(resolve(root, migration.path), "utf8"));
        await tx`insert into schema_migrations (migration_id, sha256) values (${migration.id}, ${migration.sha256})`;
      }
    });
    console.log(JSON.stringify({ mode: disposable ? "disposable-execution-rehearsal" : "production-execution", applied: migrationChecksums.map((item) => item.id) }, null, 2));
  }
} finally { await sql.end({ timeout: 5 }); }
