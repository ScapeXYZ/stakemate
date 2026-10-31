import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";

const url = process.env.STAKEMATE_TEST_DATABASE_URL;
const disposable = process.env.STAKEMATE_WALRUS_EVIDENCE_INTEGRATION_DISPOSABLE === "1";
const local = (() => { try { return Boolean(url) && ["127.0.0.1", "localhost"].includes(new URL(url!).hostname); } catch { return false; } })();
const skip = disposable && local ? false : "requires STAKEMATE_WALRUS_EVIDENCE_INTEGRATION_DISPOSABLE=1 and localhost STAKEMATE_TEST_DATABASE_URL";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const approvedBatch = "590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f";

test("disposable PostgreSQL enforces evidence reader/importer RLS and privileges", { skip }, async () => {
  const sql = postgres(url!, { ssl: false, max: 1 });
  const batch = approvedBatch; const recordId = randomUUID(); const recordDigest = digest(`record:${recordId}`); const blob = `blob-${randomUUID()}`;
  try {
    const [existing] = await sql`select to_regclass('public.stakemate_walrus_manifests') as table_name`;
    if (!existing.table_name) await sql.unsafe(await readFile("db/migrations/0009_durable_walrus_evidence.sql", "utf8"));
    const [policy] = await sql`select exists(select 1 from pg_policies where schemaname = 'public' and policyname = 'stakemate_walrus_evidence_reader_manifest_select') as present`;
    if (!policy.present) await sql.unsafe(await readFile("db/migrations/0010_walrus_evidence_reader_rls.sql", "utf8"));
    const [guard] = await sql`select exists(select 1 from pg_constraint where conname = 'stakemate_walrus_manifests_approved_batch_only') as present`;
    if (!guard.present) await sql.unsafe(await readFile("db/migrations/0011_walrus_evidence_approved_batch_guard.sql", "utf8"));
    await sql.unsafe("do $$ begin create role stakemate_walrus_evidence_reader nologin noinherit nobypassrls; exception when duplicate_object then null; end $$");
    await sql.unsafe("do $$ begin create role stakemate_walrus_evidence_importer nologin noinherit nobypassrls; exception when duplicate_object then null; end $$");
    await sql.unsafe("do $$ begin create role stakemate_walrus_evidence_unauthorized nologin noinherit nobypassrls; exception when duplicate_object then null; end $$");
    await sql.unsafe("grant stakemate_walrus_evidence_reader, stakemate_walrus_evidence_importer, stakemate_walrus_evidence_unauthorized to current_user");
    await sql.unsafe("grant usage on schema public to stakemate_walrus_evidence_reader, stakemate_walrus_evidence_importer");
    await sql.unsafe("grant select on stakemate_walrus_manifests, stakemate_walrus_receipts to stakemate_walrus_evidence_reader");
    await sql.unsafe("grant select, insert on stakemate_walrus_manifests, stakemate_walrus_receipts to stakemate_walrus_evidence_importer");
    await sql.begin(async (tx) => {
      await tx.unsafe("set local role stakemate_walrus_evidence_importer");
      await tx`insert into stakemate_walrus_manifests (batch_digest, version, network, record_count, manifest) values (${batch}, 1, 'mainnet', 10, ${tx.json({ version: 1, network: "mainnet", recordCount: 10, batchDigest: batch, entries: [] })})`;
      await tx`insert into stakemate_walrus_receipts (digest, batch_digest, record_id, blob_id, prepared_at, completed_at, status) values (${recordDigest}, ${batch}, ${recordId}, ${blob}, clock_timestamp(), clock_timestamp(), 'completed')`;
      const duplicate = await tx`insert into stakemate_walrus_receipts (digest, batch_digest, record_id, blob_id, prepared_at, completed_at, status) values (${recordDigest}, ${batch}, ${recordId}, ${blob}, clock_timestamp(), clock_timestamp(), 'completed') on conflict (digest) do nothing returning digest`;
      assert.equal(duplicate.length, 0, "re-import is idempotent");
      await assert.rejects(() => tx`insert into stakemate_walrus_manifests (batch_digest, version, network, record_count, manifest) values (${digest("wrong-batch")}, 1, 'mainnet', 10, ${tx.json({})})`, /approved_batch_only/);
    });
    await sql.begin(async (tx) => { await tx.unsafe("set local role stakemate_walrus_evidence_reader"); const rows = await tx`select digest from stakemate_walrus_receipts where digest = ${recordDigest}`; assert.equal(rows.length, 1); await assert.rejects(() => tx`insert into stakemate_walrus_manifests (batch_digest, version, network, record_count, manifest) values (${digest("reader-write")}, 1, 'mainnet', 10, ${tx.json({})})`, /permission denied/); });
    await sql.begin(async (tx) => { await tx.unsafe("set local role stakemate_walrus_evidence_importer"); await assert.rejects(() => tx`update stakemate_walrus_receipts set blob_id = 'tampered' where digest = ${recordDigest}`, /permission denied/); });
    await sql.begin(async (tx) => { await tx.unsafe("set local role stakemate_walrus_evidence_unauthorized"); await assert.rejects(() => tx`select digest from stakemate_walrus_receipts where digest = ${recordDigest}`, /permission denied/); });
  } finally { await sql.end({ timeout: 5 }); }
});
