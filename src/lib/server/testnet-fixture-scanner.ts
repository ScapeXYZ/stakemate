import "server-only";

import { DurableFixtureSettlementScanner } from "@/lib/server/durable-fixture-settlement-scanner";
import { DurableSettlementWorker } from "@/lib/server/durable-settlement-worker";
import { PostgresFixtureScannerStore } from "@/lib/server/postgres-fixture-scanner-store";

/** One short, stateless cron pass. PostgreSQL contains all progress, so a
 * missed Cloudflare/Vercel invocation is harmless: the next pass resumes it. */
export async function runTestnetFixtureSettlementScan(databaseUrl: string) {
  const store = new PostgresFixtureScannerStore(databaseUrl);
  const queue = new DurableSettlementWorker(databaseUrl);
  try {
    return await new DurableFixtureSettlementScanner(store, queue).scanOnce();
  } finally {
    await Promise.all([store.close(), queue.close()]);
  }
}
