import { anthropic } from '@ai-sdk/anthropic'
import { TenantId, newTenantContext, type AgentRunRequestedData } from '@bluecairn/core'
import { createDatabase, schema, withTenant, type Database } from '@bluecairn/db'
import {
  conciergeGuardrails,
  conciergeMeta,
  generateText,
  type LlmCallOutput,
} from '@bluecairn/agents'
import { startActiveObservation } from '@langfuse/tracing'
import { and, eq } from 'drizzle-orm'
import { env } from '../env.js'
import { inngest } from '../inngest.js'
import { logger } from '../lib/logger.js'

/**
 * BLU-34 failure semantics (post-review fix for PR #37):
 *
 * Inngest retries the *function*, not individual `step.run` callbacks —
 * when a step callback throws, the throw bubbles out of the handler, the
 * function attempt fails, and Inngest schedules a fresh invocation.
 * Checkpointed steps replay their cached results; the failed step re-
 * runs. Only after ALL retries are exhausted does Inngest fire the
 * function's `onFailure` handler.
 *
 * PR #37 v1 wrote `agent_runs.status = 'failed'` from a per-step catch,
 * which fired on the *first* attempt — so a transient `rate_limit` that
 * Inngest would have successfully retried still flipped the row to
 * `failed` before the retry had a chance to succeed. v2 (this file)
 * moves the failure write to a dedicated `handleAgentConciergeRunFailure`
 * bound to the Inngest function's `onFailure` option. The main handler
 * lets step errors bubble unchanged; the failure handler fires exactly
 * once per exhausted-retry budget with the final error.
 *
 * Step identity survives serialization via a `[step=<name>]` prefix on
 * every thrown error message — see `wrapStepError` below. `[kind=<k>]` is
 * also embedded for LLM-origin throws so the discriminated `LlmError.kind`
 * reaches the audit log even after jsonErrorSchema drops non-standard
 * Error properties.
 */

export type ConciergeFailedStep =
  | 'load-run-context'
  | 'generate-ack'
  | 'insert-action'
  | 'finalize-agent-run'
  | 'unknown'

const FAILED_STEPS: readonly ConciergeFailedStep[] = [
  'load-run-context',
  'generate-ack',
  'insert-action',
  'finalize-agent-run',
]

/**
 * Tag an error with `[step=<name>]` and optional `[kind=<k>]` so both
 * pieces survive the jsonErrorSchema serialization boundary on the way
 * to `onFailure`. Callers throw the returned Error directly.
 */
const wrapStepError = (
  step: ConciergeFailedStep,
  message: string,
  opts: { kind?: string } = {},
): Error => {
  const kindTag = opts.kind !== undefined ? `[kind=${opts.kind}] ` : ''
  return new Error(`[step=${step}] ${kindTag}${message}`)
}

/** Pull the `[step=<name>]` tag from an error message; defaults to 'unknown'. */
export const parseFailedStep = (err: unknown): ConciergeFailedStep => {
  if (!(err instanceof Error)) return 'unknown'
  const m = err.message.match(/^\[step=([a-z-]+)\]/)
  if (m === null) return 'unknown'
  const tagged = m[1]
  if (FAILED_STEPS.includes(tagged as ConciergeFailedStep)) {
    return tagged as ConciergeFailedStep
  }
  return 'unknown'
}

/** Pull the `[kind=<k>]` tag (LLM-origin only); defaults to 'unknown'. */
const parseErrorKind = (err: unknown): string => {
  if (!(err instanceof Error)) return 'unknown'
  const m = err.message.match(/\[kind=([a-z_]+)\]/)
  return m?.[1] ?? 'unknown'
}

const extractErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

/**
 * Write the terminal `failed` state for a run — guarded UPDATE + audit
 * row in one tenant-scoped tx. Called exclusively from the `onFailure`
 * path (see `handleAgentConciergeRunFailure` below).
 *
 * Guarded UPDATE (`WHERE status = 'running'`) keeps the helper
 * idempotent under any future double-invocation of onFailure; best-
 * effort tx means an audit-path DB outage is logged and swallowed — the
 * original error is already surfaced through Inngest's function-level
 * failure path, so we never mask it.
 */
interface MarkRunFailedArgs {
  dbToUse: Database
  tenantId: string
  correlationId: string
  runId: string
  failedStep: ConciergeFailedStep
  errorKind: string
  errorMessage: string
}

