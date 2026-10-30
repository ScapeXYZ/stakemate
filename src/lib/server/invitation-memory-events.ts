import { createHash } from "node:crypto";
import type { CanonicalInvitation } from "@/lib/server/canonical-invitation-persistence";
import { normalizeMemoryCommitmentHash, normalizeMemoryRecord, type MemoryRecord } from "@/lib/memory/records";

/**
 * Converts already-persisted invitation facts into schema-v2 Walrus candidates.
 * It is intentionally pure: building a review queue never writes to Walrus,
 * PostgreSQL, a wallet, or a chain. IDs are deterministic so retries produce
 * the exact same canonical bytes and Mainnet idempotency key.
 */
function deterministicUuid(seed: string) {
  const bytes = createHash("sha256").update(seed, "utf8").digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // RFC 4122 version 5 layout
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function eventId(invitation: CanonicalInvitation, event: string, actorId = "") {
  return deterministicUuid(`stakemate.memory.v2\n${invitation.id}\n${invitation.coreHash}\n${event}\n${actorId}`);
}

function provenance(invitation: CanonicalInvitation, verifiedAt: string) {
  return { source: "canonical_postgres_invitation", sourceRef: `invitation:${invitation.id}`, verifiedAt, commitmentHash: normalizeMemoryCommitmentHash(invitation.coreHash) };
}

const historyStatus = (status: CanonicalInvitation["status"]): Extract<MemoryRecord, { type: "challenge.history" }>["status"] => status === "accepted" ? "accepted" : status === "rejected" ? "rejected" : status === "cancelled" ? "cancelled" : "expired";

export function invitationMemoryEvents(invitation: CanonicalInvitation): MemoryRecord[] {
  const predictionCommon = { challengeId: invitation.id, fixtureId: invitation.core.fixtureId, competitionCode: invitation.core.competitionCode };
  const historyCommon = { challengeId: invitation.id, fixtureId: invitation.core.fixtureId };
  const creator = invitation.creatorProfileId;
  const recipient = invitation.recipientProfileId;
  const createdAt = invitation.createdAtUtc;
  const records: MemoryRecord[] = [
    { id: eventId(invitation, "prediction.created", creator), occurredAt: createdAt, actorId: creator, type: "player.prediction", playerId: creator, selection: invitation.core.creatorSelection, confidence: 0.5, ...predictionCommon, provenance: provenance(invitation, createdAt) },
    { id: eventId(invitation, "prediction.created", recipient), occurredAt: createdAt, actorId: creator, type: "player.prediction", playerId: recipient, selection: invitation.core.opponentSelection, confidence: 0.5, ...predictionCommon, provenance: provenance(invitation, createdAt) },
    { id: eventId(invitation, "invitation.created"), occurredAt: createdAt, actorId: creator, type: "challenge.history", status: "created", participantIds: [creator, recipient], termsHash: normalizeMemoryCommitmentHash(invitation.coreHash), ...historyCommon, provenance: provenance(invitation, createdAt) },
  ];
  if (invitation.status !== "pending") {
    const occurredAt = invitation.statusChangedAtUtc;
    records.push({ id: eventId(invitation, `invitation.${invitation.status}`), occurredAt, actorId: invitation.status === "cancelled" ? creator : recipient, type: "challenge.history", status: historyStatus(invitation.status), participantIds: [creator, recipient], termsHash: normalizeMemoryCommitmentHash(invitation.coreHash), ...historyCommon, provenance: provenance(invitation, occurredAt) });
  }
  return records.map(normalizeMemoryRecord);
}

/** A verified football-data.org result can be queued only after provider validation. */
export function verifiedMatchResultMemoryEvent(input: { invitation: CanonicalInvitation; verifiedAt: string; homeScore: number; awayScore: number; evidenceRef: string }): MemoryRecord {
  const { invitation, verifiedAt, homeScore, awayScore, evidenceRef } = input;
  const result = homeScore === awayScore ? "draw" : homeScore > awayScore ? "home_win" : "away_win";
  return normalizeMemoryRecord({ id: eventId(invitation, `result.${homeScore}.${awayScore}`), occurredAt: verifiedAt, challengeId: invitation.id, actorId: "football-data.org", type: "match.result", fixtureId: invitation.core.fixtureId, competitionCode: invitation.core.competitionCode, homeScore, awayScore, result, evidenceRef, provenance: { source: "football-data.org/v4", sourceRef: evidenceRef, verifiedAt, commitmentHash: normalizeMemoryCommitmentHash(invitation.coreHash) } });
}

export function uniqueInvitationMemoryEvents(invitations: readonly CanonicalInvitation[]) {
  const events = new Map<string, MemoryRecord>();
  for (const invitation of invitations) for (const record of invitationMemoryEvents(invitation)) events.set(record.id, record);
  return [...events.values()].sort((left, right) => left.id.localeCompare(right.id));
}
