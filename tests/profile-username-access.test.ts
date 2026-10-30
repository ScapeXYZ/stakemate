import assert from "node:assert/strict";
import test from "node:test";
import {
  ProfileAuthenticationRequiredError,
  withAuthenticatedProfileWallet,
} from "@/lib/server/profile-username-access";

test("unauthenticated username API access is rejected before storage is invoked", async () => {
  let storageInvoked = false;

  await assert.rejects(
    withAuthenticatedProfileWallet(null, async () => {
      storageInvoked = true;
      return "unexpected";
    }),
    ProfileAuthenticationRequiredError,
  );

  assert.equal(storageInvoked, false);
});

test("authenticated username API access derives the wallet from the session", async () => {
  const result = await withAuthenticatedProfileWallet(
    { walletAddress: "0xabc" },
    async (walletAddress) => `session:${walletAddress}`,
  );

  assert.equal(result, "session:0xabc");
});
