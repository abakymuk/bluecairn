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
 * BLU-34 failure helper.
 *
 * Called when any `step.run` in the concierge flow (load-run-context,
 * generate-ack, insert-action, finalize-agent-run) throws after Inngest
 * has exhausted its retries. Performs two writes in a single tenant-
 * scoped tx:
 *
 *   1. Guarded UPDATE on `agent_runs` — `status='failed'` + terminal
 *      `completed_at` + `output` body carrying error kind / message /
 *      failed step. The WHERE clause requires `status='running'`, so a
 *      second invocation (retry, re-run) is a no-op that returns zero
 *      rows and skips the audit insert. That's the idempotency hook.
 *   2. INSERT on `audit_log` — `event_kind='agent.run_failed'`, linked to
 *      the `agent_run_id`, payload carries agent_code / failed_step /
 *      error_kind / error_message. Only runs when step 1 actually
 *      transitioned the row (skipped when UPDATE zero-rowed).
 *
 * Best-effort: if the tx itself fails (DB outage mid-failure-handling),
 * we log and swallow. The original step error is the real signal; we
 * must not mask it with an audit-path error.
 *
 * The handler is responsible for rethrowing the original error AFTER
 * this helper returns — this function does not rethrow on its own.
 */
interface MarkRunFailedArgs {
  dbToUse: Database
  tenantId: string
  correlationId: string
  runId: string
  failedStep: 'load-run-context' | 'generate-ack' | 'insert-action' | 'finalize-agent-run'
  error: unknown
}

const extractErrorKind = (err: unknown): string => {
  if (typeof err === 'object' && err !== null && 'kind' in err) {
    const k = (err as { kind: unknown }).kind
    if (typeof k === 'string') return k
  }
  return 'unknown'
}

const extractErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

const markRunFailed = async (args: MarkRunFailedArgs): Promise<void> => {
  const { dbToUse, tenantId, correlationId, runId, failedStep, error } = args
  const errorKind = extractErrorKind(error)
  const errorMessage = extractErrorMessage(error)
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
        // Row already in terminal state — this is a retry. Skip the audit
        // insert so we end up with exactly one `agent.run_failed` row per
        // run_id, not one per Inngest retry attempt.
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
    // Don't mask the original failure. Log and continue; the handler
    // rethrows the original error after we return.
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
      // Wrapped with BLU-34 failure path — if Inngest exhausts retries, we
      // mark the already-inserted agent_runs row as `failed`, write an
      // `agent.run_failed` audit row under tenant context, and rethrow so
      // Inngest marks the function failed.
      interface PreloadResult {
        promptContent: string
        promptVersion: number
        messageText: string
        threadId: string
      }
      let preload: PreloadResult
      try {
        preload = await step.run('load-run-context', async (): Promise<PreloadResult> => {
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
              throw new Error(
                `agent_run ${run_id} not found (orchestrator + concierge out of sync)`,
              )
            }

            const [prompt] = await tx
              .select({ content: schema.prompts.content, version: schema.prompts.version })
              .from(schema.prompts)
              .where(eq(schema.prompts.id, run.promptId))
              .limit(1)
            if (prompt === undefined) {
              throw new Error(`prompt ${run.promptId} not found for concierge run ${run_id}`)
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
              throw new Error(`trigger message ${message_id} not found`)
            }

            return {
              promptContent: prompt.content,
              promptVersion: prompt.version,
              messageText: msg.content,
              threadId: run.threadId ?? thread_id,
            }
          })
        })
      } catch (err) {
        await markRunFailed({
          dbToUse,
          tenantId: tenant_id,
          correlationId: correlation_id,
          runId: run_id,
          failedStep: 'load-run-context',
          error: err,
        })
        throw err
      }

      // Step 2: call Haiku. generateText (BLU-20 wrapper) opens an
      // `llm.concierge` child span automatically. BLU-34: same guarded-
      // failure semantics as step 1.
      let llm: LlmCallOutput
      try {
        llm = await step.run('generate-ack', async (): Promise<LlmCallOutput> => {
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
            // Attach the LlmError kind so markRunFailed can persist a
            // discriminated error_kind rather than the catch-all 'unknown'.
            const err = new Error(
              `concierge LLM failed: ${result.error.kind}: ${result.error.message}`,
            )
            ;(err as Error & { kind: string }).kind = result.error.kind
            throw err
          }
          return result.value
        })
      } catch (err) {
        await markRunFailed({
          dbToUse,
          tenantId: tenant_id,
          correlationId: correlation_id,
          runId: run_id,
          failedStep: 'generate-ack',
          error: err,
        })
        throw err
      }

      // Step 3: insert actions row (idempotent on agent_run_id + kind).
      // BLU-34: guarded failure path — if the DB insert fails after retries,
      // markRunFailed records the state before we rethrow.
      let actionId: string
      try {
        actionId = await step.run('insert-action', async () => {
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
              throw new Error('actions insert returned no row')
            }
            return inserted.id
          })
        })
      } catch (err) {
        await markRunFailed({
          dbToUse,
          tenantId: tenant_id,
          correlationId: correlation_id,
          runId: run_id,
          failedStep: 'insert-action',
          error: err,
        })
        throw err
      }

      // Step 4: finalize agent_run. BLU-34: wrapped with the same
      // guarded failure path even though this step IS the terminal
      // state transition — a DB failure mid-finalize leaves the row
      // in 'running' forever otherwise.
      try {
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
      } catch (err) {
        await markRunFailed({
          dbToUse,
          tenantId: tenant_id,
          correlationId: correlation_id,
          runId: run_id,
          failedStep: 'finalize-agent-run',
          error: err,
        })
        throw err
      }

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

// Inngest wiring — Inngest's `if` filter short-circuits so the function
// is only invoked for concierge-bound events. When Sofia ships (M2) she'll
// register her own function with `agent_code == "vendor_ops"`.
export const agentConciergeRun = inngest.createFunction(
  {
    id: 'agent-concierge-run',
    name: 'Agent: Concierge run',
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
