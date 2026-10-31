import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { getWalrusMemoryService } from "../src/lib/server/walrus-memory";
import { serializeMemoryRecord } from "@/lib/memory/records";

async function main() {
  const dir = `${process.env.HOME}/stakemate-evidence/walrus-mainnet`;
  const manifest = JSON.parse(readFileSync(`${dir}/mainnet-batch.json`, "utf8"));
  const result = await getWalrusMemoryService().recallValidatedRecords("stakemate", 50);

  const expected = new Map(
    manifest.entries.map((e: { recordId: string; digest: string }) => [e.recordId, e.digest])
  );

  let matched = 0;
  for (const record of result.records) {
    const digest = createHash("sha256")
      .update(serializeMemoryRecord(record))
      .digest("hex");

    if (expected.get(record.id) === digest) matched++;
  }

  console.log(`Canonical records matched: ${matched}/${manifest.entries.length}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
