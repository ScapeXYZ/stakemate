# Milestone 7.19 Supabase read-only review

Snapshot date: 2026-10-29. This was a catalog-only query: no profile, nonce, session, or invitation payload was exported.

## Production drift

The connected Supabase schema matches `0001` only. It has the four original tables and `0001` indexes/constraints; `0002` wallet/deadline/hash fields and indexes are absent, and every `0003` column, trigger, index, and idempotency table is absent. Approximate statistics report one profile, one nonce, one session, and zero invitations. No Supabase migration ledger table is present.

RLS is enabled and not forced on all four tables. There are no policies. Supabase grants broad table privileges to `anon`, `authenticated`, and `service_role`; this is a configuration concern, but the read-only `SET LOCAL ROLE anon` check returned zero rows from every StakeMate table because no RLS policy permits them. Browser clients must never receive the database URL or a service-role credential. The server owner role bypasses non-forced RLS, which is the intended current server-only access model.

## Application plan

1. Capture a new catalog snapshot, row counts, role grants, RLS state, and migration checksum immediately before work. Confirm invitations remain empty or explicitly record legacy handling.
2. Take a provider-managed point-in-time-recovery/checkpoint backup and retain the exact migration files and their checksums. Schedule a maintenance window and use a restricted migration role.
3. Apply `0002`, verify its six columns, four constraints, and three indexes, then apply `0003` in a single reviewed transaction. Verify RLS is enabled on all five tables and that no policies were introduced.
4. Deploy the adapter only with `STAKEMATE_CANONICAL_INVITATIONS_ENABLED` absent/false. The API response endpoint remains locked at HTTP 423 and no creation route exists.
5. If migration verification fails before any canonical rows are created, restore the database backup or use a reviewed reverse-order DDL rollback. Once rows contain canonical evidence, do not drop `0002`/`0003` columns; recover through backup/PITR or a forward repair migration.

`0002` and `0003` are non-idempotent and require this separate production approval. No Supabase migration was applied for this review.

## Gated persistence adapter

`CanonicalInvitationPersistenceAdapter` is a server-path, Node-only PostgreSQL adapter with no API route or AI-tool exposure. It is disabled unless `STAKEMATE_CANONICAL_INVITATIONS_ENABLED=true`; its integration test uses a separate explicit test-only constructor override. It creates the core commitment and snapshots atomically, then writes the accepted Move preimage/digest, recipient wallet, and 15-minute funding deadline atomically under a database-time, row-lock compare-and-set. Idempotency keys and request fingerprints are SHA-256 hashed before storage. Legacy rows without a core commitment are rejected for any active transition.
