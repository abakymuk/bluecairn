import { env } from '@/env'

/**
 * Is the given email part of the ops-pod allow-list?
 *
 * Case-insensitive (we lowercase both sides). Exported so both the
 * edge middleware and the server-side `(authed)` layout can run the
 * same check against the same env source of truth.
 */
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return env.OPS_WEB_ALLOWED_EMAILS.includes(email.trim().toLowerCase())
}
