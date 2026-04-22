import { createAuthClient } from 'better-auth/react'

/**
 * Better Auth client SDK — used from client components (Sign in / Sign out
 * buttons, client-side session access).
 *
 * Reads `NEXT_PUBLIC_BETTER_AUTH_URL` at bundle time. We don't pass it
 * explicitly — Better Auth's default is to use the current origin, which
 * matches our deployment (same Next.js process serves the API and the
 * UI).
 *
 * The `ReturnType` annotation below is load-bearing under TS
 * `declaration: true` in the monorepo's base config — without it, the
 * compiler emits an error about the inferred type not being portable
 * across package boundaries.
 */
export const authClient: ReturnType<typeof createAuthClient> = createAuthClient()

export const { signIn, signOut, useSession } = authClient
