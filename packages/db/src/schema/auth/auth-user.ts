import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Better Auth `user` table — mapped to `auth_user` at the DB layer to keep
 * auth infrastructure clearly separate from domain `users` (the ops-pod
 * platform user registry that joins through `tenant_users`).
 *
 * Platform-global — RLS NOT applied. An ops-pod operator logs in to
 * ops-web once and has cross-tenant read access (filtered in-app by
 * `tenant_users`, not by RLS on the auth rows).
 *
 * Schema fields mirror Better Auth v1.3's canonical user shape. Do NOT
 * add domain columns here — keep this pure auth. Domain extensions land
 * on `platform/users.ts` or a future bridge table.
 *
 * Linkage to domain `users`: via email match at login time (see
 * `apps/ops-web/src/lib/auth.ts`). When a future ticket models ops-pod
 * membership explicitly, we'll add `ops_pod_members (auth_user_id →
 * auth_user.id, user_id → users.id)`.
 */
export const authUser = pgTable('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type AuthUser = typeof authUser.$inferSelect
export type NewAuthUser = typeof authUser.$inferInsert
