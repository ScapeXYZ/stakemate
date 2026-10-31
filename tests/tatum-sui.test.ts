import assert from "node:assert/strict";
import test from "node:test";
import { GrpcTypes } from "@mysten/sui/grpc";
import { ProviderError } from "../src/lib/server/errors";
import { STAKEMATE_TESTNET_PACKAGE, STAKEMATE_TESTNET_PUBLISH_TRANSACTION, TatumSuiClient } from "../src/lib/server/tatum-sui";

test("public Sui gRPC registry exposes the statically bundled read-message codecs", () => {
  for (const name of ["GetServiceInfoRequest", "GetServiceInfoResponse", "GetObjectRequest", "GetObjectResponse", "GetTransactionRequest", "GetTransactionResponse", "GetBalanceRequest", "GetBalanceResponse"] as const) {
    const codec = GrpcTypes[name];
    assert.equal(typeof codec.toBinary, "function");
    assert.equal(typeof codec.fromBinary, "function");
  }
});

test("Mainnet health uses the native read-only gRPC service", async () => {
  const client = new TatumSuiClient({ apiKey: "secret", network: "mainnet", fetchImpl: async () => { throw new Error("JSON-RPC must not be used"); } });
  const native = client as unknown as { nativeCall(method: string, request: unknown): Promise<unknown> };
  native.nativeCall = async (method) => { assert.equal(method, "GetServiceInfo"); return { chain: "mainnet", chainId: "mainnet-chain" }; };
  assert.deepEqual(await client.health(), { ok: true, network: "mainnet", chainIdentifier: "mainnet-chain" });
});
test("Tatum refuses calls with no configured key", async () => {
  const client = new TatumSuiClient({ apiKey: "" });
  await assert.rejects(() => client.health(), (error: unknown) => error instanceof ProviderError && error.code === "NOT_CONFIGURED");
});

test("Mainnet escrow, transaction, and wallet probes use read-only gRPC methods", async () => {
  const calls: Array<{ method: string; request: unknown }> = [];
  const client = new TatumSuiClient({ apiKey: "test", network: "mainnet", fetchImpl: async () => { throw new Error("JSON-RPC must not be used"); } });
  const native = client as unknown as { nativeCall(method: string, request: unknown): Promise<unknown> };
  native.nativeCall = async (method, request) => { calls.push({ method, request }); return {}; };
  await Promise.all([client.getObject("0x1"), client.getTransactionBlock("digest"), client.getSuiBalance("0x1")]);
  assert.deepEqual(calls.map((call) => call.method).sort(), ["GetBalance", "GetObject", "GetTransaction"]);
  assert.deepEqual(calls.find((call) => call.method === "GetBalance")?.request, { owner: "0x1", coinType: "0x2::sui::SUI" });
  await assert.rejects(() => client.getSuiBalance("not-a-wallet"), ProviderError);
});

test("Testnet deployment probe uses native gRPC request shapes and validates the returned package", async () => {
  const calls: Array<{ method: string; request: unknown }> = [];
  const client = new TatumSuiClient({ apiKey: "test", network: "testnet", fetchImpl: async () => { throw new Error("JSON-RPC must not be used for Testnet"); } });
  const native = client as unknown as { nativeCall(method: string, request: unknown): Promise<unknown> };
  native.nativeCall = async (method, request) => {
    calls.push({ method, request });
    if (method === "GetServiceInfo") return { chain: "testnet", chainId: "test-chain" };
    if (method === "GetObject") return { object: { objectId: STAKEMATE_TESTNET_PACKAGE, objectType: "package", package: { modules: [{ name: "challenge_escrow" }] } } };
    return { transaction: { digest: STAKEMATE_TESTNET_PUBLISH_TRANSACTION, effects: { status: { success: true } } } };
  };
  assert.deepEqual(await client.readStakeMateTestnetDeployment(), {
    network: "testnet", chainIdentifier: "test-chain", packageId: STAKEMATE_TESTNET_PACKAGE, packageType: "package", module: "challenge_escrow", publishTransaction: STAKEMATE_TESTNET_PUBLISH_TRANSACTION, transactionStatus: "success",
  });
  assert.deepEqual(calls.map((call) => call.method), ["GetServiceInfo", "GetObject", "GetTransaction"], "deployment attestation serializes gateway reads");
  assert.deepEqual(calls.find((call) => call.method === "GetObject")?.request, { objectId: STAKEMATE_TESTNET_PACKAGE, readMask: { paths: ["object_id", "object_type", "previous_transaction", "package.storage_id", "package.original_id", "package.modules.name"] } });
  assert.deepEqual(calls.find((call) => call.method === "GetTransaction")?.request, { digest: STAKEMATE_TESTNET_PUBLISH_TRANSACTION, readMask: { paths: ["digest", "effects.status"] } });
});
