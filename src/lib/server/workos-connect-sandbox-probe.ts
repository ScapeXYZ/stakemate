type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type WorkosConnectProbeConfig = { issuer: string; requiredScopes: readonly string[] };
export type WorkosConnectCompatibility = { ok: boolean; failures: string[]; dcrAdvertised: boolean; customScopesAdvertised: boolean };

function sandboxIssuer(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname.endsWith(".authkit.app") && !url.username && !url.password && !url.search && !url.hash ? url : null; } catch { return null; }
}
function httpsUrl(value: unknown) { try { const url = new URL(typeof value === "string" ? value : ""); return url.protocol === "https:" ? url : null; } catch { return null; } }

/** Pure validation of public, non-secret WorkOS metadata and JWKS shape. */
export function validateWorkosConnectSandboxMetadata(config: WorkosConnectProbeConfig, metadata: unknown, jwks: unknown): WorkosConnectCompatibility {
  const issuer = sandboxIssuer(config.issuer); const value = metadata as Record<string, unknown> | null; const keys = (jwks as { keys?: unknown } | null)?.keys;
  const failures: string[] = [];
  if (!issuer) failures.push("issuer must be an HTTPS WorkOS AuthKit sandbox domain");
  if (!value || typeof value !== "object") failures.push("authorization-server metadata is not an object");
  if (value?.issuer !== config.issuer) failures.push("issuer does not exactly match configured issuer");
  if (!httpsUrl(value?.authorization_endpoint)) failures.push("authorization endpoint is not HTTPS");
  if (!httpsUrl(value?.token_endpoint)) failures.push("token endpoint is not HTTPS");
  if (!httpsUrl(value?.jwks_uri)) failures.push("JWKS URI is not HTTPS");
  if (!Array.isArray(value?.response_types_supported) || !value.response_types_supported.includes("code")) failures.push("authorization-code response type is missing");
  if (!Array.isArray(value?.grant_types_supported) || !value.grant_types_supported.includes("authorization_code")) failures.push("authorization-code grant is missing");
  if (!Array.isArray(value?.code_challenge_methods_supported) || !value.code_challenge_methods_supported.includes("S256")) failures.push("PKCE S256 is missing");
  if (!Array.isArray(keys) || !keys.some((key) => key && typeof key === "object" && typeof (key as Record<string, unknown>).kid === "string" && typeof (key as Record<string, unknown>).kty === "string")) failures.push("JWKS has no identifiable public key");
  const advertisedScopes = Array.isArray(value?.scopes_supported) ? value.scopes_supported.filter((scope): scope is string => typeof scope === "string") : [];
  return { ok: failures.length === 0, failures, dcrAdvertised: Boolean(httpsUrl(value?.registration_endpoint)), customScopesAdvertised: config.requiredScopes.every((scope) => advertisedScopes.includes(scope)) };
}

/**
 * Explicitly opt-in, read-only sandbox check. It sends no authorization header,
 * never registers a client, and does not exchange or issue any token.
 */
export async function probeWorkosConnectSandboxMetadata(config: WorkosConnectProbeConfig, fetcher: FetchLike = globalThis.fetch): Promise<WorkosConnectCompatibility> {
  if (process.env.STAKEMATE_WORKOS_SANDBOX_PROBES_ENABLED !== "true") throw new Error("WORKOS_SANDBOX_PROBES_DISABLED");
  const issuer = sandboxIssuer(config.issuer); if (!issuer) return { ok: false, failures: ["issuer must be an HTTPS WorkOS AuthKit sandbox domain"], dcrAdvertised: false, customScopesAdvertised: false };
  const metadataResponse = await fetcher(new URL("/.well-known/oauth-authorization-server", issuer).toString(), { headers: { accept: "application/json" }, cache: "no-store" });
  if (!metadataResponse.ok) return { ok: false, failures: ["authorization-server metadata request failed"], dcrAdvertised: false, customScopesAdvertised: false };
  const metadata = await metadataResponse.json() as Record<string, unknown>; const jwksUri = httpsUrl(metadata.jwks_uri);
  if (!jwksUri) return validateWorkosConnectSandboxMetadata(config, metadata, null);
  const jwksResponse = await fetcher(jwksUri.toString(), { headers: { accept: "application/json" }, cache: "no-store" });
  if (!jwksResponse.ok) return { ok: false, failures: ["JWKS request failed"], dcrAdvertised: Boolean(httpsUrl(metadata.registration_endpoint)), customScopesAdvertised: false };
  return validateWorkosConnectSandboxMetadata(config, metadata, await jwksResponse.json());
}
