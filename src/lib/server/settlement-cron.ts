import "server-only";

import { DurableSettlementWorker } from "@/lib/server/durable-settlement-worker";
import { runTestnetFixtureSettlementScan } from "@/lib/server/testnet-fixture-scanner";

/**
 * Bounded cron pass. It deliberately stops at unsigned preparation: the Slush
 * authority is the only component permitted to sign, and there is no server
 * key or unattended broadcast path.
 */
export async function runSettlementCron() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("SETTLEMENT_DATABASE_NOT_CONFIGURED");
  // Do not make a disabled queue look like a cron outage. The explicit gate is
  // also the emergency pre-activation posture: scanner, signer and broadcast
  // stay inert until an operator enables the server-side queue.
  if (process.env.STAKEMATE_DURABLE_SETTLEMENT_WORKER_ENABLED !== "true") {
    return { scanner: { observed: 0, enqueued: 0, held: 0 }, recovered: 0, prepared: 0, broadcasted: false as const, disabled: true as const };
  }
  const scanner = await runTestnetFixtureSettlementScan(databaseUrl);
  const worker = new DurableSettlementWorker(databaseUrl);
  const workerId = `vercel-cron-${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}`.slice(0, 100);
  try {
    const recovered = await worker.recoverExpiredLeases();
    let prepared = 0;
    for (let index = 0; index < 10; index += 1) {
      const job = await worker.claim(workerId);
      if (!job) break;
      await worker.prepare(job.id, workerId);
      prepared += 1;
    }
    return { scanner, recovered: recovered.length, prepared, broadcasted: false as const, disabled: false as const };
  } finally {
    await worker.close();
  }
}
