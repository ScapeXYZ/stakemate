import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { prepareWalrusBatch } from "../src/lib/server/walrus-batch";
import { getPostgresWalrusEvidenceStore } from "../src/lib/server/walrus-evidence-store";

const execute = promisify(execFile);
const expectedDigest = "590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f";
const records = Array.from({ length: 10 }, (_, index) => ({ id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, occurredAt: `2030-02-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`, challengeId: `challenge-${index}`, actorId: "operator", type: "challenge.created" as const, fixture: `Fixture ${index}`, market: "home_win", deadline: "2030-03-01T00:00:00.000Z" }));

test("evidence store never falls back to the broad application database URL", () => {
  const previousEvidence = process.env.STAKEMATE_WALRUS_EVIDENCE_DATABASE_URL; const previousApplication = process.env.DATABASE_URL;
  try {
    delete process.env.STAKEMATE_WALRUS_EVIDENCE_DATABASE_URL; process.env.DATABASE_URL = "postgres://broad-application.example/stakemate";
    assert.throws(() => getPostgresWalrusEvidenceStore(), /WALRUS_EVIDENCE_DATABASE_NOT_CONFIGURED/);
  } finally {
    if (previousEvidence === undefined) delete process.env.STAKEMATE_WALRUS_EVIDENCE_DATABASE_URL; else process.env.STAKEMATE_WALRUS_EVIDENCE_DATABASE_URL = previousEvidence;
    if (previousApplication === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousApplication;
  }
});

test("private importer rejects a valid-looking non-approved batch before opening a database connection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stakemate-evidence-test-"));
  try {
    const manifest = prepareWalrusBatch(records); assert.notEqual(manifest.batchDigest, expectedDigest);
    const journal = Object.fromEntries(manifest.entries.map((entry) => [entry.digest, { recordId: entry.recordId, digest: entry.digest, status: "completed", blobId: `blob-${entry.recordId}`, preparedAt: "2030-01-01T00:00:00.000Z", completedAt: "2030-01-01T00:01:00.000Z" }]));
    await writeFile(join(directory, "mainnet-batch.json"), JSON.stringify(manifest)); await writeFile(join(directory, "receipts.json"), JSON.stringify(journal));
    await assert.rejects(() => execute(process.execPath, ["scripts/import-walrus-evidence.mjs"], { cwd: process.cwd(), env: { ...process.env, STAKEMATE_WALRUS_EVIDENCE_DIR: directory, STAKEMATE_WALRUS_EVIDENCE_IMPORT_DATABASE_URL: "postgres://unreachable.invalid/stakemate" } }), /WALRUS_EVIDENCE_UNEXPECTED_BATCH_DIGEST/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("RLS follow-up grants reader select only and importer select/insert only", async () => {
  const [migration, roles] = await Promise.all([readFile("db/migrations/0010_walrus_evidence_reader_rls.sql", "utf8"), readFile("db/roles/walrus-evidence-least-privilege.sql", "utf8")]);
  for (const policy of ["reader_manifest_select", "reader_receipt_select", "importer_manifest_select", "importer_manifest_insert", "importer_receipt_select", "importer_receipt_insert"]) assert.match(migration, new RegExp(`stakemate_walrus_evidence_${policy}`));
  assert.match(migration, /current_user = 'stakemate_walrus_evidence_reader'/); assert.match(migration, /current_user = 'stakemate_walrus_evidence_importer'/);
  assert.match(roles, /GRANT SELECT ON stakemate_walrus_manifests, stakemate_walrus_receipts TO stakemate_walrus_evidence_reader/);
  assert.match(roles, /GRANT SELECT, INSERT ON stakemate_walrus_manifests, stakemate_walrus_receipts TO stakemate_walrus_evidence_importer/);
  assert.doesNotMatch(roles, /UPDATE|DELETE/);
});
