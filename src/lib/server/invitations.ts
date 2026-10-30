import { createHash, randomUUID } from "node:crypto";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { z } from "zod";
import { validateUpcomingFixture, type VerifiedFixture } from "@/lib/outcome-verification";
import { getPostgresInvitationStore } from "@/lib/server/postgres-invitations";

export const invitationStatuses = ["pending", "accepted", "rejected", "expired", "cancelled"] as const;
export type InvitationStatus = (typeof invitationStatuses)[number];
export const invitationLifetimeMinutes = [10, 15] as const;
export type InvitationLifetimeMinutes = (typeof invitationLifetimeMinutes)[number];
export const defaultInvitationLifetimeMinutes: InvitationLifetimeMinutes = 15;
export const fundingWindowAfterAcceptanceMs = 15 * 60_000;

export type CryptoMarketTerms = {
  kind: "crypto";
  source: string;
  sourceInstrumentId: string;
  pair: string;
  quoteCurrency: string;
  observationStartUtc: string;
  observationEndUtc: string;
  threshold: string;
  comparison: "above" | "at_or_above" | "below" | "at_or_below";
};

export type SportsMarketTerms = {
  kind: "sports";
  fixture: VerifiedFixture;
  market: "home_win" | "draw" | "away_win";
  resultSources: readonly string[];
};

export type InvitationTerms = {
  version: "v1";
  invitationLifetimeMinutes: InvitationLifetimeMinutes;
  creatorAddress: string;
  recipientAddress: string;
  stakeMist: string;
  fundingDeadlineUtc: string;
  outcomeDeadlineUtc: string;
  outcomeAuthority: string;
  voidRule: "full_principal_refund";
  market: SportsMarketTerms | CryptoMarketTerms;
};

export type Profile = { id: string; walletAddress: string; username: string; usernameNormalized: string; createdAt: string; updatedAt: string };
/** Safe to return only to an authenticated lookup caller; never contains session or internal profile metadata. */
export type PublicHandleIdentity = { username: string; walletAddress: string };
export type AuthNonce = { nonce: string; walletAddress: string; message: string; expiresAt: string; usedAt: string | null };
export type Invitation = {
  id: string; creatorProfileId: string; recipientProfileId: string; status: InvitationStatus;
  /** SHA-256 of the immutable, versioned 1X2 preview terms. Never a transaction approval. */
  duelTermsHash: string;
  termsCanonical: string; termsHash: string; terms: InvitationTerms; fundingStatus: "not_funded";
  creatorWalletAddress: string; recipientWalletAddress: string; acceptedWalletAddress: string | null;
  createdAt: string; expiresAt: string; respondedAt: string | null; fundingDeadlineAt: string | null; cancelledAt: string | null;
};

export function invitationExpiryFromCreation(now = new Date(), lifetime: InvitationLifetimeMinutes = defaultInvitationLifetimeMinutes) {
  if (!invitationLifetimeMinutes.includes(lifetime)) throw new Error("Invitation lifetime must be 10 or 15 minutes.");
  return new Date(now.getTime() + lifetime * 60_000).toISOString();
}

/** Funding starts only after off-chain acceptance; the future Move create call must use this bounded UTC deadline. */
export function fundingDeadlineFromAcceptance(acceptedAt: Date, outcomeDeadlineUtc: string) {
  const outcome = iso(outcomeDeadlineUtc, "outcomeDeadlineUtc"); const deadline = acceptedAt.getTime() + fundingWindowAfterAcceptanceMs;
  if (deadline >= outcome) throw new Error("Outcome deadline leaves no bounded funding window after acceptance.");
  return new Date(deadline).toISOString();
}

export function isFundableInvitation(value: Invitation, now = new Date()) {
  if (value.status !== "accepted" || value.fundingStatus !== "not_funded" || !value.respondedAt) return false;
  const deadline = value.fundingDeadlineAt ?? fundingDeadlineFromAcceptance(new Date(value.respondedAt), value.terms.outcomeDeadlineUtc);
  return Date.parse(deadline) > now.getTime();
}

