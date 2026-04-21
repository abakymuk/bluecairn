import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * One row per customer (restaurant business). Multiple physical locations
 * can belong to one tenant.
 *
 * Platform-global (no tenant_id on itself, obviously — this IS the tenant table).
 *
 * See DATA-MODEL.md § tenants.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    timezone: text('timezone').notNull().default('America/Los_Angeles'),
    currency: text('currency').notNull().default('USD'),
    status: text('status').notNull().default('active'), // active | paused | churned
    plan: text('plan').notNull().default('managed_full'), // managed_full | managed_lite (future)
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    churnedAt: timestamp('churned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_tenants_status').on(table.status).where(sql`${table.deletedAt} is null`),
  ],
)

export type Tenant = typeof tenants.$inferSelect
export type NewTenant = typeof tenants.$inferInsert
