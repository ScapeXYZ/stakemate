import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { getPostgresInvitationStore } from "@/lib/server/postgres-invitations";

const cookieName = "stakemate_session";
const lifetimeMs = 7 * 24 * 60 * 60_000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function createSession(walletAddress: string, now = new Date()) {
  const token = randomBytes(32).toString("base64url"); const expiresAt = new Date(now.getTime() + lifetimeMs);
  await getPostgresInvitationStore().createSession({ id: randomUUID(), tokenHash: hash(token), walletAddress, expiresAt: expiresAt.toISOString(), revokedAt: null, createdAt: now.toISOString() });
  const jar = await cookies(); jar.set(cookieName, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
}

export async function authenticatedWallet(now = new Date()) {
  const token = (await cookies()).get(cookieName)?.value; if (!token) return null;
  return getPostgresInvitationStore().sessionByTokenHash(hash(token), now);
}

export async function destroySession(now = new Date()) { const jar = await cookies(); const token = jar.get(cookieName)?.value; if (token) await getPostgresInvitationStore().revokeSession(hash(token), now); jar.delete(cookieName); }

export function assertSameOrigin(request: Request) { const origin = request.headers.get("origin"); const configured = process.env.STAKEMATE_PUBLIC_ORIGIN; if (process.env.NODE_ENV === "production" && (!configured || new URL(configured).protocol !== "https:")) throw new Error("PRODUCTION_ORIGIN_NOT_CONFIGURED"); const expected = configured ?? new URL(request.url).origin; if (!origin || origin !== expected) throw new Error("ORIGIN_NOT_ALLOWED"); return origin; }
