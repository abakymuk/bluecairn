import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Humans in the system — operators, ops pod members, admins.
 *
 * Platform-global: users are NOT tenant-scoped. An ops pod member may
 * work across tenants; an operator may own multiple tenants. Tenant-level
 * access is granted via tenant_users.
 *
 * See DATA-MODEL.md § users.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique(),
  phoneE164: text('phone_e164').unique(),
  displayName: text('display_name').notNull(),
  type: text('type').notNull(), // operator | ops_pod | admin
  locale: text('locale').default('en-US'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
