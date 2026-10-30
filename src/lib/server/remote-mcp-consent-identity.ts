import { normalizeSuiAddress } from "@mysten/sui/utils";
import type { Profile } from "@/lib/server/invitations";
import type { Session } from "@/lib/server/postgres-invitations";

export type RemoteMcpConsentIdentity = { session: Session; profile: Profile };

/** Consent can only use the already-authenticated server session; request parameters never name a wallet. */
export function remoteMcpConsentIdentity(session: Session | null, profile: Profile | null, now = new Date()): RemoteMcpConsentIdentity | null {
  if (!session || !profile || session.revokedAt || Date.parse(session.expiresAt) <= now.getTime()) return null;
  try { return normalizeSuiAddress(session.walletAddress).toLowerCase() === normalizeSuiAddress(profile.walletAddress).toLowerCase() ? { session, profile } : null; } catch { return null; }
}
