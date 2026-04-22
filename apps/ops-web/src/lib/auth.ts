import { schema } from '@bluecairn/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { env } from '@/env'
import { db } from '@/lib/db'

/**
 * Better Auth server-side config (BLU-26).
 *
 * Session + OAuth state lives in the monorepo Postgres via Drizzle
 * adapter (`@bluecairn/db`). We map Better Auth's default model names
 * onto our `auth_*` prefixed tables so auth infra stays clearly
 * separate from domain `users` / `tenants`.
 *
 * The Google provider is the only identity source for M1. Email
 * allow-listing is enforced at two layers:
 *   1. `middleware.ts` (edge)        — rejects sessions whose cookie
 *      holder's email is outside OPS_WEB_ALLOWED_EMAILS
 *   2. `(authed)/layout.tsx` (rsc)   — same check on the server for any
 *      page that bypasses middleware (belt-and-suspenders)
 *
 * We do NOT reject at the OAuth callback — letting the session be
 * created and then denying on request means the audit trail shows a
 * rejected login attempt. Better for ops investigation.
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.authUser,
      session: schema.authSession,
      account: schema.authAccount,
      verification: schema.authVerification,
    },
  }),

  // Better Auth defaults map to `user` / `session` / `account` /
  // `verification`. We've renamed the DB tables to `auth_*` for clarity
  // — Drizzle schema already reflects this, so no `modelName` override
  // is needed here. The adapter reads the `pgTable(...)` name off the
  // schema objects directly.

  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },

  session: {
    // 7-day session lifetime — ops pod uses this daily, so short-lived
    // sessions create unnecessary re-auth churn. Revocation is still
    // immediate via row delete in auth_session.
    expiresIn: 60 * 60 * 24 * 7,
    // Re-issue the session cookie if the request arrives within 1 day
    // of expiration. Standard Better Auth "sliding window" pattern.
    updateAge: 60 * 60 * 24,
  },

  // next-js cookie helper — essential so Better Auth can set cookies
  // from Server Actions / Route Handlers without manual forwarding.
  plugins: [nextCookies()],
})

export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>
