import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { authUser } from './auth-user.js'

/**
 * Better Auth `session` table — mapped to `auth_session`.
 *
 * Short-lived row per browser. `token` is the opaque cookie value the
 * client holds; `expiresAt` is the absolute deadline Better Auth
 * enforces on lookup. `ipAddress` + `userAgent` are captured at login
 * for audit / anomaly detection (future Linear ticket).
 */
export const authSession = pgTable(
  'auth_session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_auth_session_user').on(table.userId)],
)

export type AuthSession = typeof authSession.$inferSelect
export type NewAuthSession = typeof authSession.$inferInsert
