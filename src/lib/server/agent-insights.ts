import { createHash } from "node:crypto";
import { MemoryRecord, serializeMemoryRecord } from "@/lib/memory/records";
import { uniqueInvitationMemoryEvents } from "./invitation-memory-events";
import type { CanonicalInvitation } from "./canonical-invitation-persistence";
import { MemoryReceipt, ReceiptStore } from "./walrus-memory";

export type VerifiedMemoryEvidence = { record: MemoryRecord; digest: string; blobId: string; receipt: MemoryReceipt };
export type AgentInsight = { mode: "deterministic_evidence_based"; recommendation: "insufficient_verified_evidence" | "outcomes_available_no_accuracy_claim"; reasoning: string; comparison: { withoutMemory: string; withMemory: string }; evidence: VerifiedMemoryEvidence[]; rejectedRecallCount: number; categories: { predictions: number; invitations: number; verifiedOutcomes: number; credibilityScores: number; learningNotes: number }; tatum: { used: false; explanation: string } };
export const memoryDigest = (record: MemoryRecord) => createHash("sha256").update(serializeMemoryRecord(record)).digest("hex");

/** Private insight results are limited to the signed-in wallet and public results linked to its own memories. */
export function recordsForWallet(records: readonly MemoryRecord[], walletAddress: string) {
  const wallet = walletAddress.toLowerCase();
  const owned = records.filter((record) => record.actorId.toLowerCase() === wallet || (record.type === "player.prediction" && record.playerId.toLowerCase() === wallet) || (record.type === "player.credibility_score" && record.playerId.toLowerCase() === wallet) || (record.type === "challenge.history" && record.participantIds.some((participant) => participant.toLowerCase() === wallet)));
  const challenges = new Set(owned.map((record) => record.challengeId)); const fixtures = new Set(owned.flatMap((record) => record.type === "player.prediction" || record.type === "challenge.history" ? [record.fixtureId] : []));
  return records.filter((record) => owned.includes(record) || ((record.type === "match.result" || record.type === "prediction.outcome") && (challenges.has(record.challengeId) || (record.type === "match.result" && fixtures.has(record.fixtureId)))));
}

/**
 * Establishes private-memory ownership from the authenticated wallet's
 * persisted canonical invitations, rather than a recalled profile string.
 * Exact regenerated invitation events are accepted. Later public outcome
 * records are accepted only when their invitation and immutable commitment
 * also match the authenticated wallet's canonical record.
 */
export function recordsForCanonicalInvitations(records: readonly MemoryRecord[], invitations: readonly CanonicalInvitation[]) {
  const expected = new Set(uniqueInvitationMemoryEvents(invitations).map(serializeMemoryRecord));
  const invitationsById = new Map(invitations.map((invitation) => [invitation.id, invitation]));
  return records.filter((record) => {
    if (expected.has(serializeMemoryRecord(record))) return true;
    const invitation = invitationsById.get(record.challengeId);
    if (!invitation || record.provenance?.commitmentHash?.toLowerCase() !== `0x${invitation.coreHash.replace(/^0x/i, "").toLowerCase()}`) return false;
    if (record.type === "match.result") return record.fixtureId === invitation.core.fixtureId && record.competitionCode === invitation.core.competitionCode;
    return record.type === "prediction.outcome" || record.type === "challenge.outcome" || record.type === "challenge.refunded";
  });
}

/** Recalled content is not evidence unless its ID, digest, and completed blob receipt all agree. */
export async function receiptVerifiedEvidence(records: readonly MemoryRecord[], receipts: ReceiptStore) {
  const evidence: VerifiedMemoryEvidence[] = [];
  for (const record of records) { const digest = memoryDigest(record); const receipt = await receipts.get(digest); if (receipt?.status === "completed" && receipt.recordId === record.id && receipt.digest === digest && receipt.blobId) evidence.push({ record, digest, blobId: receipt.blobId, receipt }); }
  return evidence;
}
export async function analyzeAgentMemories(records: readonly MemoryRecord[], receipts: ReceiptStore): Promise<AgentInsight> {
  const evidence = await receiptVerifiedEvidence(records, receipts); const categories = { predictions: 0, invitations: 0, verifiedOutcomes: 0, credibilityScores: 0, learningNotes: 0 };
  for (const { record } of evidence) { if (record.type === "player.prediction") categories.predictions++; else if (record.type === "challenge.history" || record.type.startsWith("challenge.")) categories.invitations++; else if (record.type === "match.result" || record.type === "prediction.outcome") categories.verifiedOutcomes++; else if (record.type === "player.credibility_score") categories.credibilityScores++; else if (record.type === "agent.learning" || record.type === "reputation.insight") categories.learningNotes++; }
  const withoutMemory = "Without receipt-verified Walrus Memory, do not personalize a football-duel recommendation.";
  const withMemory = evidence.length === 0 ? "No recalled record has matching completed Mainnet receipt evidence; do not use it for a recommendation." : categories.verifiedOutcomes === 0 ? `Receipt-verified memory confirms ${categories.predictions} prediction(s) and ${categories.invitations} invitation event(s), but no verified match outcome. Prediction accuracy is not assessed.` : `Receipt-verified memory includes ${categories.verifiedOutcomes} verified outcome record(s). It can qualify context, but this view does not calculate prediction accuracy or performance.`;
  return { mode: "deterministic_evidence_based", recommendation: categories.verifiedOutcomes ? "outcomes_available_no_accuracy_claim" : "insufficient_verified_evidence", reasoning: withMemory, comparison: { withoutMemory, withMemory }, evidence, rejectedRecallCount: records.length - evidence.length, categories, tatum: { used: false, explanation: "Tatum was not queried: it can provide read-only Sui chain evidence, but it cannot verify football fixtures or match results." } };
}
export class AgentInsightsRateLimiter { private readonly attempts = new Map<string, { count: number; resetAt: number }>(); constructor(private readonly limit = 6, private readonly windowMs = 60_000) {} allow(subject: string, now = Date.now()) { const current = this.attempts.get(subject); if (!current || current.resetAt <= now) { this.attempts.set(subject, { count: 1, resetAt: now + this.windowMs }); return true; } if (current.count >= this.limit) return false; current.count++; return true; } }
