import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";
import { toBase64 } from "@mysten/sui/utils";
import { MemoryInvitationStore, canonicalizeInvitationTerms, createInvitationRecord, defaultInvitationLifetimeMinutes, fundingDeadlineFromAcceptance, hashInvitationTerms, invitationExpiryFromCreation, isFundableInvitation } from "../src/lib/server/invitations";
import { createAuthenticationNonce, verifyAuthenticationSignature, WalletAuthenticationError } from "../src/lib/server/wallet-auth";
import { InvitationLifecycleHarness } from "../src/lib/testing/invitation-lifecycle-harness";

const creator = "0x1111111111111111111111111111111111111111111111111111111111111111";
const opponent = "0x2222222222222222222222222222222222222222222222222222222222222222";
const authority = "0x3333333333333333333333333333333333333333333333333333333333333333";
const now = new Date("2030-01-01T00:00:00.000Z");
const duelTermsHash = "a".repeat(64);
function terms() { return { version: "v1" as const, invitationLifetimeMinutes: 15 as const, creatorAddress: creator, recipientAddress: opponent, stakeMist: "100000000", fundingDeadlineUtc: "2030-01-02T00:00:00.000Z", outcomeDeadlineUtc: "2030-01-03T00:00:00.000Z", outcomeAuthority: authority, voidRule: "full_principal_refund" as const, market: { kind: "sports" as const, fixture: { provider: "licensed-provider", fixtureId: "fixture-12", league: "League", homeTeam: "Home", awayTeam: "Away", scheduledKickoffUtc: "2030-01-02T12:00:00.000Z", status: "scheduled" as const, verifiedAtUtc: "2030-01-01T00:00:00.000Z" }, market: "home_win" as const, resultSources: ["licensed-provider"] } }; }

test("usernames are case-insensitively unique", async () => {
  const store = new MemoryInvitationStore();
  await store.claimUsername(creator, "Alice_7", now);
  await assert.rejects(() => store.claimUsername(opponent, "alice_7", now), /USERNAME_TAKEN/);
});

