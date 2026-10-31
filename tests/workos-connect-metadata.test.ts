import assert from "node:assert/strict";
import test from "node:test";
import { stakemateMcpResource, workosConnectIssuer, workosProtectedResourceMetadata } from "../src/lib/server/workos-connect";

const issuer = "https://stakemate-staging.authkit.app";

test("protected-resource metadata uses the fixed production MCP resource and only a validated WorkOS issuer", () => {
  assert.equal(stakemateMcpResource, "https://stakemate.isholadigital.tech/api/mcp");
  assert.equal(workosConnectIssuer(issuer), issuer);
  assert.equal(workosConnectIssuer("https://issuer.example"), null);
  assert.equal(workosConnectIssuer(`${issuer}/tenant`), null);
  assert.equal(workosConnectIssuer(`${issuer}?redirect=https://attacker.example`), null);
  assert.deepEqual(workosProtectedResourceMetadata(issuer), { resource: stakemateMcpResource, authorization_servers: [issuer], bearer_methods_supported: ["header"] });
  assert.equal(workosProtectedResourceMetadata(undefined), null);
});
