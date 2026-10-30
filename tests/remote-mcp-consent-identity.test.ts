import assert from "node:assert/strict";
import test from "node:test";
import { remoteMcpConsentIdentity } from "../src/lib/server/remote-mcp-consent-identity";

const wallet = `0x${"a".repeat(64)}`; const other = `0x${"b".repeat(64)}`;
const profile = { id: "11111111-1111-4111-8111-111111111111", walletAddress: wallet, username: "temitope", usernameNormalized: "temitope", createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z" };
const session = { id: "22222222-2222-4222-8222-222222222222", tokenHash: "hashed", walletAddress: wallet, expiresAt: "2030-01-01T01:00:00.000Z", revokedAt: null, createdAt: "2030-01-01T00:00:00.000Z" };
const now = new Date("2030-01-01T00:30:00.000Z");

test("remote consent uses only a live session bound to the same immutable wallet profile", () => {
  assert.equal(remoteMcpConsentIdentity(session, profile, now)?.profile.id, profile.id);
  assert.equal(remoteMcpConsentIdentity({ ...session, walletAddress: other }, profile, now), null, "wallet mismatch");
  assert.equal(remoteMcpConsentIdentity({ ...session, expiresAt: "2030-01-01T00:00:00.000Z" }, profile, now), null, "expired session");
  assert.equal(remoteMcpConsentIdentity({ ...session, revokedAt: "2030-01-01T00:10:00.000Z" }, profile, now), null, "revoked session");
});