export interface InvitationStore {
  serverNow(): Promise<string>;
  createNonce(nonce: AuthNonce): Promise<void>;
  nonceByValue(nonce: string): Promise<AuthNonce | null>;
  consumeNonce(nonce: string, walletAddress: string, now: Date): Promise<AuthNonce | null>;
  claimUsername(walletAddress: string, username: string, now: Date): Promise<Profile>;
  profileForWallet(walletAddress: string): Promise<Profile | null>;
  profileForUsername(username: string): Promise<PublicHandleIdentity | null>;
  createInvitation(invitation: Invitation): Promise<Invitation>;
  invitationById(id: string): Promise<Invitation | null>;
  invitationsForRecipient(profileId: string): Promise<Invitation[]>;
  invitationsForCreator(profileId: string): Promise<Invitation[]>;
  transitionInvitation(id: string, actorProfileId: string, actorWalletAddress: string, action: "accept" | "reject" | "cancel", now: Date): Promise<Invitation>;
}

export class PersistentStoreUnavailableError extends Error {
  code = "DATABASE_NOT_CONFIGURED" as const;
  constructor() { super("Persistent invitation storage is not configured."); }
}

/**
 * Production intentionally has no implicit fallback. Inject a transactional Postgres-backed
 * InvitationStore at deployment time; MemoryInvitationStore below exists for tests only.
 */
export function getInvitationStore(): InvitationStore {
  if (!process.env.DATABASE_URL?.trim()) throw new PersistentStoreUnavailableError();
  return getPostgresInvitationStore();
}

const usernameSchema = z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/, "Use letters, numbers, and underscores only.");
const iso = (value: string, field: string) => {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error(`${field} must be an ISO-8601 UTC timestamp.`);
  return time;
};
const clean = (value: string, field: string) => {
  const result = value.normalize("NFC").trim();
  if (!result || /[\r\n]/u.test(result)) throw new Error(`${field} is required and cannot contain line breaks.`);
  return result;
};
const normalizeAddress = (value: string) => normalizeSuiAddress(value).toLowerCase();

export function normalizeUsername(username: string) { return usernameSchema.parse(username).normalize("NFC").toLowerCase(); }

