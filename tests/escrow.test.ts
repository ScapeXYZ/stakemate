import assert from "node:assert/strict";
import test from "node:test";
import { DisabledEscrowTransactionBuilder } from "../src/lib/escrow";

const builder = new DisabledEscrowTransactionBuilder();
const terms = { opponent: "0x0000000000000000000000000000000000000000000000000000000000000001", stakeMist: BigInt(1), termsHashHex: `0x${"00".repeat(32)}`, fundingDeadlineMs: BigInt(1), outcomeDeadlineMs: BigInt(2), outcomeAuthority: "0x0000000000000000000000000000000000000000000000000000000000000002" };
test("escrow transaction intents are testnet-only and explicitly inert", () => {
  const intent = builder.createChallenge(terms);
  assert.equal(intent.network, "testnet");
  assert.equal(intent.function, "create");
  assert.match(intent.disabledReason, /disabled/);
});
test("escrow interface rejects invalid immutable terms before any transaction can exist", () => {
  assert.throws(() => builder.createChallenge({ ...terms, termsHashHex: "0x00" }));
  assert.throws(() => builder.createChallenge({ ...terms, stakeMist: BigInt(0) }));
  assert.throws(() => builder.createChallenge({ ...terms, stakeMist: BigInt(2) ** BigInt(63) }));
  assert.throws(() => builder.createChallenge({ ...terms, outcomeAuthority: terms.opponent }));
  assert.throws(() => builder.createChallenge({ ...terms, outcomeAuthority: `0x${"0".repeat(64)}` }));
  assert.throws(() => builder.createChallenge({ ...terms, outcomeDeadlineMs: BigInt(1) }));
});
