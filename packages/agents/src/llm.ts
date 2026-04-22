import { Err, Ok, type Result } from '@bluecairn/core'
import { getActiveTraceId, startActiveObservation } from '@langfuse/tracing'
import { generateText as aiGenerateText, type LanguageModelV1 } from 'ai'

/**
 * LLM wrapper for @bluecairn/agents (ADR-0005).
 *
 * The ONLY entry point for calling an LLM anywhere in the codebase. Agents
 * and workers MUST NOT import `@ai-sdk/anthropic`, `@anthropic-ai/sdk`,
 * `openai`, `@google/generative-ai`, or any other provider SDK directly —
 * all LLM traffic flows through `generateText` below so we get:
 *
 *   1. Uniform Langfuse instrumentation (trace id, tokens, cost, latency).
 *   2. Normalized token + cost accounting writable to `agent_runs`.
 *   3. Typed `Result<T, LlmError>` return for ergonomic error handling at
 *      the orchestrator + agent layers.
 *   4. One place to update model pricing, add retries, or swap providers.
 *
 * See `packages/agents/README.md` for usage.
 */

export interface LlmMetadata {
  tenantId: string
  correlationId: string
  agentRunId?: string
  agentCode?: string
  /**
   * Eval suite identifier, set by the eval runner (ADR-0011).
   * Format: `<agent-code>/<suite>` — e.g. `concierge/unit`.
   * Surfaces on Langfuse traces as `metadata.eval` for groupable filtering.
   */
  eval?: string
  /**
   * Eval case identifier inside the suite (ADR-0011). Surfaces as
   * `metadata.case_id` on the Langfuse trace.
   */
  caseId?: string
}

export interface LlmCallInput {
  model: LanguageModelV1
  prompt: string
  system?: string
  maxTokens?: number
  metadata: LlmMetadata
}

export interface LlmCallOutput {
  text: string
  tokens: {
    input: number
    output: number
    total: number
  }
  costUsd: number
  modelId: string
  latencyMs: number
  langfuseTraceId: string
}

export type LlmErrorKind =
  | 'rate_limit'
  | 'context_overflow'
  | 'upstream'
  | 'timeout'
  | 'unknown'

export interface LlmError {
  kind: LlmErrorKind
  message: string
  cause?: unknown
}

/**
 * Model → USD-per-1M-tokens pricing. Source:
 * https://www.anthropic.com/pricing (sync before each model addition).
 *
 * Unknown models produce costUsd=0 with a log warning — we prefer a null
 * cost over a confidently-wrong one. Update when a new model ships.
 */
const MODEL_COSTS: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  'claude-haiku-4-5-20251001': { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  'claude-opus-4-7': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
}

const calculateCostUsd = (
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number => {
  const pricing = MODEL_COSTS[modelId]
  if (pricing === undefined) return 0
  return (
    (inputTokens * pricing.inputPerMTok + outputTokens * pricing.outputPerMTok) /
    1_000_000
  )
}

const classifyError = (err: unknown): LlmError => {
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()

  if (lower.includes('429') || lower.includes('rate limit')) {
    return { kind: 'rate_limit', message, cause: err }
  }
  if (lower.includes('context') && (lower.includes('length') || lower.includes('too long'))) {
    return { kind: 'context_overflow', message, cause: err }
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return { kind: 'timeout', message, cause: err }
  }
  if (err instanceof Error && err.name.includes('API')) {
    return { kind: 'upstream', message, cause: err }
  }
  return { kind: 'unknown', message, cause: err }
}

export const generateText = async (
  call: LlmCallInput,
): Promise<Result<LlmCallOutput, LlmError>> => {
  const observationName =
    call.metadata.agentCode !== undefined
      ? `llm.${call.metadata.agentCode}`
      : 'llm.generate'
  const start = Date.now()

  return await startActiveObservation(observationName, async () => {
    try {
      const result = await aiGenerateText({
        model: call.model,
        prompt: call.prompt,
        ...(call.system !== undefined && { system: call.system }),
        ...(call.maxTokens !== undefined && { maxTokens: call.maxTokens }),
        experimental_telemetry: {
          isEnabled: true,
          ...(call.metadata.agentCode !== undefined && {
            functionId: call.metadata.agentCode,
          }),
          metadata: {
            tenant_id: call.metadata.tenantId,
            correlation_id: call.metadata.correlationId,
            ...(call.metadata.agentRunId !== undefined && {
              agent_run_id: call.metadata.agentRunId,
            }),
            ...(call.metadata.eval !== undefined && { eval: call.metadata.eval }),
            ...(call.metadata.caseId !== undefined && {
              case_id: call.metadata.caseId,
            }),
          },
        },
      })

      const inputTokens = result.usage.promptTokens
      const outputTokens = result.usage.completionTokens
      const modelId = call.model.modelId
      const costUsd = calculateCostUsd(modelId, inputTokens, outputTokens)
      const langfuseTraceId = getActiveTraceId() ?? ''

      return Ok({
        text: result.text,
        tokens: {
          input: inputTokens,
          output: outputTokens,
          total: inputTokens + outputTokens,
        },
        costUsd,
        modelId,
        latencyMs: Date.now() - start,
        langfuseTraceId,
      })
    } catch (err) {
      return Err(classifyError(err))
    }
  })
}
