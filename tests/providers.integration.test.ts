import test from "node:test";

// Live checks are deliberately disabled by default and never perform Memory writes.
const optIn = process.env.RUN_PROVIDER_INTEGRATION === "true";
test("live Tatum health requires explicit credentials", { skip: optIn && process.env.TATUM_API_KEY ? false : "set RUN_PROVIDER_INTEGRATION=true and inject TATUM_API_KEY" }, async () => {
  const { getTatumSuiClient } = await import("../src/lib/server/tatum-sui");
  await getTatumSuiClient().health();
});

test("live Tatum reads the verified StakeMate Testnet deployment", { skip: optIn && process.env.TATUM_API_KEY ? false : "set RUN_PROVIDER_INTEGRATION=true and inject TATUM_API_KEY" }, async () => {
  const { getTatumSuiClient, STAKEMATE_TESTNET_PACKAGE, STAKEMATE_TESTNET_PUBLISH_TRANSACTION } = await import("../src/lib/server/tatum-sui");
  const result = await getTatumSuiClient().readStakeMateTestnetDeployment();
  if (result.network !== "testnet" || result.packageId !== STAKEMATE_TESTNET_PACKAGE || result.publishTransaction !== STAKEMATE_TESTNET_PUBLISH_TRANSACTION || result.packageType !== "package" || result.module !== "challenge_escrow" || result.transactionStatus !== "success" || !result.chainIdentifier) {
    throw new Error("Tatum deployment details did not match the configured Testnet deployment.");
  }
});

test("live Walrus health requires explicit credentials", { skip: optIn && process.env.WALRUS_MEMORY_ACCOUNT_ID && process.env.WALRUS_MEMORY_DELEGATE_KEY ? false : "set RUN_PROVIDER_INTEGRATION=true and inject Walrus Memory credentials" }, async () => {
  const { getWalrusMemoryService } = await import("../src/lib/server/walrus-memory");
  await getWalrusMemoryService().health();
});

test("live Walrus account readiness authenticates without enabling writes", { skip: optIn && process.env.WALRUS_MEMORY_ACCOUNT_ID && process.env.WALRUS_MEMORY_DELEGATE_KEY && process.env.WALRUS_MEMORY_WRITES_ENABLED !== "true" ? false : "set RUN_PROVIDER_INTEGRATION=true, inject Walrus credentials, and keep writes disabled" }, async () => {
  const { getWalrusMemoryService } = await import("../src/lib/server/walrus-memory");
  const result = await getWalrusMemoryService().accountReadiness();
  if (!result.ok || result.network !== "mainnet" || result.authenticated !== true) throw new Error("Walrus Memory readiness did not authenticate against Mainnet.");
});
