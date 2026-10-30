import assert from "node:assert/strict";
import test from "node:test";
import { memoryRecordSchema, serializeMemoryRecord } from "../src/lib/memory/records";

const base = { id: "71c6a3d1-9041-4947-b4cc-3779453f1daa", occurredAt: "2026-01-01T00:00:00.000Z", challengeId: "0xchallenge", actorId: "0xactor" };

test("canonical memory records are deterministic regardless of object field order", () => {
  const record = memoryRecordSchema.parse({ ...base, type: "challenge.refunded", reason: "funding_expired", creatorRefundMist: "100", opponentRefundMist: "0" });
  const reordered = memoryRecordSchema.parse({ opponentRefundMist: "0", reason: "funding_expired", ...base, creatorRefundMist: "100", type: "challenge.refunded" });
  assert.equal(serializeMemoryRecord(record), serializeMemoryRecord(reordered));
});

test("lifecycle and reputation record types validate their required evidence", () => {
  assert.doesNotThrow(() => memoryRecordSchema.parse({ ...base, type: "challenge.outcome", outcome: "creator_won", authorityId: "authority", evidenceRef: "https://example.invalid/evidence" }));
  assert.throws(() => memoryRecordSchema.parse({ ...base, type: "challenge.outcome", outcome: "won" }));
  assert.doesNotThrow(() => memoryRecordSchema.parse({ ...base, type: "reputation.insight", subjectId: "subject", insight: "Transparent demo insight", confidence: 0.5 }));
});
