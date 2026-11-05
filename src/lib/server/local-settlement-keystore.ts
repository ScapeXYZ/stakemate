import "server-only";

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeSuiAddress } from "@mysten/sui/utils";

const SETTLEMENT_ADDRESS =
  "0x3439791c7090708e0e386178d4a1fccd99975d885ae98181071ca7c3592d15d4";

export function loadLocalSettlementKeypair(): Ed25519Keypair {
  if (process.env.NEXT_PUBLIC_SUI_NETWORK !== "testnet") {
    throw new Error("SETTLEMENT_TESTNET_ONLY");
  }

  const file = join(homedir(), ".sui", "sui_config", "sui.keystore");

  if ((statSync(file).mode & 0o077) !== 0) {
    throw new Error("INSECURE_KEYSTORE_PERMISSIONS");
  }

  const entries: unknown = JSON.parse(readFileSync(file, "utf8"));

  if (!Array.isArray(entries)) {
    throw new Error("INVALID_SUI_KEYSTORE");
  }

  for (const entry of entries) {
    if (typeof entry !== "string") continue;

    const decoded = Buffer.from(entry, "base64");

    // Sui CLI keystore: 1-byte scheme flag + 32-byte private key.
    if (decoded.length !== 33 || decoded[0] !== 0) continue;

    const keypair = Ed25519Keypair.fromSecretKey(decoded.subarray(1));

    if (
      normalizeSuiAddress(keypair.toSuiAddress()) ===
      normalizeSuiAddress(SETTLEMENT_ADDRESS)
    ) {
      return keypair;
    }
  }

  throw new Error("SETTLEMENT_KEY_NOT_FOUND");
}
