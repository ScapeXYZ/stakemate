import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import postgres from "postgres";

const run = promisify(execFile);
const enabled = process.env.STAKEMATE_BACKUP_INTEGRATION_DISPOSABLE === "1";
const url = process.env.STAKEMATE_TEST_DATABASE_URL;
const local = (() => { try { return Boolean(url) && ["127.0.0.1", "localhost"].includes(new URL(url!).hostname); } catch { return false; } })();
const skip = enabled && local ? false : "requires STAKEMATE_BACKUP_INTEGRATION_DISPOSABLE=1 and localhost STAKEMATE_TEST_DATABASE_URL";

test("PostgreSQL 17 backup creates host-owned encrypted output and removes plaintext", { skip }, async () => {
  const root = await mkdtemp(resolve(tmpdir(), "stakemate-backup-test-"));
  const destination = resolve(root, "private-backups"); const key = resolve(root, "synthetic.key");
  await chmod(root, 0o700); await writeFile(key, "synthetic-test-passphrase", { mode: 0o600, flag: "wx" });
  const sql = postgres(url!, { ssl: false, max: 1 }); const suffix = randomUUID().slice(0, 8);
  try {
    await sql`insert into stakemate_profiles (id, wallet_address, username, username_normalized, created_at, updated_at) values (${randomUUID()}, ${`0x${"f".repeat(56)}${suffix}`.slice(0, 66)}, ${`backup_${suffix}`}, ${`backup_${suffix}`}, clock_timestamp(), clock_timestamp())`;
    const source = new URL(url!); source.hostname = "postgres"; source.port = "5432";
    await run(process.execPath, ["scripts/create-encrypted-supabase-backup.mjs"], { cwd: process.cwd(), env: { ...process.env, SUPABASE_BACKUP_DATABASE_URL: source.toString(), SUPABASE_BACKUP_CONNECTION_KIND: "direct", STAKEMATE_BACKUP_KEY_FILE: key, STAKEMATE_BACKUP_DIRECTORY: destination, STAKEMATE_BACKUP_TEST_MODE: "true", STAKEMATE_BACKUP_SSLMODE: "disable", STAKEMATE_BACKUP_DOCKER_NETWORK: "stakemate_backup_fix_default" } });
    const files = await readdir(destination); const encrypted = files.find((item) => item.endsWith(".dump.gpg")); const checksum = files.find((item) => item.endsWith(".dump.gpg.sha256"));
    assert.ok(encrypted); assert.ok(checksum); assert.equal(files.some((item) => item.endsWith(".dump")), false);
    const encryptedPath = resolve(destination, encrypted!); const details = await stat(encryptedPath);
    const uid = process.getuid?.(); const gid = process.getgid?.();
    if (uid === undefined || gid === undefined) throw new Error("POSIX ownership checks are unavailable in this test runtime.");
    assert.equal(details.uid, uid); assert.equal(details.gid, gid); assert.equal(details.mode & 0o777, 0o600);
    const digest = createHash("sha256").update(await readFile(encryptedPath)).digest("hex");
    assert.match(await readFile(resolve(destination, checksum!), "utf8"), new RegExp(`^${digest}\\s+${encrypted}\\n$`, "u"));
  } finally { await sql.end({ timeout: 5 }); await rm(root, { recursive: true, force: true }); }
});
