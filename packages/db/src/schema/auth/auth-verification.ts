import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Better Auth `verification` table — mapped to `auth_verification`.
 *
 * Ephemeral rows for email / OTP / magic-link verification challenges.
 * Not used by M1 (we only have Google OAuth which handles email
 * verification itself). Kept on-schema per Better Auth's expected shape
 * so future email-flow features work without a schema migration.
 */
export const authVerification = pgTable(
  'auth_verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_auth_verification_identifier').on(table.identifier)],
)

export type AuthVerification = typeof authVerification.$inferSelect
export type NewAuthVerification = typeof authVerification.$inferInsert
