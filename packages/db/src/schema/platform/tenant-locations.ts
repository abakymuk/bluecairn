import { date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

/**
 * A tenant may run multiple physical locations. Each has its own POS,
 * staff, and inventory. See DATA-MODEL.md § tenant_locations.
 */
export const tenantLocations = pgTable(
  'tenant_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    address: text('address'),
    timezone: text('timezone').notNull(),
    // posIntegrationId references integrations.id — added in relations file later
    posIntegrationId: uuid('pos_integration_id'),
    openedAt: date('opened_at'),
    closedAt: date('closed_at'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_tenant_locations_tenant').on(table.tenantId)],
)

export type TenantLocation = typeof tenantLocations.$inferSelect
export type NewTenantLocation = typeof tenantLocations.$inferInsert
