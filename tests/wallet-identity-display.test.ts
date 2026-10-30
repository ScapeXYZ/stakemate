import assert from "node:assert/strict";
import test from "node:test";
import { identityForConnectedWallet } from "../src/lib/wallet-identity-display";

const virus = `0x${"1".repeat(64)}`;
const temitope = `0x${"2".repeat(64)}`;

test("wallet switching never renders a previous wallet username under a new wallet", () => {
  const virusSession = { walletAddress: virus, profile: { username: "Virus", walletAddress: virus } };
  assert.deepEqual(identityForConnectedWallet(virus, virusSession), virusSession.profile);
  assert.equal(identityForConnectedWallet(temitope, virusSession), null);
  assert.equal(identityForConnectedWallet(undefined, virusSession), null);
});

test("identity display rejects a malformed or mismatched profile wallet", () => {
  assert.equal(identityForConnectedWallet(virus, { walletAddress: virus, profile: { username: "Virus", walletAddress: temitope } }), null);
  assert.equal(identityForConnectedWallet("not-an-address", { walletAddress: virus, profile: null }), null);
});