/** Fixed-order UTF-8 LF format. Its SHA-256 is what an invitation permanently commits to. */
export function canonicalizeInvitationTerms(input: InvitationTerms, now = new Date()): string {
  const terms: InvitationTerms = { ...input, creatorAddress: normalizeAddress(input.creatorAddress), recipientAddress: normalizeAddress(input.recipientAddress), outcomeAuthority: normalizeAddress(input.outcomeAuthority) };
  if (terms.creatorAddress === terms.recipientAddress) throw new Error("A wallet cannot invite itself.");
  if (!/^\d+$/u.test(terms.stakeMist) || BigInt(terms.stakeMist) <= BigInt(0)) throw new Error("stakeMist must be a positive integer.");
  const funding = iso(terms.fundingDeadlineUtc, "fundingDeadlineUtc");
  const outcome = iso(terms.outcomeDeadlineUtc, "outcomeDeadlineUtc");
  if (funding <= now.getTime() || outcome <= funding) throw new Error("Deadlines must be future UTC times with outcome after funding.");
  if (!invitationLifetimeMinutes.includes(terms.invitationLifetimeMinutes)) throw new Error("Invitation lifetime must be 10 or 15 minutes.");
  const rows = ["stakemate.invitation-terms.v1", `creatorAddress=${terms.creatorAddress}`, `recipientAddress=${terms.recipientAddress}`, `stakeMist=${terms.stakeMist}`, `invitationLifetimeMinutes=${terms.invitationLifetimeMinutes}`, `fundingDeadlineUtc=${terms.fundingDeadlineUtc}`, `outcomeDeadlineUtc=${terms.outcomeDeadlineUtc}`, `outcomeAuthority=${terms.outcomeAuthority}`, `voidRule=${terms.voidRule}`];
  if (terms.market.kind === "sports") {
    const fixtureError = validateUpcomingFixture(terms.market.fixture, now.getTime());
    if (fixtureError) throw new Error(fixtureError);
    const verifiedAt = iso(terms.market.fixture.verifiedAtUtc, "fixture verifiedAtUtc");
    if (verifiedAt > now.getTime() || now.getTime() - verifiedAt > 5 * 60_000) throw new Error("Fixture verification is stale or invalid.");
    if (!terms.market.resultSources.length || terms.market.resultSources.some((source) => !clean(source, "result source"))) throw new Error("Sports markets require result sources.");
    rows.push("marketKind=sports", `fixtureProvider=${clean(terms.market.fixture.provider, "fixture provider")}`, `fixtureId=${clean(terms.market.fixture.fixtureId, "fixture ID")}`, `league=${clean(terms.market.fixture.league, "league")}`, `homeTeam=${clean(terms.market.fixture.homeTeam, "home team")}`, `awayTeam=${clean(terms.market.fixture.awayTeam, "away team")}`, `scheduledKickoffUtc=${terms.market.fixture.scheduledKickoffUtc}`, `fixtureStatus=${terms.market.fixture.status}`, `market=${terms.market.market}`, `resultSources=${[...terms.market.resultSources].sort().join(",")}`);
  } else {
    const start = iso(terms.market.observationStartUtc, "observationStartUtc");
    const end = iso(terms.market.observationEndUtc, "observationEndUtc");
    if (start >= end || end > outcome) throw new Error("Crypto observation window must end after it starts and by the outcome deadline.");
    if (!/^\d+(?:\.\d+)?$/u.test(terms.market.threshold)) throw new Error("Crypto threshold must be a decimal.");
    rows.push("marketKind=crypto", `source=${clean(terms.market.source, "source")}`, `sourceInstrumentId=${clean(terms.market.sourceInstrumentId, "source instrument ID")}`, `pair=${clean(terms.market.pair, "pair")}`, `quoteCurrency=${clean(terms.market.quoteCurrency, "quote currency")}`, `observationStartUtc=${terms.market.observationStartUtc}`, `observationEndUtc=${terms.market.observationEndUtc}`, `threshold=${terms.market.threshold}`, `comparison=${terms.market.comparison}`);
  }
  return `${rows.join("\n")}\n`;
}

export function hashInvitationTerms(terms: InvitationTerms, now?: Date) { return createHash("sha256").update(canonicalizeInvitationTerms(terms, now), "utf8").digest("hex"); }

export function createInvitationRecord(creator: Profile, recipient: Profile, terms: InvitationTerms, duelTermsHash: string, now = new Date()): Invitation {
  if (normalizeAddress(terms.creatorAddress) !== creator.walletAddress || normalizeAddress(terms.recipientAddress) !== recipient.walletAddress) throw new Error("Invitation wallets must match authenticated profiles.");
  if (!/^[0-9a-f]{64}$/u.test(duelTermsHash)) throw new Error("duelTermsHash must be a SHA-256 hex digest.");
  const canonical = canonicalizeInvitationTerms(terms, now);
  return { id: randomUUID(), creatorProfileId: creator.id, recipientProfileId: recipient.id, status: "pending", duelTermsHash, termsCanonical: canonical, termsHash: createHash("sha256").update(canonical).digest("hex"), terms, fundingStatus: "not_funded", creatorWalletAddress: creator.walletAddress, recipientWalletAddress: recipient.walletAddress, acceptedWalletAddress: null, createdAt: now.toISOString(), expiresAt: invitationExpiryFromCreation(now, terms.invitationLifetimeMinutes), respondedAt: null, fundingDeadlineAt: null, cancelledAt: null };
}

