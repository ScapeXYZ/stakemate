# Milestone 7.27 production migration execution plan

This is an approval package, not an authorization to change Supabase. The 2026-10-29 PostgreSQL 17.11 rehearsal restored the encrypted `0001` backup and applied the following files in order to disposable localhost-only databases.

| File | SHA-256 |
| --- | --- |
| `0002_invitation_lifecycle_readiness.sql` | `446b5c080ee8a0565d12703f5d0d3012ba284ee410c7b90559f72945c63972d1` |
| `0003_canonical_duel_commitments.sql` | `90cc77c8ce010fdca0c8d61efcd27d4bfa02615e476f3c89c0af117d78f3ddb4` |
| `0004_durable_settlement_worker.sql` | `397a6fc671ca9a1348ed3661379d7aaaa9d1cd52f4d637ebd2da7935f7b1535a` |

## Required approvals and preflight

1. Record provider recovery status and the named recovery owner. This Supabase Free-plan project has no managed scheduled backup/PITR assurance available to this operation. The sole recovery owner must explicitly accept the manual-backup-only limitation before execution; do not imply a provider restore point exists.
2. Take a fresh encrypted schema-scoped backup immediately before the maintenance window. Verify its archive checksum, decryptability with the separately protected key, and `pg_restore -l` output before continuing. The existing backup cannot prove that no external production write occurred after it was made.
3. Re-run a read-only catalog snapshot and compare four baseline tables, row counts, constraint names, indexes, ownership, RLS flags, policies, grants, and required `pgcrypto` extension with the approved snapshot.
4. Confirm the three file checksums above, exact order, restricted owner-role migration connection, named operator, maintenance window, application health owner, and a communication/escalation contact.
5. Obtain separate approval for the proposed `anon`/`authenticated` revocation. Do not revoke `service_role` without an inventory of its operational consumers.

## Authoritative execution sequence

`scripts/migration-runner.mjs` is the **only** approved production schema-execution method. It supersedes the older three-command `psql` procedure; do not run individual migration files manually or mix the two approaches.

Use a restricted owner-role **direct connection or verified shared Session-pooler connection**, injected only through protected operator environment handling. Do not use browser credentials or a transaction pooler. The connection string must never appear in shell history, source files, command arguments, or logs.

After the fresh backup and read-only preflight have passed, and only after separate production authorization, set the protected environment values and run:

```sh
STAKEMATE_MIGRATION_TARGET=production \
STAKEMATE_MIGRATION_EXECUTION_APPROVED=true \
STAKEMATE_MIGRATION_SECOND_CONFIRMATION=APPLY_0002_0003_0004 \
node scripts/migration-runner.mjs --execute
```

`STAKEMATE_MIGRATION_DATABASE_URL` is required separately in the protected environment. The runner recomputes all three SHA-256 checksums against this plan, verifies PostgreSQL 17, `pgcrypto`, the pristine four-table `0001` baseline, baseline RLS, absence of future tables, and absence of a ledger before it mutates anything. It then creates `schema_migrations`, applies `0002`, `0003`, and `0004` in order, and inserts only those three IDs and checksums in **one database transaction**. A SQL error rolls back the migration DDL and ledger creation together; it does not make a later data rollback safe after a successful commit.

The ledger never backfills or claims that `0001` was ledger-managed. An existing ledger is a hard stop requiring manual reconciliation; never rerun individual files to work around it.

Grant revocation is a separate approval and is not part of this schema runner. Only after schema checks and owner-role health verification, review and separately authorize:

```sql
REVOKE ALL PRIVILEGES ON TABLE
  stakemate_profiles, stakemate_auth_nonces, stakemate_sessions,
  stakemate_invitations, stakemate_invitation_idempotency,
  stakemate_result_evidence, stakemate_settlement_decisions,
  stakemate_settlement_control, stakemate_settlement_jobs,
  stakemate_settlement_audit
FROM anon, authenticated;
```

## Stop conditions and post-migration checks

Stop before the next file, do not retry blindly, and enter recovery review if any DDL error occurs; an expected baseline object differs; the backup cannot be verified; `pgcrypto` is unavailable; a check count differs; RLS/policy/grant posture is unexpected; a browser role can read or write server tables; or owner-role server health fails.

After all files, execute read-only checks for:

- ten `stakemate_*` tables with RLS enabled and no unintended policies;
- canonical core/accepted-commitment constraints, invitation idempotency primary key and indexes;
- four application triggers, including immutable invitation and append-only result/audit protections;
- `stakemate_settlement_control` singleton; durable job/evidence/decision uniqueness constraints;
- zero grants for `anon` and `authenticated` after the separately approved revocation, while the owner-role server retains required access;
- all legacy invitations still readable but unable to transition from pending to accepted without both canonical commitments.

Also verify `schema_migrations` contains exactly `0002`, `0003`, and `0004` with the checksums above, and compare the four baseline-table row counts to the final encrypted-backup snapshot. The runner does not change application feature gates.

Keep all invitation, signing, funding, broadcast, settlement, and Walrus feature gates disabled after schema deployment. Schema application alone is not activation authorization.

## Recovery procedure

Before any canonical/evidence rows are written, stop traffic and use a separately reviewed reverse DDL rollback only if the failure is fully understood. Do not improvise a destructive rollback. Once canonical evidence or append-only settlement records exist, preserve them: recover through the confirmed Supabase PITR/restore workflow or a reviewed forward repair migration, then reconcile against the fresh backup and catalog snapshot.

The verified encrypted backup is a recovery input, not an automatic rollback button: decrypt and restore it only into a new localhost-only PostgreSQL 17 recovery database with `pg_restore --no-owner --no-privileges`, then validate it before any separately authorized recovery operation. It cannot recover writes made after its snapshot and must never be restored over a live Supabase database automatically. The application write freeze covers StakeMate-owned writers only; Dashboard/SQL Editor access, external integrations, leaked owner/service credentials, and provider-side administrative actions require separate operational control. If the manual archive is missing, fails verification, or is too old to meet the recovery owner’s accepted data-loss window, execution is a hard stop.
