# Milestone 7.28 controlled migration preparation

This package prepares a Free Plan maintenance operation. It does not authorize a production backup, freeze, migration, grant change, or application activation.

## Fresh encrypted backup runbook

`scripts/create-encrypted-supabase-backup.mjs` is an operator-only command and is intentionally not an npm shortcut or CI step. At the approved maintenance window, supply a protected `SUPABASE_BACKUP_DATABASE_URL` through the host secret mechanism, declare `SUPABASE_BACKUP_CONNECTION_KIND=session` or `direct`, and supply a separately protected absolute `STAKEMATE_BACKUP_KEY_FILE`. The script refuses the ordinary application `DATABASE_URL` so a transaction-pooler endpoint is not silently assumed dump-safe.

It uses `postgres:17-alpine` `pg_dump`, limited to the four current public StakeMate tables, writes a custom archive to an absolute directory outside the repository, encrypts it with AES-256 using a passphrase file, creates a SHA-256 sidecar, decrypts only to a mode-0600 temporary file, and confirms the archive with PostgreSQL 17 `pg_restore --list`. Temporary plaintext, Docker env-file credentials, and inspection copies are removed in a `finally` path. The archive, checksum, and backup directory are mode 0600/0700. No URL, password, key, table row, or plaintext is written to output or passed as a command argument.

Use a new timestamped archive for every approved attempt; the script does not overwrite the existing verified archive. Recover only into a newly created localhost-only PostgreSQL 17 container using `pg_restore --no-owner --no-privileges`; never restore over Supabase. Because this archive deliberately scopes data/schema to four tables, it does not carry the database-level `pgcrypto` extension. Provision `pgcrypto` in the disposable recovery database before migration rehearsal, then verify it is present; production already has it. Compare the four table counts, constraints, indexes, RLS flags, and note the expected local-owner difference caused by `--no-owner`.

## Application write freeze

`STAKEMATE_MAINTENANCE_WRITE_FREEZE=true` is a server-only deployment setting and defaults to off. When enabled it rejects application-owned mutations before database or provider access:

- nonce cleanup, creation, and consumption;
- session create/revoke and profile-handle changes;
- legacy and canonical invitation create/respond/expiry actions;
- durable settlement claim, prepare, lease recovery, and reconciliation;
- Walrus write/reconciliation paths.

Invitation inbox reads were changed to be read-only: they no longer turn pending rows into expired rows. Lifecycle expiry remains an explicit guarded write. `GET /api/health/maintenance` returns only `{ applicationWritesFrozen: boolean }`, performs no database/provider call, and has `no-store` caching.

The freeze controls StakeMate application processes only. Before maintenance, administrators must also restrict Dashboard/SQL Editor access to named operators, disable scheduled or external integration writers, remove deployment write credentials from non-maintenance jobs, and record all emergency access. It cannot technically prevent a Supabase owner, SQL Editor user, or leaked owner credential from writing; that is an operational control and audit requirement.

## Checksum-pinned migration controller and ledger

`scripts/migration-runner.mjs` recomputes the checksums of 0002–0004 and requires exact matches in the 7.27 execution plan. It then verifies a PostgreSQL 17 target, the exact 0001 four-table baseline, absence of future migration objects, `pgcrypto`, and RLS on all four baseline tables. Default mode is dry-run only.

Production execution is deliberately blocked unless all of the following are separately supplied by the approved operator: `--execute`, `STAKEMATE_MIGRATION_TARGET=production`, `STAKEMATE_MIGRATION_EXECUTION_APPROVED=true`, and `STAKEMATE_MIGRATION_SECOND_CONFIRMATION=APPLY_0002_0003_0004`. These values are execution controls, not a substitute for the user's approval.

On an authorized execution the runner creates the neutral control table `schema_migrations` only after verifying a pristine 0001 target, applies 0002–0004 in one database transaction, and records only those three completed migration IDs plus their checksums. It never backfills or claims 0001 was ledger-managed. If a ledger already exists, it stops for manual reconciliation instead of rerunning DDL. A failure rolls back the whole transaction, including the ledger creation. The control table intentionally does not use the `stakemate_` prefix, so exactly ten application tables remain expected.

## Proposed grant and function posture

After schema verification, separately review this proposal:

```sql
REVOKE ALL PRIVILEGES ON TABLE
  stakemate_profiles, stakemate_auth_nonces, stakemate_sessions,
  stakemate_invitations, stakemate_invitation_idempotency,
  stakemate_result_evidence, stakemate_settlement_decisions,
  stakemate_settlement_control, stakemate_settlement_jobs,
  stakemate_settlement_audit
FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION stakemate_guard_invitation_commitment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION stakemate_reject_settlement_history_mutation() FROM PUBLIC, anon, authenticated;
```

The current migrations create no application sequences. UUIDs are supplied by application code or `pgcrypto`; verify no unexpected sequences in the post-check. Review current default privileges before adding any `ALTER DEFAULT PRIVILEGES`: they are owner-specific and a broad change can affect unrelated `public` objects. `service_role` is intentionally excluded pending a complete consumer inventory. The server owner retains access through ownership/non-forced RLS; browser code has no direct Supabase client or credential.

## Verification, stop conditions, and recovery

Post-migration read-only checks must establish: ten StakeMate tables; RLS enabled on all ten; four application triggers; the two guard functions; expected constraints/indexes; core and accepted commitment checks; idempotency uniqueness; append-only evidence/decision/audit protections; settlement job uniqueness/control row; no `anon`/`authenticated` table or function privileges after separately approved revocation; unchanged baseline row counts; and application read-only health.

Stop immediately for backup checksum/decryption/list failure, checksum drift, target/version/baseline mismatch, unexpected ledger, missing `pgcrypto`, any SQL failure, absent expected object, RLS/grant mismatch, browser-role access, or failed server health. Do not automatically restore over Supabase. Escalate to the named recovery owner, preserve logs and the failed state, stop app writers, and use the confirmed manual recovery plan. A manual backup restores only data present at its snapshot and cannot recover later writes.
