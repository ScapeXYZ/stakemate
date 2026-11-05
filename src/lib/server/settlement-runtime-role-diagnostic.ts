import "server-only";

import postgres from "postgres";
import { postgresSslForDatabaseUrl } from "@/lib/server/postgres-connection-security";
import type { SettlementRuntimeRoleDiagnostic } from "@/lib/settlement-runtime-role-diagnostic-response";

/**
 * Uses the exact DATABASE_URL path used by the Vercel settlement cron. Every
 * statement is a catalog/identity SELECT; no session or database state changes.
 */
export async function settlementRuntimeRoleDiagnostic(): Promise<SettlementRuntimeRoleDiagnostic> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("SETTLEMENT_DATABASE_NOT_CONFIGURED");
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 1,
    ssl: postgresSslForDatabaseUrl(databaseUrl),
    connect_timeout: 10,
    idle_timeout: 10,
  });
  try {
    const [row] = await sql<{
      current_database: string;
      current_user: string;
      session_user: string;
      bypass_rls: boolean;
      owns_public_schema: boolean;
      can_create_public_schema: boolean;
      migration_role_membership: boolean | null;
    }[]>`
      with migration_roles as (
        select distinct applied_by
        from public.schema_migrations
        where migration_id = any(array['0002', '0003', '0004'])
      ), membership as (
        select case when count(*) = 1 then bool_or(pg_has_role(current_user, applied_by, 'member')) else null end as member
        from migration_roles
      )
      select
        current_database() as current_database,
        current_user as current_user,
        session_user as session_user,
        coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) as bypass_rls,
        coalesce((select nspowner = (select oid from pg_roles where rolname = current_user) from pg_namespace where nspname = 'public'), false) as owns_public_schema,
        has_schema_privilege(current_user, 'public', 'CREATE') as can_create_public_schema,
        (select member from membership) as migration_role_membership
    `;
    if (!row) throw new Error("SETTLEMENT_RUNTIME_ROLE_DIAGNOSTIC_EMPTY");
    return {
      currentDatabase: row.current_database,
      currentUser: row.current_user,
      sessionUser: row.session_user,
      bypassRls: row.bypass_rls,
      ownsPublicSchema: row.owns_public_schema,
      canCreatePublicSchema: row.can_create_public_schema,
      migrationRoleMembership: row.migration_role_membership,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
