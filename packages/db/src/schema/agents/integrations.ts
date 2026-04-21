import { sql } from 'drizzle-orm'
import { customType, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tenantLocations } from '../platform/tenant-locations.js'
import { tenants } from '../platform/tenants.js'

// Custom type for bytea (encrypted credentials)
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

/**
 * Per-tenant connections to external systems (POS, accounting, etc.).
 * Credentials are encrypted at rest via app-layer KMS before storage.
 *
 * See DATA-MODEL.md § integrations.
 */
export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tenantLocationId: uuid('tenant_location_id').references(() => tenantLocations.id),
    provider: text('provider').notNull(), // 'square', 'quickbooks', 'toast', 'telegram', ...
    kind: text('kind').notNull(), // 'pos', 'accounting', 'scheduling', 'comms', ...
    status: text('status').notNull().default('pending'), // pending | active | expired | revoked
    credentialsEncrypted: bytea('credentials_encrypted'),
    externalAccountId: text('external_account_id'),
    scopes: text('scopes').array(),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastError: text('last_error'),
    config: jsonb('config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_integrations_tenant')
      .on(table.tenantId)
      .where(sql`${table.status} = 'active'`),
  ],
)

export type Integration = typeof integrations.$inferSelect
export type NewIntegration = typeof integrations.$inferInsert
