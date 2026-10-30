import { memoryRecordSchema, type MemoryRecord } from "./records";

export type CredibilityRecommendation = {
  playerId: string;
  score: number | null;
  sampleSize: number;
  rationale: string;
  recommendation: "eligible" | "needs_more_history";
  provenance: { recordIds: string[]; retrievedAt: string };
};

/**
 * This consumes only schema-validated records returned by Memory. It deliberately
 * makes no claim that a recall result is an on-chain fact or a settlement signal.
 */
export function recommendFromCredibilityMemories(playerId: string, recalled: readonly unknown[], retrievedAt = new Date().toISOString()): CredibilityRecommendation {
  const scores = recalled.map((value) => memoryRecordSchema.safeParse(value)).filter((result): result is { success: true; data: MemoryRecord } => result.success).map((result) => result.data).filter((record): record is Extract<MemoryRecord, { type: "player.credibility_score" }> => record.type === "player.credibility_score" && record.playerId === playerId);
  if (scores.length === 0) return { playerId, score: null, sampleSize: 0, rationale: "No verified credibility memory was retrieved; do not personalize the recommendation.", recommendation: "needs_more_history", provenance: { recordIds: [], retrievedAt } };
  const latest = [...scores].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0]!;
  return { playerId, score: latest.score, sampleSize: latest.sampleSize, rationale: `Retrieved credibility score using ${latest.methodology}.`, recommendation: latest.sampleSize >= 5 ? "eligible" : "needs_more_history", provenance: { recordIds: [latest.id], retrievedAt } };
}
