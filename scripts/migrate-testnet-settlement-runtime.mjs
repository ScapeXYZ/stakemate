#!/usr/bin/env node
/*
 * Forward-only controller for 0012-0014. It is offline by default and never
 * connects unless --execute and every independent production approval gate is
 * present. It neither enables workers nor touches Sui signing/broadcasting.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const root = resolve(import.meta.dirname, "..");
const manifestPath = "db/migrations/0012-0014-testnet-settlement.manifest.json";
const manifest = JSON.parse(await readFile(resolve(root, manifestPath), "utf8"));
const execute = process.argv.includes("--execute");
const targetTables = manifest.migrations.flatMap((migration) => migration.tables);
const fail = (code) => { throw new Error(code); };
const checksum = (source) => createHash("sha256").update(source).digest("hex");
const safeRole = (value) => typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/u.test(value);

if (!Array.isArray(manifest.migrations) || manifest.migrations.map((item) => item.id).join(",") !== "0012,0013,0014") fail("SETTLEMENT_MANIFEST_ORDER_INVALID");
if (!Array.isArray(manifest.requiredAppliedMigrations) || manifest.requiredAppliedMigrations.join(",") !== "0002,0003,0004") fail("SETTLEMENT_MANIFEST_PREREQUISITES_INVALID");

const files = await Promise.all(manifest.migrations.map(async (migration) => {
  if (!/^00(12|13|14)$/u.test(migration.id) || typeof migration.file !== "string" || !/^[0-9a-f]{64}$/u.test(migration.sha256)) fail("SETTLEMENT_MANIFEST_ENTRY_INVALID");
  const source = await readFile(resolve(root, migration.file), "utf8");
  const sha256 = checksum(source);
  if (sha256 !== migration.sha256) fail(`SETTLEMENT_MIGRATION_CHECKSUM_MISMATCH_${migration.id}`);
  return { ...migration, source, sha256 };
}));
const plan = {
  manifest: manifestPath,
  migrations: files.map(({ id, file, sha256, tables }) => ({ id, file, sha256, tables })),
  executionBlocked: !execute,
  requiredExecutionControls: [
    "--execute",
    "STAKEMATE_SETTLEMENT_MIGRATION_TARGET=production",
    "STAKEMATE_SETTLEMENT_MIGRATION_APPROVED=true",
    "STAKEMATE_SETTLEMENT_MIGRATION_SECOND_CONFIRMATION=APPLY_TESTNET_SETTLEMENT_RUNTIME_0012_0014",
    "STAKEMATE_SETTLEMENT_MIGRATION_DATABASE_URL",
    "STAKEMATE_SETTLEMENT_MIGRATION_EXPECTED_DATABASE",
    "STAKEMATE_SETTLEMENT_RUNTIME_ROLE"
  ]
};

// Default mode proves the exact local bytes and deliberately makes no network
// or database connection.
if (!execute) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

const databaseUrl = process.env.STAKEMATE_SETTLEMENT_MIGRATION_DATABASE_URL;
const expectedDatabase = process.env.STAKEMATE_SETTLEMENT_MIGRATION_EXPECTED_DATABASE;
const runtimeRole = process.env.STAKEMATE_SETTLEMENT_RUNTIME_ROLE;
const approved = process.env.STAKEMATE_SETTLEMENT_MIGRATION_TARGET === "production"
  && process.env.STAKEMATE_SETTLEMENT_MIGRATION_APPROVED === "true"
  && process.env.STAKEMATE_SETTLEMENT_MIGRATION_SECOND_CONFIRMATION === "APPLY_TESTNET_SETTLEMENT_RUNTIME_0012_0014";
if (!approved) fail("SETTLEMENT_MIGRATION_EXPLICIT_APPROVAL_REQUIRED");
if (!databaseUrl || !expectedDatabase || !safeRole(runtimeRole)) fail("SETTLEMENT_MIGRATION_EXECUTION_CONFIGURATION_REQUIRED");
let parsed;
try { parsed = new URL(databaseUrl); } catch { fail("SETTLEMENT_MIGRATION_DATABASE_URL_INVALID"); }
if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.username) fail("SETTLEMENT_MIGRATION_DATABASE_URL_INVALID");
const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
const sql = postgres(databaseUrl, { prepare: false, max: 1, ssl: loopback ? false : "require", connect_timeout: 10, idle_timeout: 10 });

async function preflight(tx) {
  const [identity] = await tx`select current_database() as database_name, current_user as current_user, current_setting('server_version_num')::int as server_version_num`;
  if (!identity || identity.database_name !== expectedDatabase) fail("SETTLEMENT_MIGRATION_DATABASE_IDENTITY_MISMATCH");
  const [ledgerPresent] = await tx`select to_regclass('public.schema_migrations') is not null as present`;
  if (!ledgerPresent?.present) fail("SETTLEMENT_MIGRATION_LEDGER_MISSING");
  const ledger = await tx`select migration_id, btrim(sha256) as sha256 from public.schema_migrations where migration_id = any(${[...manifest.requiredAppliedMigrations, ...files.map((item) => item.id)]}) order by migration_id`;
  const applied = new Map(ledger.map((row) => [String(row.migration_id), String(row.sha256)]));
  for (const id of manifest.requiredAppliedMigrations) if (!applied.has(id)) fail(`SETTLEMENT_MIGRATION_PREREQUISITE_MISSING_${id}`);
  if (files.some((item) => applied.has(item.id))) fail("SETTLEMENT_MIGRATION_ALREADY_OR_PARTIALLY_RECORDED");
  const relations = await tx`
    select n.nspname as schema_name, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relname = any(${targetTables}) and c.relkind in ('r','p','v','m','f')
      and n.nspname not in ('pg_catalog', 'information_schema')
  `;
  if (relations.length) fail("SETTLEMENT_MIGRATION_TARGET_RELATION_ALREADY_EXISTS");
  const [invitation] = await tx`
    select data_type, udt_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'stakemate_invitations' and column_name = 'id'
  `;
  if (!invitation || invitation.data_type !== 'uuid') fail("SETTLEMENT_MIGRATION_INVITATIONS_UUID_PREREQUISITE_MISSING");
  const [runtime] = await tx`select rolbypassrls from pg_roles where rolname = ${runtimeRole}`;
  if (!runtime) fail("SETTLEMENT_MIGRATION_RUNTIME_ROLE_MISSING");
  // The reviewed 0012-0014 files enable RLS but intentionally contain no
  // policies/grants. Refuse to create inaccessible tables for a separate role.
  if (identity.current_user !== runtimeRole && !runtime.rolbypassrls) fail("SETTLEMENT_MIGRATION_RUNTIME_RLS_ACCESS_PLAN_REQUIRED");
  const [canCreate] = await tx`select has_schema_privilege(current_user, 'public', 'CREATE') as allowed`;
  if (!canCreate?.allowed) fail("SETTLEMENT_MIGRATION_CREATE_PRIVILEGE_MISSING");
  return { database: identity.database_name, migrationRole: identity.current_user, runtimeRole, runtimeRoleBypassRls: runtime.rolbypassrls === true, serverVersion: identity.server_version_num };
}

try {
  const result = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(9012014)`;
    // The reviewed files intentionally retain their exact unqualified SQL.
    // Pin object creation to public for this transaction rather than relying
    // on a role-specific default search_path.
    await tx.unsafe("set local search_path = public, pg_catalog");
    const identity = await preflight(tx);
    for (const migration of files) {
      await tx.unsafe(migration.source);
      await tx`insert into public.schema_migrations (migration_id, sha256) values (${migration.id}, ${migration.sha256})`;
    }
    const tables = await tx`
      select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname = any(${targetTables})
      order by c.relname
    `;
    const recorded = await tx`select migration_id, btrim(sha256) as sha256 from public.schema_migrations where migration_id = any(${files.map((item) => item.id)}) order by migration_id`;
    if (tables.length !== targetTables.length || tables.some((row) => !row.relrowsecurity)) fail("SETTLEMENT_MIGRATION_POSTCHECK_SCHEMA_OR_RLS_FAILED");
    if (recorded.length !== files.length || recorded.some((row, index) => row.migration_id !== files[index].id || row.sha256 !== files[index].sha256)) fail("SETTLEMENT_MIGRATION_POSTCHECK_LEDGER_FAILED");
    return { ...identity, tables: tables.map((row) => row.relname), applied: files.map(({ id, sha256 }) => ({ id, sha256 })) };
  });
  console.log(JSON.stringify({ mode: "production-execution", ...result }, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}
