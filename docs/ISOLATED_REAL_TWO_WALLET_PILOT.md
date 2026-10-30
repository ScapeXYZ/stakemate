# Isolated real two-wallet Testnet invitation pilot

This runbook is for personal-message wallet authentication and off-chain
invitation records only. It does not authorize a Sui transaction, funding,
settlement, or Walrus write.

## Preconditions

- The localhost-only PostgreSQL 17 container is healthy on `127.0.0.1:55435`.
- Use the two public Testnet wallets controlled by the pilot operator, one per
  browser profile. Do not use production browser profiles, cookies, or sessions.
- Obtain a separate public Testnet outcome-authority address. No authority key
  is loaded or used in this pilot.
- Inject `FOOTBALL_DATA_API_TOKEN` from an approved local secret source. Do
  not copy a token from a production environment into a file or command line.

## Start the isolated server

Create a local, ignored pilot environment from
`.env.isolated-two-wallet-pilot.example`, fill only the public outcome authority,
and inject the football token through your secret manager. Start the server with
that file's values as process environment variables. Ensure its `DATABASE_URL`
is exactly the localhost value above, its lifecycle flags are `true`, and its
maintenance freeze is `false` **only in this local process**. The deployed
environment must retain `STAKEMATE_MAINTENANCE_WRITE_FREEZE=true` and both
lifecycle flags unset/false.

With the token already injected into the current shell by the approved local
secret mechanism, the exact localhost start command is:

```bash
set -a
. ./.env.isolated-two-wallet-pilot
set +a
: "${FOOTBALL_DATA_API_TOKEN:?Inject the provider token through the local secret mechanism first}"
npm run dev
```

To run the isolated pilot on port 3001, use this final command instead of the
last line above:

```bash
PORT=3001 STAKEMATE_PUBLIC_ORIGIN=http://localhost:3001 npm run dev
```

Before opening a wallet, confirm these local-only invariants from a separate
terminal (never print the URL or token):

```bash
node --env-file=.env.isolated-two-wallet-pilot -e '
const u = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(u.hostname)) throw new Error("non-local database refused");
if (process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE !== "false") throw new Error("pilot writes remain frozen");
if (process.env.STAKEMATE_INVITATION_LIFECYCLE_ENABLED !== "true" || process.env.STAKEMATE_CANONICAL_INVITATIONS_ENABLED !== "true") throw new Error("pilot lifecycle not enabled");
console.log("isolated pilot configuration verified");
'
```

## Manual Slush authentication and lifecycle

1. Open `http://localhost:3001` in two isolated browser profiles (or normal and
   private windows). Connect the first profile to the Testnet wallet for
   `@temitope`, and the second to `@Virus`.
2. In each profile, select **Authenticate wallet**. Inspect the readable
   StakeMate personal-message authentication prompt and approve it only if the
   displayed origin is the local pilot origin. This is not a transaction.
3. Claim `temitope` and `Virus` handles in the isolated database. If a previous
   disposable run already used either handle, reset only the disposable Docker
   service before retrying; never alter a shared database.
4. As `@temitope`, choose an eligible `TIMED` football-data.org fixture, set
   distinct Home/Draw/Away selections, an exact positive SUI stake, and send.
   The server re-reads fixture ID, teams, kickoff, and status before it inserts.
5. As `@Virus`, refresh the inbox, inspect the read-only canonical commitment,
   then select **Accept** or **Reject**. Acceptance revalidates the committed
   fixture again and creates no funding request.
6. Capture the read-only `/invite/<id>` evidence in both browser profiles.
   Confirm identical core hash; for acceptance also confirm accepted challenge
   hash, recipient snapshot, and separate funding deadline.
7. For idempotency, use browser retry/reload only after a response is received;
   the same idempotency key must return the recorded result. Do not manufacture
   duplicate browser requests with different keys against a real pilot record.
8. Let a separate invitation expire naturally, then verify that acceptance is
   refused. Do not change database timestamps in this real-wallet pilot.

Stop immediately if the fixture changes, provider revalidation fails, a wallet
changes, a gate is unexpectedly enabled outside localhost, or any UI asks for
a transaction signature. Do not proceed to funding.

## Optional Claude Desktop pairing

This is separate from the invitation lifecycle and remains read/preview-only.
Apply `db/isolated-pilot/0005_mcp_authorizations.sql` only to the disposable
PostgreSQL pilot database, enable the local broker variables from the pilot
environment example, then follow [Claude Desktop MCP setup](CLAUDE_DESKTOP_MCP.md).
Chrome `@temitope` and Opera `@virus` must create and consume different
one-time pairing codes and distinct local slots. Do not pair either browser
with the other wallet’s code.
