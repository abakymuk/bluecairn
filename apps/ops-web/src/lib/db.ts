import { createDatabase, type Database } from '@bluecairn/db'
import { env } from '@/env'

/**
 * Shared Drizzle database instance for ops-web server code.
 *
 * Uses the RLS-subject role (`DATABASE_URL` / `bluecairn_app`) — every
 * tenant-scoped query must flow through `withTenant(db, ctx, ...)`.
 * For platform-global reads (auth_*, agent_definitions, tenants) this
 * same client works since those tables have RLS OFF.
 *
 * Better Auth's drizzle adapter uses this instance to manage its own
 * `auth_*` tables (see `./auth.ts`).
 */
export const db: Database = createDatabase(env.DATABASE_URL)
