import assert from "node:assert/strict";
import test from "node:test";
import { fundingBlockReason, shortAddress } from "../src/lib/wallet";

test("funding requires a connected testnet wallet and deployed escrow", () => {
  assert.equal(fundingBlockReason({ connected: false, network: null, escrowContractDeployed: false }), "Connect a Sui wallet before funding a challenge.");
  assert.equal(fundingBlockReason({ connected: true, network: "mainnet", escrowContractDeployed: false }), "Challenge funding is restricted to Sui Testnet.");
  assert.equal(fundingBlockReason({ connected: true, network: "testnet", escrowContractDeployed: false }), "Testnet escrow is not deployed yet; funding remains unavailable.");
  assert.equal(fundingBlockReason({ connected: true, network: "testnet", escrowContractDeployed: true }), null);
});
test("shortens a connected account address without changing its identity", () => {
  assert.equal(shortAddress("0x1234567890abcdef"), "0x1234…cdef");
});
