import { createHash, randomUUID } from "node:crypto";
import { SignJWT, calculateJwkThumbprint, importJWK, type JWK } from "jose";
import { remoteMcpPrivateScopes, type RemoteMcpPrivateScope } from "@/lib/server/remote-oauth-authorization";

/**
 * Protocol-only building blocks for the disabled wallet-native authorization
 * server. They intentionally do not read request-supplied client registrations
 * or create a session/token: those operations need the reviewed persistence
 * migration described in WALLET_NATIVE_OAUTH.md.
 */
export const walletNativeMcpResource = "https://stakemate.isholadigital.tech/api/mcp";
export const walletNativeOAuthIssuer = "https://stakemate.isholadigital.tech";
export const walletNativeAccessTokenLifetimeSeconds = 5 * 60;

export type WalletNativeOAuthClient = Readonly<{ clientId: string; redirectUris: readonly string[]; allowedScopes: readonly RemoteMcpPrivateScope[]; tokenEndpointAuthMethod: "none" }>;
export type WalletNativeAuthorizationRequest = Readonly<{ client: WalletNativeOAuthClient; redirectUri: string; state: string; scopes: RemoteMcpPrivateScope[]; codeChallenge: string; resource: typeof walletNativeMcpResource }>;
export type WalletNativeAuthorizationError = "invalid_request" | "unauthorized_client" | "invalid_scope" | "invalid_target";
export type WalletNativeAuthorizationValidation = { ok: true; request: WalletNativeAuthorizationRequest } | { ok: false; error: WalletNativeAuthorizationError };

const statePattern = /^[\x21-\x7e]{8,512}$/;
const challengePattern = /^[A-Za-z0-9_-]{43,128}$/;
const one = (input: URLSearchParams, key: string) => { const values = input.getAll(key); return values.length === 1 ? values[0] : null; };

/** Reject before persistence or navigation. The complete redirect URI is compared byte-for-byte. */
export function validateWalletNativeAuthorizationRequest(input: URLSearchParams, clients: readonly WalletNativeOAuthClient[]): WalletNativeAuthorizationValidation {
  const responseType = one(input, "response_type"); const clientId = one(input, "client_id"); const redirectUri = one(input, "redirect_uri"); const state = one(input, "state"); const scope = one(input, "scope"); const challenge = one(input, "code_challenge"); const method = one(input, "code_challenge_method"); const resource = one(input, "resource");
  if (!responseType || !clientId || !redirectUri || !state || !scope || !challenge || !method || responseType !== "code" || method !== "S256" || !statePattern.test(state) || !challengePattern.test(challenge)) return { ok: false, error: "invalid_request" };
  if (resource !== walletNativeMcpResource) return { ok: false, error: "invalid_target" };
  const client = clients.find((candidate) => candidate.clientId === clientId);
  if (!client || !client.redirectUris.includes(redirectUri) || client.tokenEndpointAuthMethod !== "none") return { ok: false, error: "unauthorized_client" };
  if (scope.trim() !== scope || scope.includes("  ")) return { ok: false, error: "invalid_scope" };
  const scopes = scope.split(" ");
  if (scopes.length === 0 || new Set(scopes).size !== scopes.length || !scopes.every((value): value is RemoteMcpPrivateScope => remoteMcpPrivateScopes.includes(value as RemoteMcpPrivateScope) && client.allowedScopes.includes(value as RemoteMcpPrivateScope))) return { ok: false, error: "invalid_scope" };
  return { ok: true, request: { client, redirectUri, state, scopes, codeChallenge: challenge, resource: walletNativeMcpResource } };
}

export function walletNativePkceS256(verifier: string) { return createHash("sha256").update(verifier, "ascii").digest("base64url"); }

/** Metadata is emitted only by a separately gated route; it never turns on MCP. */
export function walletNativeAuthorizationServerMetadata() {
  return {
    issuer: walletNativeOAuthIssuer,
    authorization_endpoint: `${walletNativeOAuthIssuer}/api/oauth/authorize`,
    token_endpoint: `${walletNativeOAuthIssuer}/api/oauth/token`,
    jwks_uri: `${walletNativeOAuthIssuer}/api/oauth/jwks`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...remoteMcpPrivateScopes],
    resource_indicators_supported: true,
  } as const;
}

type PrivateSigningJwk = JWK & { d: string; kty: "EC" | "RSA" };
function privateSigningJwk(value: string): PrivateSigningJwk | null {
  try {
    const parsed = JSON.parse(value) as JWK;
    if ((parsed.kty !== "EC" && parsed.kty !== "RSA") || typeof parsed.d !== "string" || typeof parsed.kid !== "string" || !parsed.kid) return null;
    return parsed as PrivateSigningJwk;
  } catch { return null; }
}

/** The key is server-only deployment secret material; no generated fallback exists. */
export async function walletNativeSigningKey(secret: string | undefined) {
  const jwk = secret ? privateSigningJwk(secret) : null;
  if (!jwk) return null;
  try { return { jwk, key: await importJWK(jwk, jwk.kty === "EC" ? "ES256" : "RS256") }; } catch { return null; }
}

export async function walletNativeJwks(secret: string | undefined) {
  const signing = await walletNativeSigningKey(secret); if (!signing) return null;
  // Importing a secret JWK intentionally produces a non-extractable WebCrypto
  // key. Construct the public projection from the validated JWK instead of
  // relaxing extractability merely to publish JWKS.
  const publicJwk: JWK = signing.jwk.kty === "EC"
    ? { kty: "EC", crv: signing.jwk.crv, x: signing.jwk.x, y: signing.jwk.y, kid: signing.jwk.kid, use: "sig", alg: "ES256" }
    : { kty: "RSA", n: signing.jwk.n, e: signing.jwk.e, kid: signing.jwk.kid, use: "sig", alg: "RS256" };
  return { keys: [publicJwk] };
}

export async function issueWalletNativeAccessToken(input: { signingJwk: string; subject: string; clientId: string; scopes: RemoteMcpPrivateScope[]; tokenId?: string; now?: Date }) {
  const signing = await walletNativeSigningKey(input.signingJwk); if (!signing || !input.subject || !input.clientId || input.scopes.length === 0 || new Set(input.scopes).size !== input.scopes.length || !input.scopes.every((scope) => remoteMcpPrivateScopes.includes(scope))) throw new Error("WALLET_NATIVE_OAUTH_TOKEN_ISSUANCE_REJECTED");
  const now = input.now ?? new Date(); const tokenId = input.tokenId ?? randomUUID(); const algorithm = signing.jwk.kty === "EC" ? "ES256" : "RS256";
  return new SignJWT({ client_id: input.clientId, scope: input.scopes.join(" ") })
    .setProtectedHeader({ alg: algorithm, kid: signing.jwk.kid })
    .setIssuer(walletNativeOAuthIssuer).setAudience(walletNativeMcpResource).setSubject(input.subject).setJti(tokenId)
    .setIssuedAt(Math.floor(now.getTime() / 1_000)).setExpirationTime(Math.floor(now.getTime() / 1_000) + walletNativeAccessTokenLifetimeSeconds)
    .sign(signing.key);
}

export async function walletNativeSigningKeyThumbprint(secret: string | undefined) {
  const signing = await walletNativeSigningKey(secret); return signing ? calculateJwkThumbprint(signing.jwk) : null;
}
