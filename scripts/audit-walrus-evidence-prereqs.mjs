#!/usr/bin/env node
/* Read-only production prerequisite audit. Never prints URLs, rows, or secrets. */
import postgres from "postgres";

const databaseUrl = process.env.STAKEMATE_MIGRATION_DATABASE_URL;
if (!databaseUrl) throw new Error("STAKEMATE_MIGRATION_DATABASE_URL_REQUIRED");
const sql = postgres(databaseUrl, { ssl: databaseUrl.includes("127.0.0.1") || databaseUrl.includes("localhost") ? false : "require", prepare: false, max: 1 });
try {
  const [capability] = await sql`select current_user as role, rolsuper, rolcreaterole, rolbypassrls from pg_roles where rolname = current_user`;
  const migrations = await sql`select migration_id, sha256 from schema_migrations where migration_id in ('0002','0003','0004','0009','0010') order by migration_id`;
  const roles = await sql`select rolname, rolcanlogin, rolinherit, rolbypassrls, rolsuper, rolcreaterole from pg_roles where rolname in ('stakemate_walrus_evidence_reader', 'stakemate_walrus_evidence_importer') order by rolname`;
  const tables = await sql`select c.relname, c.relrowsecurity, pg_get_userbyid(c.relowner) as owner from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('stakemate_walrus_manifests','stakemate_walrus_receipts') order by c.relname`;
  const policies = await sql`select tablename, policyname, roles, cmd from pg_policies where schemaname = 'public' and tablename in ('stakemate_walrus_manifests','stakemate_walrus_receipts') order by tablename, policyname`;
  const grants = await sql`select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name in ('stakemate_walrus_manifests','stakemate_walrus_receipts') order by grantee, table_name, privilege_type`;
  console.log(JSON.stringify({ capability, migrations, roles, tables, policies, grants }, null, 2));
} finally { await sql.end({ timeout: 5 }); }