const markRunFailed = async (args: MarkRunFailedArgs): Promise<void> => {
  const { dbToUse, tenantId, correlationId, runId, failedStep, errorKind, errorMessage } = args
  try {
    const ctx = newTenantContext({
      tenantId: TenantId(tenantId),
      correlationId,
    })
    await withTenant(dbToUse, ctx, async (tx) => {
      const updated = await tx
        .update(schema.agentRuns)
        .set({
          status: 'failed',
          completedAt: new Date(),
          output: {
            error_kind: errorKind,
            error_message: errorMessage,
            failed_step: failedStep,
          },
        })
        .where(and(eq(schema.agentRuns.id, runId), eq(schema.agentRuns.status, 'running')))
        .returning({ id: schema.agentRuns.id })

      if (updated.length === 0) {
        // Row already in terminal state — defensive no-op in case the
        // onFailure handler ever re-fires for the same run.
        return
      }

      await tx.insert(schema.auditLog).values({
        tenantId,
        agentRunId: runId,
        eventKind: 'agent.run_failed',
        eventSummary: `agent run failed: ${errorKind}`,
        eventPayload: {
          agent_code: 'concierge',
          failed_step: failedStep,
          error_kind: errorKind,
          error_message: errorMessage,
          correlation_id: correlationId,
        },
      })
    })
  } catch (auditErr) {
    logger.error('markRunFailed: failure-path write failed', {
      tenantId,
      correlationId,
      runId,
      failedStep,
      originalError: errorMessage,
      auditError: auditErr instanceof Error ? auditErr.message : String(auditErr),
    })
  }
}

/**
 * agent.concierge.run — the M1 catchall agent handler (BLU-23).
 *
 * Triggered by `agent.run.requested` filtered to `agent_code=='concierge'`
 * (emitted by the orchestrator — BLU-22). The function loads the prompt
 * text pinned on the agent_run, calls Haiku with the user's latest message,
 * persists an `actions` row (kind='send_message'), updates the agent_run
 * with tokens/cost/latency, then emits `action.requested` for the approval
 * gate (BLU-25) to surface the outbound via Telegram inline buttons.
 *
 * Concierge is intentionally minimal: acks every inbound with a short
 * reply, no tool-calling, no autonomy. The real domain agents (Sofia
 * vendor_ops in M2, Marco inventory in M3, etc.) will replace it on a
 * per-whitelist-basis in the orchestrator.
 *
 * Observability: body wrapped in `agent.concierge.run` Langfuse span.
 * The underlying `generateText` wrapper (BLU-20) nests `llm.concierge` as
 * a child span, and BLU-33's `tool.comms.send_message` span will nest
 * under the eventual action execution in BLU-25.
 */

const CONCIERGE_MODEL = conciergeMeta.model

const db: Database = createDatabase(env.DATABASE_URL_ADMIN)

export interface AgentConciergeRunOutput {
  run_id: string
  action_id: string
  reply_text: string
  langfuse_trace_id: string
  tokens: { input: number; output: number }
  cost_usd: number
  latency_ms: number
}

export interface ConciergeStep {
  run: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  sendEvent: (name: string, payload: { name: string; id?: string; data: unknown }) => Promise<unknown>
}

