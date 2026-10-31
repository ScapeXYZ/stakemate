import assert from "node:assert/strict";
import test from "node:test";
import { probeWorkosConnectSandboxMetadata, validateWorkosConnectSandboxMetadata } from "../src/lib/server/workos-connect-sandbox-probe";

const issuer = "https://stakemate-sandbox.authkit.app"; const config = { issuer, requiredScopes: ["duels:prepare", "credibility:read", "invitations:read"] };
const metadata = { issuer, authorization_endpoint: `${issuer}/oauth2/authorize`, token_endpoint: `${issuer}/oauth2/token`, jwks_uri: `${issuer}/oauth2/jwks`, registration_endpoint: `${issuer}/oauth2/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], client_id_metadata_document_supported: true, scopes_supported: ["duels:prepare", "credibility:read", "invitations:read"] };

test("WorkOS sandbox metadata compatibility accepts only an exact HTTPS issuer, code flow, S256, and public JWKS", () => {
  const compatible = validateWorkosConnectSandboxMetadata(config, metadata, { keys: [{ kid: "public-key", kty: "RSA" }] });
  assert.deepEqual(compatible, { ok: true, failures: [], cimdAdvertised: true, dcrAdvertised: true, customScopesAdvertised: true });
  const missingPkce = validateWorkosConnectSandboxMetadata(config, { ...metadata, code_challenge_methods_supported: ["plain"] }, { keys: [{ kid: "public-key", kty: "RSA" }] }); assert.equal(missingPkce.ok, false);
  const missingCimd = validateWorkosConnectSandboxMetadata(config, { ...metadata, client_id_metadata_document_supported: false }, { keys: [{ kid: "public-key", kty: "RSA" }] }); assert.equal(missingCimd.ok, false);
  const wrongIssuer = validateWorkosConnectSandboxMetadata({ ...config, issuer: "http://stakemate-sandbox.authkit.app" }, metadata, { keys: [{ kid: "public-key", kty: "RSA" }] }); assert.equal(wrongIssuer.ok, false);
  const noKey = validateWorkosConnectSandboxMetadata(config, metadata, { keys: [] }); assert.equal(noKey.ok, false);
});

test("missing advertised private scopes is diagnostic, not a metadata compatibility failure", () => {
  const compatible = validateWorkosConnectSandboxMetadata(config, { ...metadata, scopes_supported: ["openid", "profile", "email", "offline_access"] }, { keys: [{ kid: "public-key", kty: "RSA" }] });
  assert.equal(compatible.ok, true);
  assert.equal(compatible.customScopesAdvertised, false);
});

test("WorkOS sandbox probe remains disabled unless explicitly enabled and performs read-only metadata/JWKS fetches", async () => {
  const previous = process.env.STAKEMATE_WORKOS_SANDBOX_PROBES_ENABLED; delete process.env.STAKEMATE_WORKOS_SANDBOX_PROBES_ENABLED;
  try { await assert.rejects(() => probeWorkosConnectSandboxMetadata(config, async () => new Response()), /WORKOS_SANDBOX_PROBES_DISABLED/); }
  finally { if (previous === undefined) delete process.env.STAKEMATE_WORKOS_SANDBOX_PROBES_ENABLED; else process.env.STAKEMATE_WORKOS_SANDBOX_PROBES_ENABLED = previous; }
  process.env.STAKEMATE_WORKOS_SANDBOX_PROBES_ENABLED = "true"; const requested: string[] = [];
  try {
    const result = await probeWorkosConnectSandboxMetadata(config, async (input) => { requested.push(String(input)); return new Response(JSON.stringify(requested.length === 1 ? metadata : { keys: [{ kid: "public-key", kty: "RSA" }] }), { status: 200, headers: { "content-type": "application/json" } }); });
    assert.equal(result.ok, true); assert.deepEqual(requested, [`${issuer}/.well-known/oauth-authorization-server`, `${issuer}/oauth2/jwks`]);
  } finally { if (previous === undefined) delete process.env.STAKEMATE_WORKOS_SANDBOX_PROBES_ENABLED; else process.env.STAKEMATE_WORKOS_SANDBOX_PROBES_ENABLED = previous; }
});
