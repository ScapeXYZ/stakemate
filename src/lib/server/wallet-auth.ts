import { randomBytes } from "node:crypto";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { parseSerializedSignature } from "@mysten/sui/cryptography";
import { fromBase64, normalizeSuiAddress } from "@mysten/sui/utils";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import type { AuthNonce, InvitationStore } from "@/lib/server/invitations";

const encoder = new TextEncoder();
const nonceLifetimeMs = 5 * 60_000;

/**
 * Identifies the authentication boundary that failed without retaining sensitive
 * request material. Routes use this only for development diagnostics and safe
 * response classification.
 */
export type WalletAuthenticationStage = "nonce_lookup" | "nonce_validation" | "signature_verification" | "nonce_consumption";
export type SignatureFailureCategory = "signed_message_mismatch" | "malformed_signature" | "unsupported_signature_scheme" | "signature_invalid" | "signer_address_mismatch";

export class WalletAuthenticationError extends Error {
  readonly stage: WalletAuthenticationStage;
  readonly databaseCode: string | null;
  readonly signatureFailure: SignatureFailureCategory | null;
  readonly signatureScheme: string | null;

  constructor(stage: WalletAuthenticationStage, error: unknown, signatureFailure: SignatureFailureCategory | null = null, signatureScheme: string | null = null) {
    super(error instanceof Error ? error.message : "AUTHENTICATION_FAILED");
    this.name = "WalletAuthenticationError";
    this.stage = stage;
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
    // PostgreSQL SQLSTATE values are safe to classify, unlike a driver error
    // message which could accidentally include connection details.
    this.databaseCode = typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : null;
    this.signatureFailure = signatureFailure;
    this.signatureScheme = signatureScheme;
  }
}

function address(value: string) { return normalizeSuiAddress(value).toLowerCase(); }
function sameBytes(first: Uint8Array, second: Uint8Array) { return first.length === second.length && first.every((value, index) => value === second[index]); }

// zkLogin proof validation is stateful and the official SDK delegates it to a
// Sui client. This public Testnet client is server-side only and never signs.
let testnetVerificationClient: SuiGrpcClient | undefined;
function zkLoginVerificationClient() { testnetVerificationClient ??= new SuiGrpcClient({ network: "testnet", baseUrl: "https://fullnode.testnet.sui.io:443" }); return testnetVerificationClient; }

/** Human-readable, domain-bound challenge. The nonce is single-use in the persistent store. */
export function authenticationMessage(walletAddress: string, nonce: string, expiresAt: string, origin: string) {
  const url = new URL(origin);
  return [
    "StakeMate wallet authentication",
    "",
    `Domain: ${url.host}`,
    "Network: sui:testnet",
    `Address: ${address(walletAddress)}`,
    `Nonce: ${nonce}`,
    `Expires At: ${expiresAt}`,
    "",
    "This signature authenticates this wallet to StakeMate. It does not authorize a transaction or escrow funding.",
  ].join("\n");
}

export async function createAuthenticationNonce(store: InvitationStore, walletAddress: string, origin: string, now = new Date()): Promise<AuthNonce> {
  // Adapter-specific bounded cleanup avoids retaining expired authentication material.
  if ("cleanupExpired" in store && typeof store.cleanupExpired === "function") await store.cleanupExpired(now);
  const expiresAt = new Date(now.getTime() + nonceLifetimeMs).toISOString();
  const nonce = randomBytes(32).toString("base64url");
  const item: AuthNonce = { nonce, walletAddress: address(walletAddress), message: authenticationMessage(walletAddress, nonce, expiresAt, origin), expiresAt, usedAt: null };
  await store.createNonce(item);
  return item;
}

/** Verify cryptography first, then atomically consume the bound, unexpired nonce. */
export async function verifyAuthenticationSignature(store: InvitationStore, input: { walletAddress: string; nonce: string; messageBytes: string; signature: string; origin: string }, now = new Date()) {
  let item: AuthNonce | null;
  try {
    item = await store.nonceByValue(input.nonce);
  } catch (error) {
    throw new WalletAuthenticationError("nonce_lookup", error);
  }
  try {
    if (!item || item.usedAt || item.walletAddress !== address(input.walletAddress) || Date.parse(item.expiresAt) <= now.getTime()) throw new Error("AUTH_NONCE_INVALID_OR_REPLAYED");
    const expected = authenticationMessage(input.walletAddress, item.nonce, item.expiresAt, input.origin);
    if (item.message !== expected) throw new Error("AUTH_NONCE_MESSAGE_MISMATCH");
  } catch (error) {
    throw new WalletAuthenticationError("nonce_validation", error);
  }
  try {
    let signatureScheme: string | null = null;
    let signedMessage: Uint8Array;
    try {
      signedMessage = fromBase64(input.messageBytes);
    } catch (error) {
      throw new WalletAuthenticationError("signature_verification", error, "signed_message_mismatch");
    }
    // The wallet-standard result is authoritative about the bytes it signed, but
    // never authoritative about *which* bytes StakeMate accepts. Bind it exactly
    // to the persisted canonical UTF-8 challenge before cryptographic checking.
    if (!sameBytes(signedMessage, encoder.encode(item.message))) throw new WalletAuthenticationError("signature_verification", new Error("AUTH_SIGNED_MESSAGE_MISMATCH"), "signed_message_mismatch");
    try {
      signatureScheme = parseSerializedSignature(input.signature).signatureScheme;
    } catch (error) {
      const category: SignatureFailureCategory = error instanceof Error && error.message === "Unsupported signature scheme" ? "unsupported_signature_scheme" : "malformed_signature";
      throw new WalletAuthenticationError("signature_verification", error, category);
    }
    let publicKey;
    try {
      publicKey = await verifyPersonalMessageSignature(signedMessage, input.signature, signatureScheme === "ZkLogin" ? { client: zkLoginVerificationClient() } : {});
    } catch (error) {
      throw new WalletAuthenticationError("signature_verification", error, "signature_invalid", signatureScheme);
    }
    if (address(publicKey.toSuiAddress()) !== address(input.walletAddress)) throw new WalletAuthenticationError("signature_verification", new Error("AUTH_SIGNER_ADDRESS_MISMATCH"), "signer_address_mismatch", signatureScheme);
  } catch (error) {
    if (error instanceof WalletAuthenticationError) throw error;
    throw new WalletAuthenticationError("signature_verification", error);
  }
  try {
    if (!await store.consumeNonce(input.nonce, address(input.walletAddress), now)) throw new Error("AUTH_NONCE_INVALID_OR_REPLAYED");
  } catch (error) {
    throw new WalletAuthenticationError("nonce_consumption", error);
  }
  return { walletAddress: address(input.walletAddress), authenticatedAt: now.toISOString() };
}
