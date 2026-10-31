/**
 * Public, non-secret WorkOS Connect configuration. This intentionally contains
 * no client credentials, API keys, or token exchange logic.
 */
export const stakemateMcpResource = "https://stakemate.isholadigital.tech/api/mcp";

/** Accept only a root AuthKit HTTPS issuer; discovery supplies every endpoint. */
export function workosConnectIssuer(value: string | undefined): string | null {
  try {
    const issuer = new URL(value ?? "");
    if (issuer.protocol !== "https:" || !issuer.hostname.endsWith(".authkit.app") || issuer.port || issuer.username || issuer.password || issuer.pathname !== "/" || issuer.search || issuer.hash) return null;
    return issuer.origin;
  } catch { return null; }
}

/** The metadata is safe to expose, but only after a valid issuer is configured. */
export function workosProtectedResourceMetadata(issuer: string | undefined) {
  const authorizationServer = workosConnectIssuer(issuer);
  return authorizationServer ? { resource: stakemateMcpResource, authorization_servers: [authorizationServer], bearer_methods_supported: ["header"] } as const : null;
}
