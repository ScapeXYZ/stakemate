# Wallet-linked usernames and invitations

## Current status

The wallet-authentication protocol, canonical invitation terms, lifecycle rules, and Supabase-compatible PostgreSQL adapter are implemented. Migration `0001` has been applied. A read-only probe verified that the configured server-side role can access all four RLS-enabled `stakemate_*` tables. There is no browser database connection and no in-memory production fallback.

Invitation acceptance is an off-chain acknowledgement only. Its `fundingStatus` is always `not_funded`; it must never be presented as a funded escrow until a separately verified Sui transaction exists.

## Milestone 7.12 lifecycle readiness (not activated)

No live Create/Send Invitation or Accept control is enabled. The response endpoint is deliberately locked (`423`) pending licensing, independently reviewed result verification, and an explicit activation decision. There is no invitation-create endpoint. Sui signing, escrow funding/creation, settlement, Move deployment, and Walrus writes remain outside this milestone.

The future server boundary is `InvitationLifecycleService`. It accepts only an authenticated creator wallet plus a server-resolved recipient profile, snapshots both profile wallets in one database insert, and binds a required 64-character SHA-256 `duelTermsHash` from the immutable, versioned 1X2 draft. It rejects self-invites, profile/wallet changes, stale or changed fixtures, replayed acknowledgement, expiry, and duplicate pending sends of the same creator/recipient/duel hash. A recipient acknowledgement checks that the current authenticated wallet matches both the profile and the invitation's recipient-wallet snapshot. It remains `not_funded`.

Creation and acceptance re-fetch/revalidate the exact sports fixture; provider, fixture ID, teams, league, kickoff and eligible status must remain unchanged and kickoff must still be future. The provider adapter must be read-only and must not persist live fixture data. A conditional database update remains the final concurrency authority after revalidation.

Invitation expiry is exactly 10 or 15 minutes from PostgreSQL `clock_timestamp()`. On an accepted acknowledgement, PostgreSQL assigns `funding_deadline_at = clock_timestamp() + 15 minutes`, requiring it to be strictly before the immutable outcome deadline. This stored deadline, not a browser value, is the future escrow input. The user interface can show received, sent, accepted, expired, cancelled, and rejected records but exposes no active accept/send action.

### Required migration

Apply `db/migrations/0002_invitation_lifecycle_readiness.sql` after `0001`. It adds duel-hash, creator/recipient/accepting wallet snapshots, outcome and funding deadline fields, integrity checks, and a partial unique index for a pending creator/recipient/duel-hash tuple. The new fields are nullable solely for honest deployment alongside historical rows; legacy rows are not eligible for future lifecycle actions because no authentic draft hash can be reconstructed.

The test-only `InvitationLifecycleHarness` and `SyntheticFixtureRegistry` use only in-memory profiles and synthetic fixtures. They have no route import, no network client, and no production persistence. Its deterministic tests race duplicate create and accept calls, then cover reject, cancel, expiry, replay, changed wallet, and changed fixture.

### Contract compatibility and activation blockers

The published Move package (Testnet version 1) accepts a 32-byte terms hash plus creator/opponent, stake, funding/outcome deadlines, and independent outcome authority. It does not know invitation IDs, draft version, recipient-handle verification, or off-chain acknowledgement; activation must prove that the persisted `duelTermsHash` bytes are passed unchanged and that the post-acceptance stored deadline is converted to milliseconds without rounding. It also requires creator funding at `create`, so the proposed off-chain acceptance must not be represented as contract acceptance.

Activation remains blocked by sports-data licensing/permission for invitation use, reviewed multi-source final-result verification and dispute/void operations, rate limits and provider availability policy, applied `0002` migration plus a production concurrency test against PostgreSQL, explicit contract package/version and hash-byte encoding verification, operational authorization, and separate approval for any Sui or Walrus write.

## Authentication protocol

1. A connected Sui Testnet address requests a server nonce.
2. The server creates 32 random bytes, binds it to normalized address, origin, `sui:testnet`, and a five-minute UTC expiry, then stores it.
3. The wallet signs the displayed `StakeMate wallet authentication` personal message through dApp Kit. It is not a transaction approval.
4. The server verifies the exact UTF-8 message using `verifyPersonalMessageSignature` from `@mysten/sui/verify`, requiring the claimed address.
5. Only after verification does a transactional compare-and-set mark the nonce consumed. Replays, expired nonces, address/origin changes, and message changes fail.

Production nonce consumption must be one SQL transaction (`UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING *`). Rate-limit nonce and verification endpoints by IP and address, use HTTPS, same-site secure session cookies after verification, and do not place signatures or nonce values in logs.

## Required database configuration and migration

Set `DATABASE_URL` through the host secret manager. The production `InvitationStore` is implemented by `PostgresInvitationStore`; it uses postgres.js with `prepare: false`, bounded connections and no session-dependent features, so it is compatible with Supabase transaction pooling.

Migration `0001` is already applied in the configured project. For a separate new project, review then explicitly apply it with a direct or session-pooler URI (not transaction mode):

