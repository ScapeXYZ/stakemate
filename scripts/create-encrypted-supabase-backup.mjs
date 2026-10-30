#!/usr/bin/env node
/*
 * Operator-only backup command. It is intentionally not wired to an npm script:
 * a fresh production backup belongs to an approved maintenance operation, not CI.
 * It never prints connection strings, passphrases, table rows, or decrypted data.
 */
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const backupDirectory = resolve(process.env.STAKEMATE_BACKUP_DIRECTORY ?? "/home/temitope/stakemate-private-backups");
const keyFile = process.env.STAKEMATE_BACKUP_KEY_FILE;
const sourceUrl = process.env.SUPABASE_BACKUP_DATABASE_URL;
const connectionKind = process.env.SUPABASE_BACKUP_CONNECTION_KIND;
const tables = ["stakemate_profiles", "stakemate_auth_nonces", "stakemate_sessions", "stakemate_invitations"];

function fail(message) { throw new Error(message); }
function outsideRepository(path) { const fromRoot = relative(root, path); return fromRoot !== "" && (fromRoot.startsWith("..") || isAbsolute(fromRoot)); }
function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stderr = ""; let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolveRun(stdout) : reject(new Error(`${command} failed (${code ?? "unknown"}): ${stderr.replaceAll(/postgres(?:ql)?:\/\/[^\s]+/giu, "[redacted-url]").slice(0, 500)}`)));
  });
}
function parseUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail("SUPABASE_BACKUP_DATABASE_URL must be a valid PostgreSQL URL."); }
  if (!/^postgres(?:ql)?:$/iu.test(url.protocol) || !url.hostname || !url.username || !url.password || !url.pathname || url.pathname === "/") fail("Backup URL must include PostgreSQL host, user, password, and database.");
  return url;
}
async function sha256(path) { return createHash("sha256").update(await readFile(path)).digest("hex"); }

if (process.argv.includes("--help")) {
  console.log("Usage: SUPABASE_BACKUP_DATABASE_URL=<session-or-direct-url> SUPABASE_BACKUP_CONNECTION_KIND=session|direct STAKEMATE_BACKUP_KEY_FILE=<absolute-key-file> node scripts/create-encrypted-supabase-backup.mjs");
  process.exit(0);
}
if (!sourceUrl) fail("SUPABASE_BACKUP_DATABASE_URL is required; do not assume the application transaction-pooler URL is dump-safe.");
if (connectionKind !== "session" && connectionKind !== "direct") fail("SUPABASE_BACKUP_CONNECTION_KIND must be session or direct.");
if (!keyFile || !isAbsolute(keyFile)) fail("STAKEMATE_BACKUP_KEY_FILE must be an absolute protected-file path.");
if (!outsideRepository(backupDirectory)) fail("Backup directory must be outside the repository.");
const url = parseUrl(sourceUrl);
await stat(keyFile);
await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
await chmod(backupDirectory, 0o700);
const requestedSslMode = process.env.STAKEMATE_BACKUP_SSLMODE ?? "require";
const requestedTestNetwork = process.env.STAKEMATE_BACKUP_DOCKER_NETWORK;
const testMode = process.env.STAKEMATE_BACKUP_TEST_MODE === "true";
if (requestedTestNetwork && (!testMode || !/^[A-Za-z0-9_.-]{1,100}$/u.test(requestedTestNetwork))) fail("INVALID_LOCAL_TEST_DOCKER_NETWORK");
const localTestMode = testMode && (["127.0.0.1", "localhost", "host.docker.internal"].includes(url.hostname) || (Boolean(requestedTestNetwork) && url.hostname === "postgres"));
if (requestedSslMode !== "require" && !(localTestMode && requestedSslMode === "disable")) fail("BACKUP_SSLMODE_MUST_BE_REQUIRE_OUTSIDE_LOCAL_TEST_MODE");

const label = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const prefix = `stakemate-supabase-${label}-${randomUUID().slice(0, 8)}`;
const plaintext = resolve(backupDirectory, `${prefix}.dump`);
const encrypted = resolve(backupDirectory, `${prefix}.dump.gpg`);
const checksum = resolve(backupDirectory, `${prefix}.dump.gpg.sha256`);
const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "stakemate-backup-"));
await chmod(temporaryDirectory, 0o700);
const pgEnv = resolve(temporaryDirectory, "pg.env");
const inspectCopy = resolve(temporaryDirectory, "archive.inspect.dump");
let cleaned = false;
async function cleanup() {
  if (cleaned) return; cleaned = true;
  await Promise.allSettled([rm(plaintext, { force: true }), rm(temporaryDirectory, { recursive: true, force: true })]);
}
const interrupted = (code) => { void cleanup().finally(() => process.exit(code)); };
const onSigint = () => interrupted(130); const onSigterm = () => interrupted(143);
process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);

try {
  // Create host-owned, mode-0600 targets before Docker or GnuPG writes any plaintext.
  await writeFile(plaintext, "", { mode: 0o600, flag: "wx" });
  await writeFile(inspectCopy, "", { mode: 0o600, flag: "wx" });
  // Docker receives only a protected env-file path; its process arguments never contain credentials.
  const pgEnvContents = [`PGHOST=${url.hostname}`, `PGPORT=${url.port || "5432"}`, `PGUSER=${decodeURIComponent(url.username)}`, `PGPASSWORD=${decodeURIComponent(url.password)}`, `PGDATABASE=${decodeURIComponent(url.pathname.slice(1))}`, `PGSSLMODE=${requestedSslMode}`].join("\n") + "\n";
  await writeFile(pgEnv, pgEnvContents, { mode: 0o600, flag: "wx" });
  const localHostGateway = localTestMode && url.hostname === "host.docker.internal" ? ["--add-host", "host.docker.internal:host-gateway"] : [];
  const localNetwork = requestedTestNetwork ? ["--network", requestedTestNetwork] : [];
  await run("docker", ["run", "--rm", "--user", `${process.getuid()}:${process.getgid()}`, ...localHostGateway, ...localNetwork, "--env-file", pgEnv, "-v", `${backupDirectory}:/backup`, "postgres:17-alpine", "pg_dump", "--format=custom", "--schema=public", ...tables.flatMap((table) => ["--table", table]), "--file", `/backup/${basename(plaintext)}`]);
  await run("gpg", ["--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase-file", keyFile, "--symmetric", "--cipher-algo", "AES256", "--output", encrypted, plaintext]);
  await chmod(encrypted, 0o600);
  const digest = await sha256(encrypted);
  await writeFile(checksum, `${digest}  ${basename(encrypted)}\n`, { mode: 0o600, flag: "wx" });
  // Proves both key recoverability and a PostgreSQL 17-compatible archive listing.
  await run("gpg", ["--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase-file", keyFile, "--decrypt", "--output", inspectCopy, encrypted]);
  const listing = await run("docker", ["run", "--rm", "--user", `${process.getuid()}:${process.getgid()}`, "-v", `${temporaryDirectory}:/inspect:ro`, "postgres:17-alpine", "pg_restore", "--list", "/inspect/archive.inspect.dump"]);
  if (tables.some((table) => !new RegExp(`\\bTABLE\\s+public\\s+${table}\\b`, "u").test(listing))) fail("BACKUP_ARCHIVE_TABLE_SET_MISMATCH");
  console.log(JSON.stringify({ backupCreated: true, encryptedArchive: encrypted, checksumFile: checksum, sha256: digest, tables, postgresqlClientMajor: 17, connectionKind }, null, 2));
} finally {
  await cleanup();
  process.removeListener("SIGINT", onSigint); process.removeListener("SIGTERM", onSigterm);
}
