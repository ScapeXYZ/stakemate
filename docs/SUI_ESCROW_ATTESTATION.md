# Sui escrow attestation and activation boundary

Status: verified source/bytecode correspondence on Sui Testnet; not approved for live use.

## Attestation performed

On 2026-10-29, the Sui CLI 1.83.0 `verify-source` command successfully rebuilt `contracts/stakemate` and matched it against Testnet package `0x3ad668c9afb9fe8540c9a3567aaee1e637f6392d414be3611f137658ef238392`. The package is immutable, version `1`, and the successful publication transaction is `7WoZafsGnmWtqX91PHwX3vBAyMfU9bXQG9iNU7AEEDVf`.

The reviewed source and the build artifact source copy share SHA-256 `be28fd801dc29d951780a2e767077a3f68ea91e36cfbb8b62cac33352d046e99`. Move unit tests passed 24/24. The publication also created UpgradeCap `0x909941dc65e187db79090695fbba2bebcf678ffc73957f099720d945e1574ec7`; its holder could publish a later package version. Activation must pin the versioned package ID and separately govern that capability.

## Verified interface and custody model

`create(opponent, Coin<SUI>, vector<u8>, u64, u64, address, &Clock, &mut TxContext)` takes the creator's exact `Coin<SUI>`, requires a 32-byte terms digest, and shares a `Challenge`. It stores creator, opponent, stake MIST, digest, millisecond deadlines, and immutable outcome authority. The creator's coin is held in `creator_funding`.

`accept_and_fund(&mut Challenge, Coin<SUI>, &Clock, &TxContext)` accepts only the stored opponent, before the funding deadline, with a coin whose value exactly equals `stake_mist`. It consumes that coin into `opponent_funding` and moves the shared object from CREATED to FUNDED. Sui's linear coin/object model prevents reusing that same coin object in a second successful transaction; the state transition prevents a second acceptance.

Before funding, only the creator can call `cancel_unfunded`; after the funding deadline anyone can call `refund_expired_funding`, but both transfer funds only to the immutable creator. After funding, `submit_outcome` accepts only the immutable authority before the outcome deadline. Outcome `1` pays the combined balance to creator, `2` pays it to opponent, and `0` refunds each exact stake. After the outcome deadline, anyone can call `void_unreported_outcome`, which refunds both fixed participants. Terminal state prevents a second payout or refund.

## Funding confirmation design

Future server processing must start from the exact accepted `stakemate.challenge-terms.v1` digest and its byte vector—not a browser-provided digest. It must:

1. construct but not yet submit `create` with creator/opponent snapshots, exact integer MIST, accepted digest bytes, and millisecond deadlines;
2. after a separately enabled creator signature, read the created shared `Challenge` and `ChallengeCreated` event, then compare every stored field and the published transaction digest;
3. after a separately enabled opponent signature, read the object and `ChallengeFunded` event and require FUNDED state, the same challenge ID, same terms hash, fixed participants, and exact stake before setting `funding_confirmed_at`;
4. enqueue settlement only after that read-only confirmation. A merely prepared transaction or an unconfirmed event must never mark funding complete.

One-sided funding is not a locked loss: before expiry the creator may cancel; at or after funding expiry any caller may trigger the creator-only refund. There is no contract-level deduplication of two *separately created* challenges with the same terms hash; server idempotency, unique canonical invitations, and object/event reconciliation remain required to prevent duplicate product-level challenges.

The Move package checks only that the supplied digest is 32 bytes; it cannot recompute football terms from that digest. It binds the submitted bytes permanently, but server-side canonical serialization and post-creation object comparison are the protection against submitting a different valid 32-byte value.

## Settlement authority and trust assumption

The settlement operator needs only control of the exact immutable `outcome_authority` address plus enough SUI for gas. It does not need either participant's key or escrow funds. It should be a dedicated managed signer with a transaction allowlist restricted to the pinned `submit_outcome` target, matching shared challenge object, fixed package ID, and outcome deadline; separate gas budgets; audit logs; monitoring; and emergency key revocation. The database emergency pause must block job acquisition before signing. AI agents receive neither signer material nor authority to change evidence, decisions, or pause state.

The contract does **not** verify football results or evidence. A compromised outcome authority can submit any syntactically valid `0`, `1`, or `2` before the deadline, including an incorrect outcome, and the contract will honor it. The durable verifier, correction window, operational controls, and key custody reduce this risk but cannot remove this trusted-operator assumption. A future contract that verifies a decentralized/oracle attestation would require redeployment.

## Activation blockers

Production remains blocked pending approval and application of migrations 0002–0004, approved invitation/funding activation, funded-object/event confirmation implementation, licensed independent result evidence, a reviewed signer and broadcast/reconciliation runbook, UpgradeCap governance, and explicit authorization to enable execution. No signer, broadcaster, scheduler, funding route, or settlement route is enabled by this milestone.