/** Test double only. It is never selected by application configuration. */
export class MemoryInvitationStore implements InvitationStore {
  private nonces = new Map<string, AuthNonce>(); private profiles = new Map<string, Profile>(); private usernames = new Map<string, string>(); private invitations = new Map<string, Invitation>();
  async createNonce(nonce: AuthNonce) { this.nonces.set(nonce.nonce, nonce); }
  async serverNow() { return new Date().toISOString(); }
  async nonceByValue(nonce: string) { const item = this.nonces.get(nonce); return item ? { ...item } : null; }
  async consumeNonce(nonce: string, walletAddress: string, now: Date) { const item = this.nonces.get(nonce); if (!item || item.usedAt || item.walletAddress !== normalizeAddress(walletAddress) || Date.parse(item.expiresAt) <= now.getTime()) return null; item.usedAt = now.toISOString(); return { ...item }; }
  async claimUsername(walletAddress: string, username: string, now: Date) { const wallet = normalizeAddress(walletAddress); const normalized = normalizeUsername(username); const current = this.profiles.get(wallet); if (current) throw new Error("USERNAME_ALREADY_CLAIMED"); const owned = this.usernames.get(normalized); if (owned) throw new Error("USERNAME_TAKEN"); const profile = { id: randomUUID(), walletAddress: wallet, username: usernameSchema.parse(username).trim(), usernameNormalized: normalized, createdAt: now.toISOString(), updatedAt: now.toISOString() }; this.profiles.set(wallet, profile); this.usernames.set(normalized, wallet); return { ...profile }; }
  async profileForWallet(walletAddress: string) { const profile = this.profiles.get(normalizeAddress(walletAddress)); return profile ? { ...profile } : null; }
  async profileForUsername(username: string) { const wallet = this.usernames.get(normalizeUsername(username)); const profile = wallet ? this.profiles.get(wallet) : null; return profile ? { username: profile.username, walletAddress: profile.walletAddress } : null; }
  async createInvitation(invitation: Invitation) { if (this.invitations.has(invitation.id)) throw new Error("INVITATION_EXISTS"); for (const item of this.invitations.values()) if (item.status === "pending" && Date.parse(item.expiresAt) <= Date.parse(invitation.createdAt)) item.status = "expired"; if ([...this.invitations.values()].some((item) => item.status === "pending" && item.creatorWalletAddress === invitation.creatorWalletAddress && item.recipientWalletAddress === invitation.recipientWalletAddress && item.duelTermsHash === invitation.duelTermsHash)) throw new Error("DUPLICATE_PENDING_INVITATION"); this.invitations.set(invitation.id, structuredClone(invitation)); return structuredClone(invitation); }
  async invitationById(id: string) { const invitation = this.invitations.get(id); return invitation ? structuredClone(invitation) : null; }
  async invitationsForRecipient(profileId: string) { return [...this.invitations.values()].filter((item) => item.recipientProfileId === profileId).map((item) => structuredClone(item)); }
  async invitationsForCreator(profileId: string) { return [...this.invitations.values()].filter((item) => item.creatorProfileId === profileId).map((item) => structuredClone(item)); }
  async transitionInvitation(id: string, actorProfileId: string, actorWalletAddress: string, action: "accept" | "reject" | "cancel", now: Date) { const item = this.invitations.get(id); if (!item) throw new Error("INVITATION_NOT_FOUND"); const wallet = normalizeAddress(actorWalletAddress); if (item.status === "pending" && Date.parse(item.expiresAt) <= now.getTime()) item.status = "expired"; if (item.status !== "pending") throw new Error("INVITATION_NOT_PENDING"); if (action === "cancel") { if (item.creatorProfileId !== actorProfileId || item.creatorWalletAddress !== wallet) throw new Error("UNAUTHORIZED_INVITATION_ACTION"); item.status = "cancelled"; item.cancelledAt = now.toISOString(); } else { if (item.recipientProfileId !== actorProfileId || item.recipientWalletAddress !== wallet) throw new Error("UNAUTHORIZED_INVITATION_ACTION"); item.status = action === "accept" ? "accepted" : "rejected"; item.respondedAt = now.toISOString(); if (action === "accept") { item.acceptedWalletAddress = wallet; item.fundingDeadlineAt = fundingDeadlineFromAcceptance(now, item.terms.outcomeDeadlineUtc); } } return structuredClone(item); }
}
