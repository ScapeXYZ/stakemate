import { normalizeSuiAddress } from "@mysten/sui/utils";

export type SessionIdentity = { walletAddress: string; profile: { username: string; walletAddress: string } | null };

/** Do not render server-session identity under a different connected wallet. */
export function identityForConnectedWallet(connectedWallet: string | undefined, session: SessionIdentity) {
  if (!connectedWallet) return null;
  try {
    if (normalizeSuiAddress(connectedWallet) !== normalizeSuiAddress(session.walletAddress)) return null;
    if (session.profile && normalizeSuiAddress(session.profile.walletAddress) !== normalizeSuiAddress(connectedWallet)) return null;
    return session.profile;
  } catch { return null; }
}
