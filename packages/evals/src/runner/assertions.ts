import type { Expected } from './case.js'

/**
 * Deterministic assertions (ADR-0011). Each assertion is a pure function
 * that returns a `CheckResult`. LLM-judge assertions live in `judge.ts`.
 *
 * The set is intentionally small. Add a new assertion kind only when the
 * need is concrete — cases stored in JSONL today must remain parseable by
 * the `case.ts` schema. Adding here without updating the schema = silent
 * drop.
 */

export interface CheckResult {
  /** Short machine label — `contains`, `forbidden`, etc. */
  kind: string
  passed: boolean
  /** Human-readable one-line summary. Empty when passed. */
  detail: string
}

const ok = (kind: string): CheckResult => ({ kind, passed: true, detail: '' })

const fail = (kind: string, detail: string): CheckResult => ({
  kind,
  passed: false,
  detail,
})

/** `contains` — every listed substring must appear verbatim (case-sensitive). */
export const checkContains = (output: string, needles: readonly string[]): CheckResult => {
  const missing = needles.filter((n) => !output.includes(n))
  if (missing.length === 0) return ok('contains')
  return fail('contains', `missing: ${missing.map((m) => JSON.stringify(m)).join(', ')}`)
}

/** `forbidden` — none of the listed substrings may appear (case-insensitive). */
export const checkForbidden = (output: string, needles: readonly string[]): CheckResult => {
  const lower = output.toLowerCase()
  const hits = needles.filter((n) => lower.includes(n.toLowerCase()))
  if (hits.length === 0) return ok('forbidden')
  return fail('forbidden', `found: ${hits.map((h) => JSON.stringify(h)).join(', ')}`)
}

/**
 * `ends_with_signoff` — after right-trimming whitespace, the output must
 * end with `— <signoffPersona>` (em-dash + space + persona name). The
 * persona is per-agent (Concierge uses "Concierge"; Sofia will use her
 * own); the runner passes it in.
 */
export const checkEndsWithSignoff = (output: string, signoffPersona: string): CheckResult => {
  const trimmed = output.replace(/\s+$/, '')
  const target = `— ${signoffPersona}`
  if (trimmed.endsWith(target)) return ok('ends_with_signoff')
  const tail = trimmed.slice(-Math.max(target.length + 5, 24))
  return fail('ends_with_signoff', `expected ${JSON.stringify(target)} at end; got …${JSON.stringify(tail)}`)
}

/**
 * `max_sentences` — splits on sentence-ending punctuation (`.`, `!`, `?`)
 * followed by whitespace or end-of-string. Signoff line (`— Persona`) is
 * stripped before counting so "1-2 sentence + sign off" shape doesn't
 * inflate the count.
 */
export const checkMaxSentences = (
  output: string,
  limit: number,
  signoffPersona: string,
): CheckResult => {
  let body = output.replace(/\s+$/, '')
  const signoff = `— ${signoffPersona}`
  if (body.endsWith(signoff)) body = body.slice(0, body.length - signoff.length).trimEnd()
  if (body === '') return ok('max_sentences')
  // Sentence-terminators with lookahead to avoid matching inside abbreviations
  // followed directly by another letter. Imperfect but good enough for short
  // agent replies; acceptable because the cases cap at <=2 sentences.
  const parts = body
    .split(/[.!?]+(?:\s|$)/u)
    .map((s) => s.trim())
    .filter((s) => s !== '')
  if (parts.length <= limit) return ok('max_sentences')
  return fail(
    'max_sentences',
    `expected ≤${limit}, got ${parts.length} (${parts.map((p) => `"${p.slice(0, 30)}"`).join(' | ')})`,
  )
}

/** Dispatch a full `Expected` block into deterministic check results. */
export const runDeterministicChecks = (
  output: string,
  expected: Expected,
  signoffPersona: string,
): CheckResult[] => {
  const checks: CheckResult[] = []
  if (expected.contains !== undefined) checks.push(checkContains(output, expected.contains))
  if (expected.forbidden !== undefined) checks.push(checkForbidden(output, expected.forbidden))
  if (expected.ends_with_signoff === true) {
    checks.push(checkEndsWithSignoff(output, signoffPersona))
  }
  if (expected.max_sentences !== undefined) {
    checks.push(checkMaxSentences(output, expected.max_sentences, signoffPersona))
  }
  return checks
}
