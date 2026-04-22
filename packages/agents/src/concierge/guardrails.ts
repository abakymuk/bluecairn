/**
 * Static pre-execution checks applied before the Concierge LLM call.
 *
 * For M1 these are minimal — Concierge doesn't use tool-calling, so
 * `maxToolCalls` is informational. The only enforced guardrail is
 * `maxOutputTokens` (passed to `generateText` as `maxTokens`). Kept as a
 * typed config so BLU-M2+ agents can extend with domain rules
 * (e.g. "don't commit to a delivery time in vendor_ops").
 */

export const guardrails = {
  maxOutputTokens: 500,
  maxToolCallsPerRun: 1,
  temperatureCap: 0.7,
} as const

export type ConciergeGuardrails = typeof guardrails
