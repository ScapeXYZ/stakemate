# Canonical football 1X2 duel terms (v2)

This is the authoritative terms specification for preview-only football 1X2 duels. It replaces the preview's former independently serialized draft hash. No invitation, transaction, signing, funding, settlement, or Walrus operation is enabled by this document or its implementation.

## Two honest lifecycle commitments

A preview cannot commit to an exact funding deadline before a recipient has accepted it. Pretending otherwise would bind a guessed deadline, not the eventual challenge. The protocol therefore has two named, deterministic commitments over one schema:

1. **Draft core** — fixed at preview creation and stored as the 64 lowercase hex `duel_terms_hash` when invitations are eventually enabled.
2. **Accepted Move challenge** — extends that exact core only after server-authoritative acceptance assigns the invitation expiry, the 15-minute funding deadline, the outcome deadline, and the independent outcome authority. Its digest is `0x` plus 64 lowercase hex characters and is the only digest passed as the contract's 32-byte `vector<u8>`.

The second commitment does not replace or reinterpret the first. It includes the full canonical core verbatim. A future activated persistence boundary must store both canonical preimages and both digests, recompute them server-side, and reject any mismatch before transaction construction. The existing inactive `0002` schema has only `duel_terms_hash`, so it is not by itself sufficient for activation.

## Draft-core UTF-8 preimage

All rows use LF, include a final LF, and are SHA-256 hashed as UTF-8 bytes. Addresses are normalized lowercase 32-byte Sui addresses. Text is NFC-normalized, trimmed, nonempty, and cannot contain CR, LF, or `=`. Timestamps are exact `YYYY-MM-DDTHH:mm:ss.sssZ` UTC strings. `stakeMist` is a positive base-10 integer; no SUI float is serialized.

```text
stakemate.football-1x2-duel.v2
provider=<football-data.org/v4>
competitionCode=<PL|PD|CL>
competitionName=<text>
fixtureId=<provider fixture ID>
homeTeamId=<provider team ID>
homeTeam=<text>
awayTeamId=<provider team ID>
awayTeam=<text>
kickoffUtc=<UTC timestamp>
creatorAddress=<Sui address>
opponentAddress=<Sui address>
market=1X2
creatorSelection=<home_win|draw|away_win>
opponentSelection=<different 1X2 selection>
unselectedOutcome=<the remaining 1X2 selection>
stakeMist=<positive integer>
invitationLifetimeMinutes=<10|15>
voidRule=full_principal_refund_for_unselected_outcome_or_provider_failure
```

The fixture ID, competition, kickoff, both wallet addresses, explicit selections, exact MIST stake, 10/15-minute invitation policy, and void/refund semantics are fixed here. Usernames, retrieval timestamps, display strings such as total pot, and unassigned future deadlines are intentionally not part of the core.

## Accepted Move challenge UTF-8 preimage

The accepted preimage begins with `stakemate.challenge-terms.v1`, followed by every draft-core row above (including its v2 header), then:

```text
invitationExpiresAtUtc=<server creation time + 10 or 15 minutes>
fundingDeadlineUtc=<server acceptance time + 15 minutes>
outcomeDeadlineUtc=<server-approved UTC timestamp>
outcomeAuthority=<independent Sui address>
```

Deadlines must strictly increase: invitation expiry `<` funding deadline `<` outcome deadline. The transaction adapter converts the latter two timestamps using `Date.parse` directly to integer Unix **milliseconds**, matching `Clock.timestamp_ms`. SHA-256 bytes are decoded from the `0x` digest as 32 bytes in order and passed to Move as `vector<u8>`; no text, hex prefix, or endian conversion is passed to Move.

Deterministic vector: `tests/football-duel-terms.test.ts` uses fixture `42`, 100,000,000 MIST, fixed addresses `0x11…11`, `0x22…22`, and `0x33…33`; its accepted preimage hashes to `0x913b839bc9f0c1058a6e003c292ac7afeffd5cedcd2589e3c9cbccfc49cc7285`.

## Move mapping and limits

`challenge_escrow::create` can commit the accepted digest and separately binds creator (transaction sender), opponent, exact `Coin<SUI>` value in MIST, millisecond funding/outcome deadlines, and authority. It rejects self-participants, a participant authority, a non-32-byte digest, and invalid deadlines. It supports outcome `1` creator win, `2` opponent win, and `0` void/refund; after outcome timeout it refunds both exact stakes.

The contract does **not** parse football fields, know invitation IDs, verify provider results, enforce recipient-handle resolution, or prove an off-chain acceptance. Those remain server-side activation requirements. The deployed package/source correspondence is not independently bytecode-attested here; it must be reverified before writes.

## Migration execution and rollback plan

1. Make a fresh read-only schema/ownership/RLS/grant snapshot and verify `0001` objects match the dependency assumptions.
2. In a disposable PostgreSQL database, apply `0001`, then `0002`, and run the PostgreSQL concurrency suite: duplicate pending create, concurrent accept, expiry-at-boundary, replay, wallet mismatch, and post-acceptance funding deadline.
3. Review a follow-on migration before activation to persist the core and accepted canonical preimages plus a `char(66)` Move digest (or equivalent immutable evidence). Do not infer an accepted digest from a core digest.
4. Back up the schema and affected rows, take a maintenance window, apply `0002` once in a single transaction, verify constraints/indexes, then deploy only the still-disabled code. No migration was applied in this milestone.

`0002` is non-idempotent and has no safe unconditional down migration. If it must be rolled back before any lifecycle rows exist, explicitly drop its three indexes, four named constraints, and six added columns in a reviewed transaction. Once rows rely on those columns, restore from backup or apply a forward repair migration; dropping columns would destroy evidence. RLS is enabled on the live four tables with no policies. That is appropriate only while the owner/server role is the sole database client: owners bypass non-forced RLS. Browser roles must receive neither the database URL nor table grants; a non-owner server role would need explicit least-privilege RLS policies.
