# Disposable PostgreSQL integration testing

The integration database is deliberately opt-in and never uses `DATABASE_URL`. It is a blank local PostgreSQL 17 instance that initializes `0001` through `0004` through Docker's init directory. Do not point its test URL at Supabase or any shared environment.

After approving image download/service startup, run:

```bash
docker compose -f docker-compose.postgres-test.yml up --wait
STAKEMATE_POSTGRES_INTEGRATION_DISPOSABLE=1 STAKEMATE_TEST_DATABASE_URL='postgres://stakemate_test:stakemate_test_only@127.0.0.1:55432/stakemate_integration' npm run test:postgres
docker compose -f docker-compose.postgres-test.yml down --volumes
```

The test suite refuses to run unless the disposable marker is exactly `1` and the URL targets localhost. It verifies concurrent compare-and-set acceptance, duplicate idempotency-key protection, accepted-evidence immutability, constraint rejection, and transaction rollback. It does not sign, fund, settle, or contact any external service.

`0003` must be applied only after a fresh production schema/role/RLS/grant snapshot and a successful run of this isolated suite. Historical rows are left with NULL canonical fields and are read-only legacy records: the trigger prevents them from entering a new accepted state. Its down path is intentionally not automatic: canonical evidence must not be dropped after rows exist. Before any canonical rows exist, a reviewed rollback may drop the trigger/function, idempotency table/indexes, `0003` indexes/constraints, and added columns in reverse dependency order.

## Transaction model

Creation expires an identical pending row, reserves `(actor wallet, operation, key hash)` and inserts the invitation/core in one transaction. Same-key retries return the recorded result only when the request fingerprint matches; a different fingerprint is a replay error. Acceptance, rejection, cancellation, and expiry use one conditional `UPDATE` with `clock_timestamp()` and the expected current status. A concurrent caller updates zero rows and receives the persisted outcome; it never replays an action. Acceptance atomically binds the recipient-wallet snapshot, writes the accepted Move preimage/digest, and sets `accepted_at + 15 minutes` as the funding deadline. It is an off-chain acknowledgement only.
