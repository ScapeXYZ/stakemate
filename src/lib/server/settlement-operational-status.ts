import "server-only";

import postgres from "postgres";
import { postgresSslForDatabaseUrl } from "@/lib/server/postgres-connection-security";

const requiredRuntimeTables = [
  "stakemate_testnet_scanner_checkpoint",
  "stakemate_testnet_observed_events",
  "stakemate_testnet_challenge_attestations",
  "stakemate_testnet_duel_registrations",
  "stakemate_testnet_duel_links",
  "stakemate_testnet_correction_windows",
] as const;

type StatusOptions = { databaseUrl?: string; durableWorkerEnabled?: boolean };

/**
 * Read-only, aggregate readiness probe. This module must never import the
 * scanner, queue worker, transaction builders, outcome authority, or a signer.
 */
export async function settlementOperationalStatus(options: StatusOptions = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL?.trim();
  const durableWorkerEnabled = options.durableWorkerEnabled ?? process.env.STAKEMATE_DURABLE_SETTLEMENT_WORKER_ENABLED === "true";
  if (!databaseUrl) {
    return {
      ok: false,
      databaseConfigured: false,
      durableWorkerEnabled,
      emergencyPaused: null,
      runtimeSchemaReady: false,
      jobCounts: null,
    };
  }

  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 1,
    ssl: postgresSslForDatabaseUrl(databaseUrl),
    connect_timeout: 10,
    idle_timeout: 10,
  });
  try {
    const relations = await sql<{ relname: string }[]>`
      select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname = any(${requiredRuntimeTables})
    `;
    const runtimeSchemaReady = relations.length === requiredRuntimeTables.length;
    const [control] = await sql<{ emergency_paused: boolean }[]>`
      select emergency_paused from public.stakemate_settlement_control where singleton = true
    `;
    const [counts] = await sql<{ pending: number; retryWait: number; leased: number; prepared: number; broadcastPending: number; confirmed: number; failed: number }[]>`
      select
        count(*) filter (where status = 'pending')::int as pending,
        count(*) filter (where status = 'retry_wait')::int as "retryWait",
        count(*) filter (where status = 'leased')::int as leased,
        count(*) filter (where status = 'prepared')::int as prepared,
        count(*) filter (where status = 'broadcast_pending')::int as "broadcastPending",
        count(*) filter (where status = 'confirmed')::int as confirmed,
        count(*) filter (where status = 'failed')::int as failed
      from public.stakemate_settlement_jobs
    `;
    return {
      ok: Boolean(control) && runtimeSchemaReady,
      databaseConfigured: true,
      durableWorkerEnabled,
      emergencyPaused: control?.emergency_paused ?? null,
      runtimeSchemaReady,
      jobCounts: counts ?? null,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
