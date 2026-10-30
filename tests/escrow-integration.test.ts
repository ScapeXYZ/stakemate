import assert from "node:assert/strict";
import test from "node:test";
import { ESCROW_DEPLOYMENT, ESCROW_TARGETS } from "../src/lib/escrow-config";
import { discoverEscrowEvents, parseChallengeObject } from "../src/lib/escrow-discovery";
import { assertEligibleActor, buildAcceptAndFund, buildCreateChallenge, buildSubmitOutcome, parseMistAmount } from "../src/lib/escrow-transactions";

const id = `0x${"11".repeat(32)}`;
const opponent = `0x${"22".repeat(32)}`;
const authority = `0x${"33".repeat(32)}`;

test("deployment configuration is pinned to the verified Testnet package", () => {
  assert.equal(ESCROW_DEPLOYMENT.network, "testnet");
  assert.equal(ESCROW_DEPLOYMENT.packageId, "0x3ad668c9afb9fe8540c9a3567aaee1e637f6392d414be3611f137658ef238392");
});

test("unsigned transaction builders use the deployed Move targets and disable signing", () => {
  const create = buildCreateChallenge({ creator: id, opponent, stakeMist: BigInt(100), termsHashHex: `0x${"ab".repeat(32)}`, fundingDeadlineMs: BigInt(10), outcomeDeadlineMs: BigInt(20), outcomeAuthority: authority });
  assert.equal(create.preview.target, ESCROW_TARGETS.create);
  assert.match(create.preview.signingDisabledReason, /disabled/);
  assert.ok(create.transaction.getData().commands.length > 1);
  assert.equal(buildAcceptAndFund({ challengeId: id, stakeMist: BigInt(100), expectedStakeMist: BigInt(100) }).preview.target, ESCROW_TARGETS.acceptAndFund);
  assert.equal(buildSubmitOutcome({ challengeId: id, outcome: 2 }).preview.target, ESCROW_TARGETS.submitOutcome);
});

test("funding builders use exact integer MIST and reject underpayment, overpayment, zero, and malformed values", () => {
  assert.doesNotThrow(() => buildAcceptAndFund({ challengeId: id, stakeMist: BigInt(100), expectedStakeMist: BigInt(100) }));
  assert.throws(() => buildAcceptAndFund({ challengeId: id, stakeMist: BigInt(99), expectedStakeMist: BigInt(100) }), /exact stake/);
  assert.throws(() => buildAcceptAndFund({ challengeId: id, stakeMist: BigInt(101), expectedStakeMist: BigInt(100) }), /exact stake/);
  assert.throws(() => buildAcceptAndFund({ challengeId: id, stakeMist: BigInt(0), expectedStakeMist: BigInt(100) }));
  for (const value of ["0", "1.5", "-1", "01", "1e3", " "]) assert.throws(() => parseMistAmount(value));
  assert.equal(parseMistAmount("100000000"), BigInt(100000000));
});

test("preflight blocks wrong wallets and expired lifecycle actions", () => {
  const challenge = { creator: id, opponent, outcomeAuthority: authority, state: 0, fundingDeadlineMs: BigInt(10), outcomeDeadlineMs: BigInt(20) };
  assert.throws(() => assertEligibleActor("acceptAndFund", challenge, id, BigInt(1)));
  assert.throws(() => assertEligibleActor("acceptAndFund", challenge, opponent, BigInt(10)));
  assert.doesNotThrow(() => assertEligibleActor("acceptAndFund", challenge, opponent, BigInt(9)));
  assert.throws(() => buildCreateChallenge({ creator: id, opponent: id, stakeMist: BigInt(1), termsHashHex: `0x${"00".repeat(32)}`, fundingDeadlineMs: BigInt(1), outcomeDeadlineMs: BigInt(2), outcomeAuthority: authority }));
});

test("unprefixed preview-style digests cannot silently become Move terms-hash arguments", () => {
  const previewStyleDigest = "ab".repeat(32);
  assert.match(previewStyleDigest, /^[0-9a-f]{64}$/);
  assert.throws(() => buildCreateChallenge({ creator: id, opponent, stakeMist: BigInt(100), termsHashHex: previewStyleDigest, fundingDeadlineMs: BigInt(10), outcomeDeadlineMs: BigInt(20), outcomeAuthority: authority }), /SHA-256/);
});

test("challenge parser rejects malformed objects and accepts exact deployed shape", () => {
  const parsed = parseChallengeObject(id, `${ESCROW_DEPLOYMENT.packageId}::challenge_escrow::Challenge`, { id: { id }, creator: opponent, opponent: authority, stake_mist: "100", terms_hash: Array.from({ length: 32 }, () => 0), funding_deadline_ms: "10", outcome_deadline_ms: "20", outcome_authority: `0x${"44".repeat(32)}`, state: "1" });
  assert.equal(parsed.stakeMist, BigInt(100));
  assert.equal(parsed.state, 1);
  assert.throws(() => parseChallengeObject(id, "0x2::fake::Challenge", {}));
  assert.throws(() => parseChallengeObject(id, `${ESCROW_DEPLOYMENT.packageId}::challenge_escrow::Challenge`, { id: { id } }));
});

test("event discovery uses the module filter and preserves pagination metadata", async () => {
  const page = await discoverEscrowEvents({
    async getObject() { throw new Error("not used"); },
    async listEvents(input) {
      assert.equal(input.filter.emitModule, `${ESCROW_DEPLOYMENT.packageId}::challenge_escrow`);
      assert.equal(input.order, "descending");
      return { events: [{ eventType: `${ESCROW_DEPLOYMENT.packageId}::challenge_escrow::ChallengeCreated`, transactionDigest: "digest", checkpoint: "42", json: { stake_mist: "100" } }], endCursor: "next", hasNextPage: true };
    },
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.cursor, "next");
  assert.equal(page.hasNextPage, true);
});