export const handleAgentConciergeRun = async (args: {
  event: { data: AgentRunRequestedData }
  step: ConciergeStep
  dbOverride?: Database
}): Promise<AgentConciergeRunOutput> => {
  const { event, step, dbOverride } = args
  const dbToUse = dbOverride ?? db
  const { tenant_id, thread_id, message_id, correlation_id, run_id, idempotency_key } = event.data
  const start = Date.now()

  return await startActiveObservation(
    'agent.concierge.run',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (span: any) => {
      span.update({
        input: { run_id, message_id, thread_id },
        metadata: {
          tenant_id,
          agent_code: 'concierge',
          run_id,
          thread_id,
          message_id,
          correlation_id,
        },
      })

      // Step 1: load agent_run + prompt content + latest message text.
      // BLU-34: step errors propagate to Inngest unchanged. The
      // function's `onFailure` handler (wired below at createFunction)
      // marks the run `failed` and writes the audit row AFTER retries
      // are exhausted — only then is the failure truly terminal. Each
      // thrown error carries `[step=<name>]` so the failure handler can
      // tag the audit row with the step that exhausted.
      interface PreloadResult {
        promptContent: string
        promptVersion: number
        messageText: string
        threadId: string
      }
      const preload = await step.run(
        'load-run-context',
        async (): Promise<PreloadResult> => {
          const ctx = newTenantContext({
            tenantId: TenantId(tenant_id),
            correlationId: correlation_id,
          })
          return await withTenant(dbToUse, ctx, async (tx) => {
            const [run] = await tx
              .select({
                id: schema.agentRuns.id,
                promptId: schema.agentRuns.promptId,
                threadId: schema.agentRuns.threadId,
              })
              .from(schema.agentRuns)
              .where(eq(schema.agentRuns.id, run_id))
              .limit(1)
            if (run === undefined) {
              throw wrapStepError(
                'load-run-context',
                `agent_run ${run_id} not found (orchestrator + concierge out of sync)`,
              )
            }

            const [prompt] = await tx
              .select({ content: schema.prompts.content, version: schema.prompts.version })
              .from(schema.prompts)
              .where(eq(schema.prompts.id, run.promptId))
              .limit(1)
            if (prompt === undefined) {
              throw wrapStepError(
                'load-run-context',
                `prompt ${run.promptId} not found for concierge run ${run_id}`,
              )
            }

            const [msg] = await tx
              .select({
                content: schema.messages.content,
                direction: schema.messages.direction,
              })
              .from(schema.messages)
              .where(eq(schema.messages.id, message_id))
              .limit(1)
            if (msg === undefined) {
              throw wrapStepError(
                'load-run-context',
                `trigger message ${message_id} not found`,
              )
            }

            return {
              promptContent: prompt.content,
              promptVersion: prompt.version,
              messageText: msg.content,
              threadId: run.threadId ?? thread_id,
            }
          })
        },
      )

      // Step 2: call Haiku. generateText (BLU-20 wrapper) opens an
      // `llm.concierge` child span automatically.
      const llm: LlmCallOutput = await step.run(
        'generate-ack',
        async (): Promise<LlmCallOutput> => {
          const result = await generateText({
            model: anthropic(CONCIERGE_MODEL),
            system: preload.promptContent,
            prompt: preload.messageText,
            maxTokens: conciergeGuardrails.maxOutputTokens,
            metadata: {
              tenantId: tenant_id,
              correlationId: correlation_id,
              agentRunId: run_id,
              agentCode: 'concierge',
            },
          })
          if (!result.ok) {
            // `[kind=<k>]` embeds the discriminated LlmError.kind in the
            // message so it survives jsonErrorSchema on the way to the
            // onFailure handler — non-standard Error properties don't.
            throw wrapStepError(
              'generate-ack',
              `concierge LLM failed: ${result.error.kind}: ${result.error.message}`,
              { kind: result.error.kind },
            )
          }
          return result.value
        },
      )

      // Step 3: insert actions row (idempotent on agent_run_id + kind).
      const actionId = await step.run('insert-action', async () => {
        const ctx = newTenantContext({
          tenantId: TenantId(tenant_id),
          correlationId: correlation_id,
        })
        return await withTenant(dbToUse, ctx, async (tx) => {
          const [existing] = await tx
            .select({ id: schema.actions.id })
            .from(schema.actions)
            .where(
              and(
                eq(schema.actions.tenantId, tenant_id),
                eq(schema.actions.agentRunId, run_id),
                eq(schema.actions.kind, 'send_message'),
              ),
            )
            .limit(1)
          if (existing !== undefined) {
            return existing.id
          }
          const [inserted] = await tx
            .insert(schema.actions)
            .values({
              tenantId: tenant_id,
              agentRunId: run_id,
              kind: 'send_message',
              payload: {
                thread_id: preload.threadId,
                text: llm.text,
              },
              policyOutcome: 'approval_required',
              status: 'pending',
            })
            .returning({ id: schema.actions.id })
          if (inserted === undefined) {
            throw wrapStepError('insert-action', 'actions insert returned no row')
          }
          return inserted.id
        })
      })

      // Step 4: finalize agent_run.
      await step.run('finalize-agent-run', async () => {
        const ctx = newTenantContext({
          tenantId: TenantId(tenant_id),
          correlationId: correlation_id,
        })
        const latencyMs = Date.now() - start
        await withTenant(dbToUse, ctx, async (tx) => {
          await tx
            .update(schema.agentRuns)
            .set({
              status: 'completed',
              output: {
                reply_text: llm.text,
                action_id: actionId,
                classifier_context_used: true,
              },
              inputTokens: llm.tokens.input,
              outputTokens: llm.tokens.output,
              costCents: Math.round(llm.costUsd * 100),
              latencyMs,
              completedAt: new Date(),
              ...(llm.langfuseTraceId !== '' && { langfuseTraceId: llm.langfuseTraceId }),
            })
            .where(eq(schema.agentRuns.id, run_id))
        })
      })

      // Step 5: hand off to the approval gate (BLU-25).
      await step.sendEvent('request-action', {
        name: 'action.requested',
        id: `event:${idempotency_key}:action`,
        data: {
          tenant_id,
          correlation_id,
          idempotency_key: `${idempotency_key}:action`,
          action_id: actionId,
          agent_run_id: run_id,
          kind: 'send_message',
          payload: {
            thread_id: preload.threadId,
            text: llm.text,
          },
          policy_outcome: 'approval_required',
        },
      })

      const latencyMs = Date.now() - start
      const output: AgentConciergeRunOutput = {
        run_id,
        action_id: actionId,
        reply_text: llm.text,
        langfuse_trace_id: llm.langfuseTraceId,
        tokens: { input: llm.tokens.input, output: llm.tokens.output },
        cost_usd: llm.costUsd,
        latency_ms: latencyMs,
      }
      span.update({
        output: {
          action_id: actionId,
          reply_preview: llm.text.slice(0, 120),
          latency_ms: latencyMs,
          input_tokens: llm.tokens.input,
          output_tokens: llm.tokens.output,
          cost_usd: llm.costUsd,
        },
      })
      logger.info('concierge run completed', {
        tenantId: tenant_id,
        correlationId: correlation_id,
        runId: run_id,
        actionId,
        latencyMs,
      })
      return output
    },
    { asType: 'agent' },
  )
}

