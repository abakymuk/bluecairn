import { createDatabase, type Database } from '@bluecairn/db'
import { env } from '@/env'

/**
 * Admin-role Drizzle client for ops-pod data queries (BLU-27).
 *
 * Uses `bluecairn_admin` (table owner, bypasses RLS) rather than
 * `bluecairn_app` (the RLS-subject role). Required because ops-pod
 * operators read across all tenants — RLS policies against
 * `app.current_tenant` would filter results to a single tenant, which
 * is the opposite of what we need for cross-tenant triage.
 *
 * Authorization of who can run these queries lives in middleware +
 * authed layout (email allow-list), NOT at the row level. Each fetch
 * also writes an `audit_log` entry so the cross-tenant reads are
 * auditable.
 *
 * Better Auth's `lib/auth.ts` uses `lib/db.ts` (the app role) because
 * `auth_*` tables don't have RLS — keeps the admin-role blast radius
 * minimal.
 */
export const dbAdmin: Database = createDatabase(env.DATABASE_URL_ADMIN)
