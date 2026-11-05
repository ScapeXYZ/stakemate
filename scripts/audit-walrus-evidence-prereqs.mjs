#!/usr/bin/env node
/* Read-only production prerequisite audit. Never prints URLs, rows, or secrets. */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const databaseUrl = process.env.STAKEMATE_MIGRATION_DATABASE_URL;
if (!databaseUrl) throw new Error("STAKEMATE_MIGRATION_DATABASE_URL_REQUIRED");
const root = resolve(import.meta.dirname, "..");
const migrationFiles = new Map([["0002", "db/migrations/0002_invitation_lifecycle_readiness.sql"], ["0003", "db/migrations/0003_canonical_duel_commitments.sql"], ["0004", "db/migrations/0004_durable_settlement_worker.sql"], ["0009", "db/migrations/0009_durable_walrus_evidence.sql"], ["0010", "db/migrations/0010_walrus_evidence_reader_rls.sql"], ["0011", "db/migrations/0011_walrus_evidence_approved_batch_guard.sql"]]);
const expectedChecksums = Object.fromEntries(await Promise.all([...migrationFiles].map(async ([id, file]) => [id, createHash("sha256").update(await readFile(resolve(root, file))).digest("hex")])));
const acceptedHistorical0009Checksums = [expectedChecksums["0009"], "696e10973ac189bd5849983f7cc3747b8f4ae911856be8dc0f06073b20fd9ffe"];
const sql = postgres(databaseUrl, { ssl: databaseUrl.includes("127.0.0.1") || databaseUrl.includes("localhost") ? false : "require", prepare: false, max: 1 });
try {
  const [ledger] = await sql`select to_regclass('public.schema_migrations') as relation`;
  if (!ledger?.relation) throw new Error("SCHEMA_MIGRATIONS_MISSING: STAKEMATE_MIGRATION_DATABASE_URL must target the database previously migrated by the controlled migration runner; do not create or backfill the ledger manually.");
  const [capability] = await sql`select current_user as role, rolsuper, rolcreaterole, rolbypassrls from pg_roles where rolname = current_user`;
  const migrations = await sql`select migration_id, sha256 from schema_migrations where migration_id in ('0002','0003','0004','0009','0010','0011') order by migration_id`;
  const roles = await sql`select rolname, rolcanlogin, rolinherit, rolbypassrls, rolsuper, rolcreaterole from pg_roles where rolname in ('stakemate_walrus_evidence_reader', 'stakemate_walrus_evidence_importer') order by rolname`;
  const tables = await sql`select c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('stakemate_walrus_manifests','stakemate_walrus_receipts') order by c.relname`;
  const policies = await sql`select tablename, policyname, roles, cmd from pg_policies where schemaname = 'public' and tablename in ('stakemate_walrus_manifests','stakemate_walrus_receipts') order by tablename, policyname`;
  const grants = await sql`select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name in ('stakemate_walrus_manifests','stakemate_walrus_receipts') order by grantee, table_name, privilege_type`;
  const ownership = await sql`select r.rolname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_roles r on r.oid = c.relowner where n.nspname = 'public' and c.relname in ('stakemate_walrus_manifests','stakemate_walrus_receipts') order by c.relname`;
  const evidence = await sql`select (select count(*)::int from stakemate_walrus_manifests) as manifest_count, (select count(*)::int from stakemate_walrus_manifests where batch_digest = '590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f') as approved_manifest_count, count(*)::int as receipt_count, count(*) filter (where batch_digest = '590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f' and status = 'completed')::int as approved_completed_receipt_count, count(distinct record_id)::int as distinct_record_count, count(distinct blob_id)::int as distinct_blob_count, count(*) filter (where batch_digest <> '590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f')::int as unexpected_batch_count from stakemate_walrus_receipts`;
  const memberships = await sql`select member_role.rolname as member, parent_role.rolname as parent from pg_auth_members m join pg_roles member_role on member_role.oid = m.member join pg_roles parent_role on parent_role.oid = m.roleid where member_role.rolname = 'stakemate_walrus_evidence_reader' order by parent_role.rolname`;
  const applied = new Map(migrations.map((row) => [String(row.migration_id), String(row.sha256).trim()]));
  const historical0009 = { recordedChecksum: applied.get("0009") ?? null, recognized: acceptedHistorical0009Checksums.includes(applied.get("0009")), approvedException: applied.get("0009") === "696e10973ac189bd5849983f7cc3747b8f4ae911856be8dc0f06073b20fd9ffe" };
  console.log(JSON.stringify({ capability, expectedChecksums, historical0009, migrations, roles, tables, policies, grants, ownership, evidence: evidence[0], readerMemberships: memberships, backupRecovery: "BLOCKED_EXTERNAL_PROVIDER_AUDIT_REQUIRED" }, null, 2));
} finally { await sql.end({ timeout: 5 }); }