/**
 * onFailure handler (BLU-34 v2, post-PR-#37 review).
 *
 * Inngest fires this AFTER the function's retry budget is exhausted —
 * which is exactly when we can honestly say the run is terminally
 * failed. Transient step errors that Inngest retries successfully
 * never reach here, so `agent_runs` never prematurely flips to
 * `failed`.
 *
 * The original event (with AgentRunRequestedData shape) is nested on
 * `event.data.event` inside Inngest's synthetic `inngest/function.failed`
 * payload. The final error is `error: Error`; jsonErrorSchema drops
 * non-standard properties, so we recover `step` + `kind` by parsing the
 * `[step=<name>] [kind=<k>]` tags `wrapStepError` embedded in the
 * message.
 *
 * Exported for integration testing — the Inngest binding below calls
 * this with the real runtime DB; tests pass `dbOverride`.
 */
export interface ConciergeFailureEvent {
  data: {
    event: { data: AgentRunRequestedData }
  }
}

export const handleAgentConciergeRunFailure = async (args: {
  event: ConciergeFailureEvent
  error: Error
  dbOverride?: Database
}): Promise<void> => {
  const { event, error, dbOverride } = args
  const dbToUse = dbOverride ?? db
  const originalData = event.data.event.data
  const { tenant_id, run_id, correlation_id } = originalData
  const failedStep = parseFailedStep(error)
  const errorKind = parseErrorKind(error)
  const errorMessage = extractErrorMessage(error)

  logger.warn('concierge run failed (onFailure fired after retries exhausted)', {
    tenantId: tenant_id,
    correlationId: correlation_id,
    runId: run_id,
    failedStep,
    errorKind,
    errorMessage,
  })

  await markRunFailed({
    dbToUse,
    tenantId: tenant_id,
    correlationId: correlation_id,
    runId: run_id,
    failedStep,
    errorKind,
    errorMessage,
  })
}

// Inngest wiring — Inngest's `if` filter short-circuits so the function
// is only invoked for concierge-bound events. When Sofia ships (M2) she'll
// register her own function with `agent_code == "vendor_ops"`.
export const agentConciergeRun = inngest.createFunction(
  {
    id: 'agent-concierge-run',
    name: 'Agent: Concierge run',
    onFailure: async ({ event, error }) =>
      handleAgentConciergeRunFailure({
        event: event as unknown as ConciergeFailureEvent,
        error,
      }),
  },
  {
    event: 'agent.run.requested',
    if: "event.data.agent_code == 'concierge'",
  },
  async ({ event, step }) =>
    handleAgentConciergeRun({
      event,
      step: step as unknown as ConciergeStep,
    }),
)
