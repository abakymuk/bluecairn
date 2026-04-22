import { anthropic } from '@ai-sdk/anthropic'
import { type Result } from '@bluecairn/core'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateText, type LlmCallOutput, type LlmError, type LlmMetadata } from '../llm.js'
import { guardrails as conciergeGuardrails } from './guardrails.js'
import { conciergeMeta } from './meta.js'

/**
 * Eval-callable Concierge entry point (ADR-0011).
 *
 * The Inngest-wired agent run in `apps/workers/src/functions/agent-concierge-run.ts`
 * is the production invocation path — it owns durability, policy enforcement,
 * and agent_run persistence. That path is not callable from a CLI process:
 * it requires an Inngest step runtime plus DB state that production has but
 * an eval run doesn't need.
 *
 * `runConciergeEval` is a lightweight, in-process mirror: load the authored
 * `prompt.md` (source of truth per ADR-0011 — not the DB seed), call the
 * single `generateText` we use everywhere else, and hand the caller the
 * model output. Each call passes the eval-runner-provided `LlmMetadata`
 * (with `eval` + `caseId` set — ADR-0011) so Langfuse groups the spans
 * under `metadata.eval = "concierge/unit"` / `metadata.case_id = "<id>"`.
 *
 * The function is intentionally side-effect-free: no `agent_runs` rows, no
 * `actions` rows, no `audit_log` writes. Eval runs are not real agent runs.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROMPT_PATH = join(__dirname, 'prompt.md')

/**
 * Strip YAML frontmatter between the first pair of `---` fences (if any)
 * and return the remaining body. The DB seed SQL contains the body only;
 * the authored `.md` carries frontmatter (agent / version / model / status
 * / authored_at). For eval-time prompting we want the body.
 */
const stripFrontmatter = (raw: string): string => {
  if (!raw.startsWith('---')) return raw
  // Find the closing fence on its own line — tolerate both `\n---\n` and
  // `\n---` at EOF.
  const closing = raw.indexOf('\n---', 3)
  if (closing < 0) return raw
  // Advance past `\n---` and the trailing newline (if present).
  let after = closing + 4
  if (raw.charAt(after) === '\n') after += 1
  return raw.slice(after).trimStart()
}

let cachedPromptBody: string | undefined

const loadPromptBody = (): string => {
  if (cachedPromptBody !== undefined) return cachedPromptBody
  const raw = readFileSync(PROMPT_PATH, 'utf8')
  cachedPromptBody = stripFrontmatter(raw)
  return cachedPromptBody
}

export interface ConciergeEvalInput {
  /** Raw operator message — what Telegram would have delivered. */
  input: string
  /** Pass-through metadata; the runner must set `eval` + `caseId`. */
  metadata: LlmMetadata
  /**
   * Optional override for max output tokens. Defaults to the guardrail
   * value Concierge uses in production (`conciergeGuardrails.maxOutputTokens`).
   */
  maxTokens?: number
}

export const runConciergeEval = async (
  call: ConciergeEvalInput,
): Promise<Result<LlmCallOutput, LlmError>> => {
  const maxTokens = call.maxTokens ?? conciergeGuardrails.maxOutputTokens
  return await generateText({
    model: anthropic(conciergeMeta.model),
    system: loadPromptBody(),
    prompt: call.input,
    maxTokens,
    metadata: call.metadata,
  })
}

/** Exposed for tests that want to bypass the module-level cache. */
export const __resetPromptCache = (): void => {
  cachedPromptBody = undefined
}
