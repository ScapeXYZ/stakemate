# Milestone 7.13 audit — 2026-10-29

## PostgreSQL status

No migration was applied. The configured Supabase pooler rejected the read-only audit connection with PostgreSQL `28P01` (password authentication failed). Therefore the actual columns, indexes, constraints, table ownership, RLS state/policies, migration history, and real database concurrency results are **unverified**. No retry attempts with altered credentials were made.

The checked-in baseline has a material review item: migration `0001` creates the four application tables but does not enable RLS or create policies. Earlier documentation says RLS is enabled, so that claim must be proved from the live schema rather than inferred from source. `0002` is non-idempotent: it will fail if any named column, constraint, or index already exists. It is also intentionally nullable for historical rows, so application code—not the schema alone—must keep legacy rows out of future activation.

### Reviewed, explicit plan (do not run until credentials and approval are supplied)

1. Connect with a least-privileged migration role through a direct/session pooler endpoint; begin `READ ONLY` and record `information_schema.columns`, `pg_constraint`, `pg_indexes`, `pg_class.relrowsecurity`, `pg_policies`, grants, row counts, and any migration ledger.
2. Compare those results against `0001` and `0002`, particularly all six new `0002` columns; named checks; the duplicate creator index; and the partial unique pending-duel index. Stop if any objects conflict—do not use `IF NOT EXISTS` to conceal a semantic mismatch.
3. Review historical invitation rows. Do not backfill a fabricated duel hash. Verify nullable checks accept legacy data and that application activation rejects it.
4. Review RLS. Browser roles must have no direct access to profiles, sessions, nonces, or invitations. The server migration role needs only the commands exercised by the adapter. Add reviewed RLS DDL in a separate migration only after the actual current policy state is known.
5. Apply `0002` exactly once in a maintenance window using `psql --single-transaction --set ON_ERROR_STOP=1`, then re-run the read-only audit and adapter access probe.
6. Before activation, run the rollback-only concurrency suite below on an isolated database/schema with the real migration role. Never use production invitation rows.

### Required real PostgreSQL rollback-only concurrency suite

Seed two profiles and one synthetic, future fixture invitation inside a transaction; execute each race through two independent connections; assert results; then roll back both connections and the seed transaction. Cover: same creator/recipient/duel hash duplicate create (one insert; unique violation on the other), concurrent acceptance (one conditional update), exact `expires_at` acceptance (zero rows and expired transition), replay after acceptance (zero rows), recipient wallet mismatch (zero rows), and acceptance where `now + 15 minutes >= outcome_deadline_at` (zero rows). This suite could not run because the configured database rejected authentication.

## Sui Testnet contract audit

A read-only authenticated Tatum gRPC probe confirmed Testnet chain identifier `69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD`, package `0x3ad668c9afb9fe8540c9a3567aaee1e637f6392d414be3611f137658ef238392`, package type, `challenge_escrow` module, and successful publish transaction `7WoZafsGnmWtqX91PHwX3vBAyMfU9bXQG9iNU7AEEDVf`. It did not download/verify on-chain module bytecode against the local source; source/package equivalence remains an activation blocker.

Local Move source and unsigned transaction code agree on:

- stake as exact `u64` MIST, with no float conversion;
- a 32-byte `vector<u8>` terms hash;
- millisecond deadlines (`clock::timestamp_ms` and `u64` arguments), strict `<` for create/funding/outcome and `>=` for timeout refund;
- immutable sender-derived creator, explicit opponent address, and independent authority;
- `0` void/refund, `1` creator win, `2` opponent win.

There is one blocking encoding mismatch: preview drafts use `hashDuelDraftTerms`, an unprefixed SHA-256 hex digest of `stakemate.football-duel-draft.v1`; the present unsigned Move adapter accepts only `0x`-prefixed SHA-256 bytes from a different `stakemate.challenge-terms.v1` canonical format. The invitation’s stored `duelTermsHash` therefore cannot currently be passed unchanged to `create`. No conversion or contract change is proposed or made here. A reviewed binding specification and test vectors must decide whether the Move hash commits to the complete duel terms, how deadline fields enter the canonical bytes, and whether the stored digest gets a `0x` transport representation without changing its bytes.

Off-chain acknowledgement cannot call Move: the inactive lifecycle code only changes invitation state; `create` requires a `Coin<SUI>` and transaction sender, and `accept_and_fund` requires the opponent's exact `Coin<SUI>`. Signing/execution remains disabled.

## Provider reliability

The football adapter now deduplicates in-flight identical upcoming-fixture and exact-fixture revalidation requests. Upcoming cache remains 45 seconds; exact-fixture cache is bounded to 10 seconds and is rejected if kickoff has passed. The server retains per-process 6.5-second pacing, exposes a bounded `Retry-After` on known rate limits, and the fixture UI displays a retry countdown and disables retry until it ends. No fixture is synthesized and malformed, stale, unavailable, or ineligible data remains fail-closed.
