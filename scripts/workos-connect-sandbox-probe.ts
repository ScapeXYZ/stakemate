import { probeWorkosConnectSandboxMetadata } from "../src/lib/server/workos-connect-sandbox-probe";
import { workosConnectIssuer } from "../src/lib/server/workos-connect";

async function main() {
  const issuer = workosConnectIssuer(process.env.STAKEMATE_WORKOS_CONNECT_ISSUER);
  if (!issuer) throw new Error("WORKOS_CONNECT_ISSUER_INVALID");

  const result = await probeWorkosConnectSandboxMetadata({ issuer, requiredScopes: ["duels:prepare", "credibility:read", "invitations:read"] });
  console.log(JSON.stringify(result));
  // WorkOS advertises only standard OIDC scopes for CIMD/DCR clients. A
  // dashboard-registered OAuth application can still receive its assigned
  // permission scopes, so this public metadata signal is diagnostic only.
  if (!result.ok || !result.cimdAdvertised || result.dcrAdvertised) process.exitCode = 1;
}

void main().catch(() => {
  console.error("WORKOS_SANDBOX_PROBE_FAILED");
  process.exitCode = 1;
});
