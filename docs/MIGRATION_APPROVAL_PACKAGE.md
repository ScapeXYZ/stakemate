# Supabase migration approval package

This package is for a separate approval meeting. It does not authorize any production SQL.

## Preflight stop conditions

Stop before execution if the connected database is not the intended project, the current schema differs from the recorded `0001` baseline, unexpected invitation rows exist, RLS is disabled or policies have appeared without review, the migration role lacks only the intended DDL rights, or the fresh manual encrypted backup cannot be verified. This Free-plan operation has no managed scheduled backup/PITR assurance; the named recovery owner must explicitly accept that the backup cannot recover later writes.

Capture only metadata and row counts: table/column definitions, constraints, indexes, RLS flags, policies, grants, ownership, and migration-file SHA-256 checksums. Do not export nonce messages, session hashes, wallet addresses, or invitation payloads.

## Approved-order proposal

1. Verify the fresh encrypted manual archive, its checksum, decryptability, and PostgreSQL 17 archive listing; record the named recovery owner’s acceptance of the manual-backup-only limitation.
2. Put StakeMate application writes in maintenance mode and retain the preflight metadata snapshot; separately control Dashboard, SQL Editor, CI, integrations, and any holder of privileged credentials.
3. Inject a restricted owner-role direct or verified shared Session-pooler connection through protected environment handling as `STAKEMATE_MIGRATION_DATABASE_URL`.
4. Use only `scripts/migration-runner.mjs --execute` with `STAKEMATE_MIGRATION_TARGET=production`, `STAKEMATE_MIGRATION_EXECUTION_APPROVED=true`, and `STAKEMATE_MIGRATION_SECOND_CONFIRMATION=APPLY_0002_0003_0004`.
5. The runner validates pinned checksums, PostgreSQL 17, `pgcrypto`, the four-table/RLS `0001` baseline, no future objects, and no existing ledger. It creates `schema_migrations`, applies `0002`, `0003`, and `0004`, and records those three hashes in one transaction. Never apply individual files manually.
6. Keep all invitation, funding, settlement, and Walrus gates unset/false. Schema success is not feature activation.

The migrations are non-idempotent. The runner transaction rolls back its migration DDL and ledger creation on an error before commit; it does not make a successful committed schema or later data safe to roll back. Stop on any error—do not manually skip a statement or partially recreate an object.

## Post-migration metadata verification

```sql
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE relname LIKE 'stakemate_%' ORDER BY relname;

SELECT conrelid::regclass, conname FROM pg_constraint
WHERE conrelid::regclass::text LIKE 'stakemate_%' ORDER BY 1, 2;

SELECT tablename, indexname FROM pg_indexes
WHERE schemaname = 'public' AND tablename LIKE 'stakemate_%' ORDER BY 1, 2;

SELECT tablename, policyname FROM pg_policies
WHERE schemaname = 'public' AND tablename LIKE 'stakemate_%';
```

Also run the isolated PostgreSQL adapter suite against the exact migration file checksums. Do not test concurrency against Supabase records.

Also verify `schema_migrations` has exactly `0002`, `0003`, and `0004` with their pinned hashes; ten StakeMate tables have RLS; four application triggers and the required guard functions exist; canonical/idempotency and append-only constraints are present; and the original four-table row counts match the final backup snapshot.

## Grants and RLS

RLS enabled with no policies denies rows to `anon` and `authenticated` despite their current broad table grants; the owner/server role bypasses non-forced RLS. This is adequate only while the database URL remains server-only. A future least-privilege migration should be reviewed separately, for example revoking all table privileges from `anon` and `authenticated` on each `stakemate_*` table and granting only narrowly needed server-role privileges. Do not execute that revocation until Supabase auth/session dependencies and deployment role behavior are reviewed.

## Recovery

If failure occurs before canonical rows exist, use a reviewed reverse-order DDL rollback only when the failure is fully understood. The verified encrypted backup may be decrypted and restored only into a new localhost-only PostgreSQL 17 recovery database with `pg_restore --no-owner --no-privileges`; never automatically restore over live Supabase. Once canonical evidence exists, never drop it as rollback; use a reviewed forward repair migration or a separately authorized, validated manual recovery procedure.
