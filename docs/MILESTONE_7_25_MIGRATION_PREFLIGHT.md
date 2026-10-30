# Milestone 7.25 production migration preflight

Snapshot date: 2026-10-29. This review used only PostgreSQL catalog metadata, approximate table statistics, and an effective `SET LOCAL ROLE anon` visibility check. It did not export application rows or modify Supabase.

## Production status and compatibility

Production contains only the four `0001` tables: profiles, auth nonces, sessions, and invitations. It has the original 0001 columns, constraints, and indexes; invitations have approximately zero rows. No 0002 wallet/deadline fields, 0003 canonical commitment/idempotency objects, or 0004 evidence/settlement objects, triggers, or functions are present. No migration-named tables were found. `pgcrypto` is installed, satisfying `gen_random_uuid()` used by 0004.

The required order is strictly `0001` (already present), then `0002`, then `0003`, then `0004`:

1. 0002 adds invitation wallet snapshots, hashes, deadlines, constraints, and pending-duel indexes.
2. 0003 depends on those fields to add canonical evidence, accepted Move commitment, idempotency table, RLS enablement, and immutable-transition trigger.
3. 0004 depends on canonical invitations and `pgcrypto` to add append-only result/decision/audit records and durable settlement jobs.

All three are non-idempotent DDL. The isolated PostgreSQL 17 suite has applied the full sequence successfully. Production compatibility is structurally ready, subject to the approval checklist below.

## RLS and grant posture

RLS is enabled and not forced on all four existing tables; no policies exist. A read-only `anon` role test returned zero rows from every StakeMate table. The server’s owner role bypasses non-forced RLS, which is acceptable only while database credentials remain server-only.

However, `anon`, `authenticated`, and `service_role` currently have broad table privileges on all four tables. RLS currently prevents browser reads/writes only because there are no policies. Proposed, not executed, revocation SQL after all migrations:

```sql
REVOKE ALL PRIVILEGES ON TABLE
  stakemate_profiles,
  stakemate_auth_nonces,
  stakemate_sessions,
  stakemate_invitations,
  stakemate_invitation_idempotency,
  stakemate_result_evidence,
  stakemate_settlement_decisions,
  stakemate_settlement_control,
  stakemate_settlement_jobs,
  stakemate_settlement_audit
FROM anon, authenticated;
```

Do not revoke `service_role` without confirming every operational service that uses it. The current server uses the owner-role connection rather than a browser credential. The disposable integration test verifies an equivalent revocation leaves browser-role SELECT/INSERT unavailable while owner-role server access remains available. No client-side code is configured with a Supabase URL/key or direct database access.

## Backup, recovery, and stop conditions

This historical catalog review could not verify provider backup/PITR status. The current confirmed operating condition is a Supabase Free-plan project without managed scheduled backups. Production execution therefore requires a newly created, encrypted, checksum/decryption/`pg_restore --list`-verified manual backup and explicit acceptance by the named recovery owner that writes after that snapshot are not recoverable from it. Do not imply provider PITR exists.

Before execution: capture this catalog snapshot plus migration SHA-256 checksums; record approximate invitation count and legacy-row handling; verify the manual recovery plan; schedule a maintenance window; and use a restricted migration connection. Use only `scripts/migration-runner.mjs --execute` with its four explicit execution controls; do not apply individual files manually. Stop immediately on any SQL error, unexpected existing object, constraint/index count mismatch, RLS/policy mismatch, failed browser-role denial, or failed server health check.

Before canonical rows are created, a reviewed reverse-order DDL rollback is possible. After canonical evidence or settlement audit rows exist, do not drop evidence-bearing columns or append-only tables; use a validated manual-backup recovery process or a reviewed forward repair migration. Never automatically restore over live Supabase.

## Two-wallet off-chain invitation pilot

The pilot remains a design until a separate activation approval. Use two pre-enrolled Testnet wallets controlled by named humans, with each user authenticating their own Slush session. The creator uses a fresh eligible TIMED fixture; server revalidates provider fixture ID, competition, teams, kickoff, and freshness immediately before create. The server resolves the recipient handle to its verified wallet snapshot; self-wallets are rejected.

The server creates canonical v2 core terms with 10 or 15 minute expiry and a hashed idempotency key. The recipient must authenticate as the exact snapshotted wallet; acceptance runs a database-time compare-and-set and atomically commits the accepted challenge terms plus separate 15-minute funding deadline. Replays, duplicate create/accept, expired acceptance, altered wallet, fixture change, and altered terms fail closed.

The pilot boundary is strictly off-chain: feature gates keep create/response endpoints locked until explicitly enabled; no SUI transaction is built for signing, no funding status changes to funded, no settlement job is created, and no Walrus write occurs. Capture only sanitized lifecycle/audit identifiers and stop on provider uncertainty or authorization mismatch.
