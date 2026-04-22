import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { authUser } from './auth-user.js'

/**
 * Better Auth `account` table — mapped to `auth_account`.
 *
 * One row per (user, OAuth provider) tuple. Stores issuer tokens the
 * session depends on. `accountId` is the provider's own user id
 * (e.g. Google's `sub`), distinct from our `auth_user.id`.
 *
 * For BlueCairn M1 we only use Google OAuth, so `password` / email-link
 * columns stay null. We keep them on-schema per Better Auth's expected
 * shape so switching providers later is a config-only change.
 */
export const authAccount = pgTable(
  'auth_account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_auth_account_user').on(table.userId)],
)

export type AuthAccount = typeof authAccount.$inferSelect
export type NewAuthAccount = typeof authAccount.$inferInsert
