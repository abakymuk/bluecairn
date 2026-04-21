import type { TenantContext } from '@bluecairn/core'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from './schema/index.js'

export type Database = ReturnType<typeof drizzle<typeof schema>>

export const createDatabase = (connectionString: string): Database => {
  const client = postgres(connectionString, { max: 10, prepare: false })
  return drizzle(client, { schema, logger: process.env.NODE_ENV === 'development' })
}

/**
 * Run a callback with the tenant context set for RLS.
 * Uses `set local` so the setting is transaction-scoped.
 *
 * Every query that touches tenant-scoped tables MUST be wrapped in this.
 * Without it, RLS silently returns zero rows — not an error, just empty results.
 */
export const withTenant = async <T>(
  db: Database,
  ctx: TenantContext,
  fn: (tx: Database) => Promise<T>,
): Promise<T> => {
  return db.transaction(async (tx) => {
    // `SET LOCAL` cannot bind parameters, so use the functional form
    // set_config(name, value, is_local=true) which accepts them.
    await tx.execute(sql`select set_config('app.current_tenant', ${ctx.tenantId}, true)`)
    await tx.execute(
      sql`select set_config('app.correlation_id', ${ctx.correlationId}, true)`,
    )
    // Drizzle types PgTransaction separately from PostgresJsDatabase. At runtime
    // they expose the same query API we use here; the missing `$client` is not
    // reached during transaction callbacks.
    return fn(tx as unknown as Database)
  })
}

export { schema }