```bash
cd ~/stakemate
psql "$MIGRATION_DATABASE_URL" --single-transaction --set ON_ERROR_STOP=1 -f db/migrations/0001_wallet_profiles_and_invitations.sql
```

The migration only creates the `stakemate_profiles`, `stakemate_auth_nonces`, `stakemate_sessions`, and `stakemate_invitations` tables and their indexes. Do not run it against a database with conflicting tables without review.

```sql
CREATE TABLE profiles (id uuid PRIMARY KEY, wallet_address text NOT NULL UNIQUE, username text NOT NULL, username_normalized text NOT NULL UNIQUE, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL);
CREATE TABLE auth_nonces (nonce text PRIMARY KEY, wallet_address text NOT NULL, message text NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz);
CREATE TABLE invitations (id uuid PRIMARY KEY, creator_profile_id uuid NOT NULL REFERENCES profiles(id), recipient_profile_id uuid NOT NULL REFERENCES profiles(id), status text NOT NULL, terms_canonical text NOT NULL, terms_hash text NOT NULL, terms_json jsonb NOT NULL, funding_status text NOT NULL CHECK (funding_status = 'not_funded'), created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, responded_at timestamptz, cancelled_at timestamptz);
CREATE INDEX invitations_recipient_pending ON invitations (recipient_profile_id, status, expires_at);
```

Normalize usernames with Unicode NFC and lowercase before the unique constraint. Enforce profile wallet and recipient identity in the same transaction as every state transition; use conditional updates that require `status = 'pending'` and the intended profile ID.

## Immutable terms and verified events

`canonicalizeInvitationTerms` emits fixed-order, LF-delimited UTF-8 `stakemate.invitation-terms.v1`; SHA-256 is retained with the exact canonical string. It commits to both wallets, stake, UTC deadlines, authority, void rule and either verified sports provider/fixture ID, league, teams, future kickoff, status, market/result sources; or crypto source/instrument, pair/currency, UTC window, threshold, and comparison rule.

Fixture data older than five minutes, fictional/unverified/completed fixtures, self-invitations, expired deadlines, and malformed terms fail. No provider is configured now, so creation and sending are disabled. See `OUTCOME_VERIFICATION.md` for sports draws, price boundaries, correction/dispute, source-outage, and full-principal-refund policy.

Invitation records may only use a server-calculated 10- or 15-minute lifetime, defaulting to 15 minutes. PostgreSQL calculates and persists `created_at` and `expires_at` with `clock_timestamp()` at insertion; browser clocks do not control expiry. Acceptance uses one conditional update requiring `status = 'pending' AND expires_at > clock_timestamp()`, so acceptance at the exact deadline and concurrent duplicate attempts fail safely. Inbox countdowns use the persisted deadline and a database-clock baseline.

A separate 15-minute funding window begins only after acceptance and must fit strictly before the contract outcome deadline. The future escrow creation call must pass that derived deadline to the existing Move contract, which already blocks opponent funding at or after it. Expired, rejected, and cancelled invitations are never fundable; accepted acknowledgement is still `not_funded` until a verified escrow transaction exists.

## Real two-user demonstration prerequisites

1. Set `STAKEMATE_PUBLIC_ORIGIN` to the exact HTTPS origin in production. Production requests fail closed if it is absent or non-HTTPS; development derives the exact origin from the request.
2. Add route-level rate limits and redacted observability.
3. Add licensed/reputable sports and crypto adapters with current source IDs, timestamps, evidence, and outage handling.
4. Use two Testnet wallets: each signs its own auth message and claims a distinct username; the recipient alone accepts. Confirm it remains `not funded`.
5. Obtain separate approval before future escrow signing/funding or Walrus evidence writes.

## Database/runtime verification

The postgres.js adapter uses `max: 1`, `ssl: "require"`, and `prepare: false` for Supabase transaction-pooler compatibility. It performs no session-state operations or prepared statements. Authentication requests perform bounded cleanup of at most 100 expired nonce rows and 100 expired session rows; no profiles or invitations are touched.

The migration creates application-owned tables in `public`; RLS remains enabled. The server-side database role was verified to read all four tables. This does not make browser access possible—the database URI and queries remain server-only.

No real wallet signature has been performed by this environment. A browser-connected Sui Testnet wallet must explicitly approve the displayed personal-message signature before a successful live wallet-authentication claim can be asserted.

## Authentication troubleshooting

The client restores session state by requesting the authenticated profile endpoint whenever the connected wallet changes. A valid session therefore displays **Wallet authenticated** even before a username is claimed; it must not repeatedly show the signature button after a refresh.

Authentication endpoints return sanitized actionable failures: `AUTH_ORIGIN_NOT_ALLOWED`, `AUTH_NONCE_INVALID`, `AUTH_SIGNATURE_INVALID`, or `AUTH_SESSION_FAILED`. Values such as signatures, cookies, nonces, and database errors are never returned. For local use, start the server and open the same origin:

```bash
STAKEMATE_PUBLIC_ORIGIN=http://localhost:3000 npm run dev
```

Use `http://localhost:3000`, not `127.0.0.1`, with that configuration. For production, configure the exact HTTPS origin.
