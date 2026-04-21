import { sql } from 'drizzle-orm'
import { bigint, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'
import { users } from './users.js'

/**
 * Many-to-many: users ↔ tenants with role.
 * See DATA-MODEL.md § tenant_users.
 */
export const tenantUsers = pgTable(
  'tenant_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: text('role').notNull(), // owner | manager | staff | ops_pod | viewer
    // per-action approval cap in cents; null = unlimited
    approvalLimitCents: bigint('approval_limit_cents', { mode: 'bigint' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    unique('tenant_users_tenant_user_unique').on(table.tenantId, table.userId),
    index('idx_tenant_users_tenant').on(table.tenantId).where(sql`${table.revokedAt} is null`),
    index('idx_tenant_users_user').on(table.userId).where(sql`${table.revokedAt} is null`),
  ],
)

export type TenantUser = typeof tenantUsers.$inferSelect
export type NewTenantUser = typeof tenantUsers.$inferInsert
