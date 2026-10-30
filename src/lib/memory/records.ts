import { z } from "zod";

const base = z.object({
  id: z.string().uuid(),
  occurredAt: z.string().datetime(),
  challengeId: z.string().min(1).max(128),
  actorId: z.string().min(1).max(128),
  /** Origin evidence is attached by the producing server, never supplied by a client. */
  provenance: z.object({ source: z.string().min(1).max(80), sourceRef: z.string().min(1).max(200), verifiedAt: z.string().datetime(), commitmentHash: z.string().regex(/^0x[0-9a-f]{64}$/i).optional() }).strict().optional(),
}).strict();

export const challengeCreatedRecord = base.extend({ type: z.literal("challenge.created"), fixture: z.string().min(1).max(200), market: z.string().min(1).max(100), deadline: z.string().datetime(), termsHash: z.string().regex(/^0x[0-9a-f]{64}$/i).optional() });
export const challengeAcceptedRecord = base.extend({ type: z.literal("challenge.accepted"), accepterId: z.string().min(1).max(128), stakeMist: z.string().regex(/^\d+$/).optional() });
export const challengeOutcomeRecord = base.extend({ type: z.literal("challenge.outcome"), outcome: z.enum(["creator_won", "opponent_won", "tie_void"]), authorityId: z.string().min(1).max(128), evidenceRef: z.string().min(1).max(200) });
export const challengeRefundedRecord = base.extend({ type: z.literal("challenge.refunded"), reason: z.enum(["creator_cancelled", "funding_expired", "outcome_unreported", "tie_void"]), creatorRefundMist: z.string().regex(/^\d+$/), opponentRefundMist: z.string().regex(/^\d+$/) });
/** Retained only for compatibility with the earlier prototype schema. */
export const predictionOutcomeRecord = base.extend({ type: z.literal("prediction.outcome"), outcome: z.enum(["won", "lost", "void", "unresolved"]), source: z.string().min(1).max(200) });
export const reputationInsightRecord = base.extend({ type: z.literal("reputation.insight"), subjectId: z.string().min(1).max(128), insight: z.string().min(1).max(1000), confidence: z.number().min(0).max(1) });

/** Schema-v2 records make the learning loop explicit without storing wallet secrets. */
export const playerPredictionRecord = base.extend({ type: z.literal("player.prediction"), playerId: z.string().min(1).max(128), fixtureId: z.string().min(1).max(128), competitionCode: z.string().min(1).max(16), selection: z.enum(["home_win", "draw", "away_win"]), confidence: z.number().min(0).max(1) });
export const challengeHistoryRecord = base.extend({ type: z.literal("challenge.history"), status: z.enum(["created", "accepted", "rejected", "cancelled", "expired", "settled", "voided"]), participantIds: z.tuple([z.string().min(1).max(128), z.string().min(1).max(128)]), termsHash: z.string().regex(/^0x[0-9a-f]{64}$/i), fixtureId: z.string().min(1).max(128) });
export const matchResultRecord = base.extend({ type: z.literal("match.result"), fixtureId: z.string().min(1).max(128), competitionCode: z.string().min(1).max(16), homeScore: z.number().int().min(0), awayScore: z.number().int().min(0), result: z.enum(["home_win", "draw", "away_win"]), evidenceRef: z.string().min(1).max(200) });
export const playerCredibilityScoreRecord = base.extend({ type: z.literal("player.credibility_score"), playerId: z.string().min(1).max(128), score: z.number().min(0).max(100), sampleSize: z.number().int().min(0), methodology: z.string().min(1).max(200) });
export const agentLearningRecord = base.extend({ type: z.literal("agent.learning"), subject: z.string().min(1).max(128), lesson: z.string().min(1).max(1000), confidence: z.number().min(0).max(1), evidenceRefs: z.array(z.string().min(1).max(200)).min(1).max(10) });

export const memoryRecordSchema = z.discriminatedUnion("type", [challengeCreatedRecord, challengeAcceptedRecord, challengeOutcomeRecord, challengeRefundedRecord, predictionOutcomeRecord, reputationInsightRecord, playerPredictionRecord, challengeHistoryRecord, matchResultRecord, playerCredibilityScoreRecord, agentLearningRecord]);
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;
export type MemoryRecordType = MemoryRecord["type"];
export const MEMORY_SCHEMA_VERSION = 2;

/**
 * Invitation commitments are persisted in their native form.  Memory schema-v2
 * represents SHA-256 commitments as EVM-style 0x-prefixed hashes.  Normalize
 * only the emitted memory copy: neither the canonical invitation nor its
 * database value is changed.
 */
export function normalizeMemoryCommitmentHash(value: string): string {
  const hex = value.replace(/^0x/i, "");
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("MEMORY_COMMITMENT_HASH_INVALID");
  return `0x${hex.toLowerCase()}`;
}

/** Strictly validate a schema-v2 record after normalizing only hash notation. */
export function normalizeMemoryRecord(recordInput: unknown): MemoryRecord {
  if (!recordInput || typeof recordInput !== "object" || Array.isArray(recordInput)) return memoryRecordSchema.parse(recordInput);
  const input = recordInput as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...input };
  if (typeof normalized.termsHash === "string") normalized.termsHash = normalizeMemoryCommitmentHash(normalized.termsHash);
  if (normalized.provenance && typeof normalized.provenance === "object" && !Array.isArray(normalized.provenance)) {
    const provenance = normalized.provenance as Record<string, unknown>;
    normalized.provenance = { ...provenance, ...(typeof provenance.commitmentHash === "string" ? { commitmentHash: normalizeMemoryCommitmentHash(provenance.commitmentHash) } : {}) };
  }
  return memoryRecordSchema.parse(normalized);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") { const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)); return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`; }
  throw new Error("Memory records may only contain JSON values.");
}

/** Deterministic, versioned JSON used for deduplication and write evidence. */
export function serializeMemoryRecord(record: MemoryRecord): string {
  return canonicalJson({ schemaVersion: MEMORY_SCHEMA_VERSION, ...normalizeMemoryRecord(record) });
}
