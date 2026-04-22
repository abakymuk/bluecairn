import { createDatabase, type Database } from '@bluecairn/db'
import { env } from '@/env'

/**
 * App-role Drizzle client (`bluecairn_app`, RLS-subject).
 *
 * Used by Better Auth's Drizzle adapter — the `auth_*` tables are
 * platform-global (RLS OFF), so the app role works cleanly and
 * keeps the admin-role blast radius small.
 *
 * For ops-pod data queries that span tenants (threads, messages,
 * agent_runs, audit_log), use `./db-admin.ts` instead — ops-pod is
 * cross-tenant by design and RLS on the app role would filter
 * results to a single tenant.
 */
export const db: Database = createDatabase(env.DATABASE_URL)
