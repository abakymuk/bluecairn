/**
 * Display formatters for ops-web. Centralised so the timeline and future
 * admin screens render the same shape.
 *
 * Pitfalls these helpers specifically guard against (per CLAUDE.md
 * "Things that hurt"):
 *   - Postgres bigint comes back as bigint, not number. `formatStakesCents`
 *     accepts `bigint | number | null` and funnels through a bigint→number
 *     coercion that stays safe under Number.MAX_SAFE_INTEGER (9.007e15),
 *     i.e. up to ~$90 trillion. Beyond that we render "$>MAX" so we don't
 *     silently truncate.
 *   - integer `cost_cents` loses sub-cent precision on Haiku-class calls.
 *     `formatCostCents` shows "$0.00" when cents==0 and adds a hint link
 *     to Langfuse when the caller renders it; the hint lives in the UI
 *     component, not here.
 */

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const LARGE_USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  notation: 'compact',
})

const RELATIVE = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })

/** Format integer cents as `$X.XX`. Returns `"—"` for null / NaN. */
export function formatCostCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '—'
  return USD.format(cents / 100)
}

/**
 * Format bigint cents (on approval_requests.stakes_cents) as `$X.XX`.
 * Stays safe up to Number.MAX_SAFE_INTEGER cents (~$90 trillion);
 * beyond that renders `">$9,007,199,254,740.99"`.
 */
export function formatStakesCents(cents: bigint | number | null | undefined): string {
  if (cents == null) return '—'
  const bi = typeof cents === 'bigint' ? cents : BigInt(Math.trunc(cents))
  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)
  if (bi > MAX_SAFE) return `>${LARGE_USD.format(Number.MAX_SAFE_INTEGER / 100)}`
  if (bi < -MAX_SAFE) return `<-${LARGE_USD.format(Number.MAX_SAFE_INTEGER / 100)}`
  return USD.format(Number(bi) / 100)
}

/** Format integer milliseconds as `Xms` / `X.Xs`. Returns `"—"` for null. */
export function formatLatencyMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m${seconds > 0 ? `${seconds}s` : ''}`
}

/**
 * Format a Date (or ISO string / epoch ms) as a relative phrase like
 * `"2m ago"`, `"5h ago"`, `"yesterday"`. Falls back to an ISO date for
 * anything older than 7 days.
 *
 * Stable across renders: pass `now` explicitly when determinism matters
 * (e.g. in tests). In the UI it defaults to `new Date()`.
 */
export function formatRelativeTime(
  value: Date | string | number | null | undefined,
  now: Date = new Date(),
): string {
  if (value == null) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'

  const diffMs = d.getTime() - now.getTime()
  const diffSec = Math.round(diffMs / 1000)
  const absSec = Math.abs(diffSec)

  if (absSec < 60) return RELATIVE.format(diffSec, 'second')
  if (absSec < 3600) return RELATIVE.format(Math.round(diffSec / 60), 'minute')
  if (absSec < 86_400) return RELATIVE.format(Math.round(diffSec / 3600), 'hour')
  if (absSec < 7 * 86_400) return RELATIVE.format(Math.round(diffSec / 86_400), 'day')

  // Older than a week — absolute ISO date (to the minute) is more useful
  // than "3 weeks ago" when auditing an old thread.
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

/** Format input/output tokens as `X in · Y out` or `—` if both null. */
export function formatTokens(
  input: number | null | undefined,
  output: number | null | undefined,
): string {
  if (input == null && output == null) return '—'
  const fmt = (n: number | null | undefined): string => (n == null ? '?' : n.toLocaleString())
  return `${fmt(input)} in · ${fmt(output)} out`
}
