import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth'

/**
 * Better Auth catchall route — handles `/api/auth/*` for sign in,
 * callback, sign out, session fetch, and every Better Auth endpoint.
 * Do not add custom logic here; extend `auth` in `src/lib/auth.ts`.
 */
export const { GET, POST } = toNextJsHandler(auth)
