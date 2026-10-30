import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { ESCROW_DEPLOYMENT, ESCROW_TARGETS } from "../src/lib/escrow-config";
import { assertEligibleActor, buildAcceptAndFund, buildCreateChallenge, buildSubmitOutcome } from "../src/lib/escrow-transactions";

const creator = `0x${"11".repeat(32)}`;
const opponent = `0x${"22".repeat(32)}`;
const authority = `0x${"33".repeat(32)}`;
const attacker = `0x${"44".repeat(32)}`;
const challenge = `0x${"55".repeat(32)}`;

test("reviewed local source and compiled-source copy have the same attested source digest", () => {
  const source = readFileSync("contracts/stakemate/sources/challenge_escrow.move");
  const compiledSource = readFileSync("contracts/stakemate/build/stakemate/sources/challenge_escrow.move");
  assert.deepEqual(source, compiledSource);
  assert.equal(createHash("sha256").update(source).digest("hex"), "be28fd801dc29d951780a2e767077a3f68ea91e36cfbb8b62cac33352d046e99");
  const text = source.toString("utf8");
  for (const name of ["create", "accept_and_fund", "submit_outcome", "cancel_unfunded", "refund_expired_funding", "void_unreported_outcome"]) assert.match(text, new RegExp(`entry fun ${name}\\b`));
});

test("funding and settlement vectors are exact-MIST, challenge-bound, and remain unsigned", () => {
  const created = buildCreateChallenge({ creator, opponent, stakeMist: BigInt(100_000_000), termsHashHex: `0x${"ab".repeat(32)}`, fundingDeadlineMs: BigInt(1_000), outcomeDeadlineMs: BigInt(2_000), outcomeAuthority: authority });
  assert.equal(created.preview.target, ESCROW_TARGETS.create);
  assert.equal(created.preview.stakeMist, BigInt(100_000_000));
  assert.equal(buildAcceptAndFund({ challengeId: challenge, stakeMist: BigInt(100_000_000), expectedStakeMist: BigInt(100_000_000) }).preview.target, ESCROW_TARGETS.acceptAndFund);
  for (const outcome of [0, 1, 2] as const) assert.equal(buildSubmitOutcome({ challengeId: challenge, outcome }).preview.target, ESCROW_TARGETS.submitOutcome);
  assert.throws(() => buildAcceptAndFund({ challengeId: challenge, stakeMist: BigInt(100_000_001), expectedStakeMist: BigInt(100_000_000) }), /exact stake/);
  // Move stores the supplied 32 bytes but cannot recompute football terms: callers
  // must compare this exact digest with the accepted canonical commitment off-chain.
  assert.doesNotThrow(() => buildCreateChallenge({ creator, opponent, stakeMist: BigInt(100_000_000), termsHashHex: `0x${"cd".repeat(32)}`, fundingDeadlineMs: BigInt(1_000), outcomeDeadlineMs: BigInt(2_000), outcomeAuthority: authority }));
  assert.match(created.preview.signingDisabledReason, /disabled/);
});

test("Move authorization vectors reject wrong actors and show the authority trust boundary", () => {
  const created = { creator, opponent, outcomeAuthority: authority, state: 0, fundingDeadlineMs: BigInt(1_000), outcomeDeadlineMs: BigInt(2_000) };
  assert.doesNotThrow(() => assertEligibleActor("acceptAndFund", created, opponent, BigInt(999)));
  assert.throws(() => assertEligibleActor("acceptAndFund", created, attacker, BigInt(999)));
  const funded = { ...created, state: 1 };
  assert.doesNotThrow(() => assertEligibleActor("submitOutcome", funded, authority, BigInt(1_999)));
  assert.throws(() => assertEligibleActor("submitOutcome", funded, attacker, BigInt(1_999)));
  assert.throws(() => assertEligibleActor("submitOutcome", funded, authority, BigInt(2_000)));
  // The contract receives only 0/1/2, not football evidence: a compromised authority
  // is authorized to select any valid code. Off-chain verification cannot change that.
  for (const outcome of [0, 1, 2] as const) assert.doesNotThrow(() => buildSubmitOutcome({ challengeId: challenge, outcome }));
  assert.equal(ESCROW_DEPLOYMENT.packageId.length, 66);
});