test("concurrent username claims yield exactly one owner", async () => {
  const store = new MemoryInvitationStore();
  const results = await Promise.allSettled([store.claimUsername(creator, "RaceName", now), store.claimUsername(opponent, "racename", now)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("a username is a permanent wallet binding and cannot be renamed or reclaimed", async () => {
  const store = new MemoryInvitationStore();
  const owned = await store.claimUsername(creator, "Virus", now);
  assert.equal(owned.username, "Virus");
  await assert.rejects(() => store.claimUsername(creator, "Temitope", now), /USERNAME_ALREADY_CLAIMED/);
  await assert.rejects(() => store.claimUsername(opponent, "virus", now), /USERNAME_TAKEN/);
  assert.equal((await store.profileForWallet(creator))?.username, "Virus");
});

test("authenticated-handle lookup is case-insensitive and returns only public identity fields", async () => {
  const store = new MemoryInvitationStore(); await store.claimUsername(creator, "Temitope", now);
  assert.deepEqual(await store.profileForUsername("@temitope".slice(1)), { username: "Temitope", walletAddress: creator });
  assert.equal(await store.profileForUsername("missing_handle"), null);
});

test("an invitation record cannot bind a recipient handle to a different wallet", async () => {
  const store = new MemoryInvitationStore(); const a = await store.claimUsername(creator, "Creator", now); const b = await store.claimUsername(opponent, "Opponent", now);
  const mismatched = terms(); mismatched.recipientAddress = authority;
  assert.throws(() => createInvitationRecord(a, b, mismatched, duelTermsHash, now), /wallets must match/);
});

test("only the intended recipient can accept an invitation and acceptance is not funding", async () => {
  const store = new MemoryInvitationStore(); const creatorProfile = await store.claimUsername(creator, "Creator", now); const recipient = await store.claimUsername(opponent, "Opponent", now);
  const record = createInvitationRecord(creatorProfile, recipient, terms(), duelTermsHash, now); await store.createInvitation(record);
  await assert.rejects(() => store.transitionInvitation(record.id, creatorProfile.id, creator, "accept", now), /UNAUTHORIZED/);
  const accepted = await store.transitionInvitation(record.id, recipient.id, opponent, "accept", now);
  assert.equal(accepted.status, "accepted"); assert.equal(accepted.fundingStatus, "not_funded");
});

test("expired invitations cannot be accepted", async () => {
  const store = new MemoryInvitationStore(); const a = await store.claimUsername(creator, "Creator", now); const b = await store.claimUsername(opponent, "Opponent", now);
  const record = createInvitationRecord(a, b, terms(), duelTermsHash, now); await store.createInvitation(record);
  await assert.rejects(() => store.transitionInvitation(record.id, b.id, opponent, "accept", new Date("2030-01-02T00:00:00.000Z")), /NOT_PENDING/);
  assert.equal((await store.invitationById(record.id))?.status, "expired");
});

test("only ten or fifteen minute server lifetimes are accepted and expiry wins acceptance races", async () => {
  assert.equal(defaultInvitationLifetimeMinutes, 15);
  assert.equal(invitationExpiryFromCreation(now, 10), "2030-01-01T00:10:00.000Z");
  assert.equal(invitationExpiryFromCreation(now, 15), "2030-01-01T00:15:00.000Z");
  assert.throws(() => invitationExpiryFromCreation(now, 11 as never));
  assert.equal(fundingDeadlineFromAcceptance(now, "2030-01-01T00:20:00.000Z"), "2030-01-01T00:15:00.000Z");
  assert.throws(() => fundingDeadlineFromAcceptance(now, "2030-01-01T00:15:00.000Z"));
  const store = new MemoryInvitationStore(); const a = await store.claimUsername(creator, "Creator", now); const b = await store.claimUsername(opponent, "Opponent", now);
  const record = createInvitationRecord(a, b, terms(), duelTermsHash, now); await store.createInvitation(record);
  assert.equal(isFundableInvitation(record, now), false);
  await assert.rejects(() => store.transitionInvitation(record.id, b.id, opponent, "accept", new Date(record.expiresAt)), /NOT_PENDING/);
  assert.equal(isFundableInvitation((await store.invitationById(record.id))!, new Date(record.expiresAt)), false);
});

test("invitation expiry is derived from server creation time, not a caller-supplied funding deadline", async () => {
  const store = new MemoryInvitationStore(); const a = await store.claimUsername(creator, "Creator", now); const b = await store.claimUsername(opponent, "Opponent", now);
  const requested = terms(); requested.fundingDeadlineUtc = "2030-01-02T00:00:00.000Z";
  const record = createInvitationRecord(a, b, requested, duelTermsHash, now);
  assert.equal(record.expiresAt, "2030-01-01T00:15:00.000Z");
});

test("only one concurrent recipient acceptance wins and funding uses the separate post-acceptance deadline", async () => {
  const store = new MemoryInvitationStore(); const a = await store.claimUsername(creator, "Creator", now); const b = await store.claimUsername(opponent, "Opponent", now);
  const record = createInvitationRecord(a, b, terms(), duelTermsHash, now); await store.createInvitation(record);
  const acceptedAt = new Date("2030-01-01T00:05:00.000Z");
  const results = await Promise.allSettled([store.transitionInvitation(record.id, b.id, opponent, "accept", acceptedAt), store.transitionInvitation(record.id, b.id, opponent, "accept", acceptedAt)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const accepted = await store.invitationById(record.id);
  assert.ok(accepted?.respondedAt);
  assert.equal(isFundableInvitation(accepted!, new Date("2030-01-01T00:18:00.000Z")), true);
  assert.equal(isFundableInvitation(accepted!, new Date("2030-01-01T00:20:00.000Z")), false);
});

test("recipient rejection and creator cancellation are separately authorized", async () => {
  const store = new MemoryInvitationStore(); const a = await store.claimUsername(creator, "Creator", now); const b = await store.claimUsername(opponent, "Opponent", now);
  const rejected = createInvitationRecord(a, b, terms(), duelTermsHash, now); await store.createInvitation(rejected);
  assert.equal((await store.transitionInvitation(rejected.id, b.id, opponent, "reject", now)).status, "rejected");
  const cancelled = createInvitationRecord(a, b, terms(), duelTermsHash, now); await store.createInvitation(cancelled);
  assert.equal((await store.transitionInvitation(cancelled.id, a.id, creator, "cancel", now)).status, "cancelled");
});

test("test-only synthetic lifecycle harness atomically covers create, accept, reject, cancel, expiry, replay, and wallet change", async () => {
  const harness = new InvitationLifecycleHarness(); const a = await harness.profile(creator, "Creator", now); const b = await harness.profile(opponent, "Opponent", now);
  harness.fixtures.set(terms().market.fixture);
  const createRace = await Promise.allSettled([harness.create(a, b, terms(), duelTermsHash, now), harness.create(a, b, terms(), duelTermsHash, now)]);
  assert.equal(createRace.filter((item) => item.status === "fulfilled").length, 1, "one duplicate pending invitation is inserted");
  const pending = (await Promise.all(createRace.map(async (item) => item.status === "fulfilled" ? item.value : null))).find(Boolean)!;
  const acceptAt = new Date("2030-01-01T00:01:00.000Z");
  const accepts = await Promise.allSettled([harness.respond(pending.id, b, opponent, "accept", acceptAt), harness.respond(pending.id, b, opponent, "accept", acceptAt)]);
  assert.equal(accepts.filter((item) => item.status === "fulfilled").length, 1, "one acknowledgement wins");
  const accepted = await harness.store.invitationById(pending.id); assert.equal(accepted?.acceptedWalletAddress, opponent); assert.equal(accepted?.fundingDeadlineAt, "2030-01-01T00:16:00.000Z"); assert.equal(accepted?.fundingStatus, "not_funded");
  await assert.rejects(() => harness.respond(pending.id, b, opponent, "accept", acceptAt), /NOT_PENDING/, "replay is rejected");

  const rejected = await harness.create(a, b, terms(), "b".repeat(64), now); assert.equal((await harness.respond(rejected.id, b, opponent, "reject", now)).status, "rejected");
  const cancelled = await harness.create(a, b, terms(), "c".repeat(64), now); assert.equal((await harness.respond(cancelled.id, a, creator, "cancel", now)).status, "cancelled");
  const expired = await harness.create(a, b, terms(), "d".repeat(64), now); await assert.rejects(() => harness.respond(expired.id, b, opponent, "accept", new Date(expired.expiresAt)), /NOT_PENDING/);
  const walletChanged = await harness.create(a, b, terms(), "e".repeat(64), now); await assert.rejects(() => harness.respond(walletChanged.id, b, authority, "accept", acceptAt), /WALLET_CHANGED/);
});

test("test-only lifecycle harness refuses changed or ineligible fixtures before create or acceptance", async () => {
  const harness = new InvitationLifecycleHarness(); const a = await harness.profile(creator, "Creator", now); const b = await harness.profile(opponent, "Opponent", now); const fixture = terms().market.fixture;
  await assert.rejects(() => harness.create(a, b, terms(), duelTermsHash, now), /NOT_REVALIDATED/);
  harness.fixtures.set(fixture); const record = await harness.create(a, b, terms(), duelTermsHash, now);
  harness.fixtures.set({ ...fixture, scheduledKickoffUtc: "2030-01-02T13:00:00.000Z" });
  await assert.rejects(() => harness.respond(record.id, b, opponent, "accept", new Date("2030-01-01T00:01:00.000Z")), /FIXTURE_CHANGED/);
});

test("immutable terms have deterministic hash and reject stale or invalid events", () => {
  const first = hashInvitationTerms(terms(), now); const second = hashInvitationTerms(terms(), now);
  assert.equal(first, second); assert.match(canonicalizeInvitationTerms(terms(), now), /fixtureId=fixture-12/);
  const modified = terms(); modified.market.fixture.fixtureId = "other"; assert.notEqual(hashInvitationTerms(modified, now), first);
  const invalid = terms(); invalid.market.fixture.scheduledKickoffUtc = "2029-01-01T00:00:00.000Z";
  assert.throws(() => canonicalizeInvitationTerms(invalid, now), /future/);
});

test("crypto terms bind source, UTC observation window, threshold, and comparator", () => {
  const crypto = { ...terms(), market: { kind: "crypto" as const, source: "reputable-feed", sourceInstrumentId: "BTC-USD", pair: "BTC/USD", quoteCurrency: "USD", observationStartUtc: "2030-01-02T01:00:00.000Z", observationEndUtc: "2030-01-02T02:00:00.000Z", threshold: "100000.50", comparison: "at_or_above" as const } };
  assert.match(canonicalizeInvitationTerms(crypto, now), /sourceInstrumentId=BTC-USD/);
});

test("personal-message authentication verifies a signature and rejects replay", async () => {
  const store = new MemoryInvitationStore(); const keypair = Ed25519Keypair.generate(); const wallet = keypair.toSuiAddress();
  const challenge = await createAuthenticationNonce(store, wallet, "https://stakemate.example", now);
  const signed = await keypair.signPersonalMessage(new TextEncoder().encode(challenge.message));
  await verifyAuthenticationSignature(store, { walletAddress: wallet, nonce: challenge.nonce, messageBytes: signed.bytes, signature: signed.signature, origin: "https://stakemate.example" }, now);
  await assert.rejects(() => verifyAuthenticationSignature(store, { walletAddress: wallet, nonce: challenge.nonce, messageBytes: signed.bytes, signature: signed.signature, origin: "https://stakemate.example" }, now), /REPLAYED/);
});

test("canonical challenge transport verifies official Ed25519 and ECDSA personal-message signatures", async () => {
  for (const keypair of [Ed25519Keypair.generate(), Secp256k1Keypair.generate(), Secp256r1Keypair.generate()]) {
    const store = new MemoryInvitationStore(); const wallet = keypair.toSuiAddress();
    const challenge = await createAuthenticationNonce(store, wallet, "https://stakemate.example", now);
    // This is the exact wallet-standard transport: Base64 bytes plus serialized signature.
    const signed = await keypair.signPersonalMessage(new TextEncoder().encode(challenge.message));
    await verifyAuthenticationSignature(store, { walletAddress: wallet, nonce: challenge.nonce, messageBytes: signed.bytes, signature: signed.signature, origin: "https://stakemate.example" }, now);
  }
});

test("invalid signatures do not consume an otherwise valid nonce", async () => {
  const store = new MemoryInvitationStore(); const holder = Ed25519Keypair.generate(); const attacker = Ed25519Keypair.generate(); const wallet = holder.toSuiAddress();
  const challenge = await createAuthenticationNonce(store, wallet, "https://stakemate.example", now);
  const invalid = await attacker.signPersonalMessage(new TextEncoder().encode(challenge.message));
  await assert.rejects(() => verifyAuthenticationSignature(store, { walletAddress: wallet, nonce: challenge.nonce, messageBytes: invalid.bytes, signature: invalid.signature, origin: "https://stakemate.example" }, now));
  const valid = await holder.signPersonalMessage(new TextEncoder().encode(challenge.message));
  await verifyAuthenticationSignature(store, { walletAddress: wallet, nonce: challenge.nonce, messageBytes: valid.bytes, signature: valid.signature, origin: "https://stakemate.example" }, now);
});

test("authentication labels a database lookup failure without exposing query details", async () => {
  const store = new MemoryInvitationStore();
  const wallet = Ed25519Keypair.generate().toSuiAddress();
  const challenge = await createAuthenticationNonce(store, wallet, "https://stakemate.example", now);
  store.nonceByValue = async () => { const error = Object.assign(new Error("connection details must not escape"), { code: "57P01" }); throw error; };
  await assert.rejects(
    () => verifyAuthenticationSignature(store, { walletAddress: wallet, nonce: challenge.nonce, messageBytes: toBase64(new TextEncoder().encode(challenge.message)), signature: "not-used", origin: "https://stakemate.example" }, now),
    (error: unknown) => error instanceof WalletAuthenticationError && error.stage === "nonce_lookup" && error.databaseCode === "57P01" && error.message === "connection details must not escape",
  );
});

test("authentication rejects a signature over different message bytes without consuming the nonce", async () => {
  const store = new MemoryInvitationStore(); const keypair = Ed25519Keypair.generate(); const wallet = keypair.toSuiAddress();
  const challenge = await createAuthenticationNonce(store, wallet, "https://stakemate.example", now);
  const wrongMessage = new TextEncoder().encode("different message"); const signed = await keypair.signPersonalMessage(wrongMessage);
  await assert.rejects(() => verifyAuthenticationSignature(store, { walletAddress: wallet, nonce: challenge.nonce, messageBytes: signed.bytes, signature: signed.signature, origin: "https://stakemate.example" }, now), (error: unknown) => error instanceof WalletAuthenticationError && error.signatureFailure === "signed_message_mismatch");
  const valid = await keypair.signPersonalMessage(new TextEncoder().encode(challenge.message));
  await verifyAuthenticationSignature(store, { walletAddress: wallet, nonce: challenge.nonce, messageBytes: valid.bytes, signature: valid.signature, origin: "https://stakemate.example" }, now);
});

test("authentication rejects a valid signature from a different Sui address without consuming the nonce", async () => {
  const store = new MemoryInvitationStore(); const wallet = Ed25519Keypair.generate().toSuiAddress(); const other = Ed25519Keypair.generate();
  const challenge = await createAuthenticationNonce(store, wallet, "https://stakemate.example", now); const signed = await other.signPersonalMessage(new TextEncoder().encode(challenge.message));
  await assert.rejects(() => verifyAuthenticationSignature(store, { walletAddress: wallet, nonce: challenge.nonce, messageBytes: signed.bytes, signature: signed.signature, origin: "https://stakemate.example" }, now), (error: unknown) => error instanceof WalletAuthenticationError && error.signatureFailure === "signer_address_mismatch");
});

test("authentication labels malformed signatures without consuming the nonce", async () => {
  const store = new MemoryInvitationStore(); const wallet = Ed25519Keypair.generate().toSuiAddress();
  const challenge = await createAuthenticationNonce(store, wallet, "https://stakemate.example", now);
  await assert.rejects(() => verifyAuthenticationSignature(store, { walletAddress: wallet, nonce: challenge.nonce, messageBytes: toBase64(new TextEncoder().encode(challenge.message)), signature: "not-a-serialized-signature", origin: "https://stakemate.example" }, now), (error: unknown) => error instanceof WalletAuthenticationError && error.signatureFailure === "malformed_signature");
});
