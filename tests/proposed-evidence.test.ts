import assert from "node:assert/strict";
import test from "node:test";
import { proposedWalrusEvidenceRecords } from "../src/lib/memory/proposed-evidence";
import { MemoryReceiptStore, WalrusMemoryService } from "../src/lib/server/walrus-memory";

test("proposed Walrus evidence contains ten truthful, unwritten canonical records", async () => {
  assert.equal(proposedWalrusEvidenceRecords.length, 10);
  assert.equal(proposedWalrusEvidenceRecords.every((entry) => entry.status === "proposed-unwritten" && entry.record.type === "reputation.insight"), true);
  const service = new WalrusMemoryService(async () => { throw new Error("proposed evidence dry run must not create a client"); }, new MemoryReceiptStore(), false);
  const result = await service.dryRun(proposedWalrusEvidenceRecords.map((entry) => entry.record));
  assert.equal(result.uniqueCount, 10); assert.equal(result.duplicateCount, 0);
});
