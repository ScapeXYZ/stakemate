/** Remote serving never starts without explicit public HTTPS configuration. */
export function remoteMcpEnabled() {
  const origin = process.env.STAKEMATE_REMOTE_MCP_ORIGIN;
  const issuer = process.env.STAKEMATE_REMOTE_MCP_OAUTH_ISSUER;
  try { return process.env.STAKEMATE_REMOTE_MCP_ENABLED === "true" && new URL(origin ?? "").protocol === "https:" && new URL(issuer ?? "").protocol === "https:"; } catch { return false; }
}

/**
 * A deliberately separate gate for anonymous, read-only MCP access. It does
 * not enable the OAuth-backed remote MCP path or any wallet-bound tool.
 */
export function remoteMcpPublicReadOnlyEnabled() {
  return process.env.STAKEMATE_REMOTE_MCP_PUBLIC_READ_ONLY_ENABLED === "true";
}
