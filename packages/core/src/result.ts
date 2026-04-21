/**
 * Result<T, E> — explicit success/failure type for operations that can fail.
 *
 * Use this at boundaries (tool calls, external API calls, validated input)
 * where throwing an exception would be surprising or expensive to handle.
 *
 * Internal code may still throw. Don't use Result everywhere.
 */

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok

export const mapResult = <T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> =>
  r.ok ? Ok(f(r.value)) : r

export const unwrap = <T, E>(r: Result<T, E>): T => {
  if (r.ok) return r.value
  throw r.error instanceof Error ? r.error : new Error(String(r.error))
}
