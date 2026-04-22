import { anthropic } from '@ai-sdk/anthropic'
import { TenantId, newTenantContext, type ThreadMessageReceivedData } from '@bluecairn/core'
import { createDatabase, schema, withTenant, type Database } from '@bluecairn/db'
import { generateText } from '@bluecairn/agents'
import { startActiveObservation } from '@langfuse/tracing'
import { and, desc, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { env } from '../env.js'
import { inngest } from '../inngest.js'
import { logger } from '../lib/logger.js'

/**
 * orchestrator.route — the M1 entry point for every inbound customer
 * message (BLU-22, Layer 2 per ARCHITECTURE.md).
 *
 * Triggered by `thread.message.received` (emitted by apps/api webhook
 * after persist — BLU-19). The function loads thread context, asks Haiku
 * which agent should handle the message, writes an `agent_runs` row, and
 * emits `agent.run.requested` for the agent runtime (BLU-23+) to consume.
 *
 * In M1 the agent whitelist is `['concierge']` — any other Haiku output
 * is normalized back to `concierge` and tagged `classifier.downgraded` on
 * the Langfuse trace so ops can audit what the model was trying to say.
 * When future agents ship (Sofia in M2, etc.), add their codes to the
 * whitelist and the orchestrator routes to them automatically.
 *
 * Idempotency: agent_runs carries `trigger_ref = message_id`. A second
 * invocation with the same thread_id+message_id returns the existing
 * run_id instead of creating a duplicate. Belt-and-suspenders with
 * Inngest's event-level dedup via `event.id`.
 *
 * Observability: the whole function body runs inside a Langfuse
 * `orchestrator.route` span, with `llm.classifier` nested for the Haiku
 * call. When BLU-23 lands, the downstream `agent.concierge.run` span will
 * appear as a sibling trace (separate Inngest invocation) correlated via
 * `correlation_id` + `agent_run_id` metadata.
 */

const CLASSIFIER_MODEL = 'claude-haiku-4-5-20251001'
const DEFAULT_CONTEXT_LIMIT = 10
const AGENT_WHITELIST = ['concierge'] as const

type AgentCode = (typeof AGENT_WHITELIST)[number]

// Admin DB client — workers operate in system context; all tenant-scoped
// writes still go through `withTenant`.
const db: Database = createDatabase(env.DATABASE_URL_ADMIN)

export interface OrchestratorRouteOutput {
  run_id: string
  agent_code: AgentCode
  classifier_downgraded: boolean
  policy_default: 'approval_required'
  policy_rule_count: number
  langfuse_trace_id: string
}

// Minimal step shape the handler uses. Matches Inngest's runtime surface
// for `step.run` + `step.sendEvent`; exporting the narrow type makes unit
// testing straightforward (pass a plain `{ run, sendEvent }` fake).
export interface OrchestratorStep {
  run: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  sendEvent: (name: string, payload: { name: string; id?: string; data: unknown }) => Promise<unknown>
}

/**
 * Pure handler — exported for unit testing. `orchestratorRoute` below wires
 * it into Inngest with the trigger. Tests pass a fake `step` that executes
 * `.run()` callbacks inline (no Inngest scheduling) + records `.sendEvent`
 * calls.
 */
export const handleOrchestratorRoute = async (args: {
  event: { data: ThreadMessageReceivedData }
  step: OrchestratorStep
  dbOverride?: Database
}): Promise<OrchestratorRouteOutput> => {
  const { event, step, dbOverride } = args
  const dbToUse = dbOverride ?? db
  const { tenant_id, thread_id, message_id, correlation_id, idempotency_key } = event.data

  return await startActiveObservation(
    'orchestrator.route',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (span: any) => {
        span.update({
          input: { thread_id, message_id },
          metadata: {
            tenant_id,
            thread_id,
            message_id,
            correlation_id,
            idempotency_key,
          },
        })

        // Step 1: load last-N thread context under withTenant (RLS applies).
        const context = await step.run('load-context', async () => {
          const ctx = newTenantContext({
            tenantId: TenantId(tenant_id),
            correlationId: correlation_id,
          })
          return await withTenant(dbToUse, ctx, async (tx) => {
            const rows = await tx
              .select({
                id: schema.messages.id,
                direction: schema.messages.direction,
                content: schema.messages.content,
                createdAt: schema.messages.createdAt,
              })
              .from(schema.messages)
              .where(eq(schema.messages.threadId, thread_id))
              .orderBy(desc(schema.messages.createdAt))
              .limit(DEFAULT_CONTEXT_LIMIT)
            return rows.reverse() // oldest first for prompt readability
          })
        })

        // Step 2: classify via Haiku. step.run checkpoints the result, so
        // Inngest retries don't re-bill the LLM on transient failures.
        const classification = await step.run('classify-intent', async () => {
          const target = context.find((m) => m.id === message_id)
          const history = context
            .filter((m) => m.id !== message_id)
            .map((m) => `${m.direction === 'inbound' ? 'user' : 'agent'}: ${m.content}`)
            .join('\n')

          const classifierPrompt = [
            'You are the BlueCairn orchestrator. Classify which agent should handle the NEW user message.',
            '',
            `Available agents: ${AGENT_WHITELIST.join(', ')}`,
            '',
            history !== '' ? `Conversation history:\n${history}\n` : '',
            `NEW user message: "${target?.content ?? '(missing)'}"`,
            '',
            'Respond with just the agent code (one word, lowercase), nothing else.',
          ]
            .filter((line) => line !== undefined && line !== null)
            .join('\n')

          const result = await generateText({
            model: anthropic(CLASSIFIER_MODEL),
            prompt: classifierPrompt,
            maxTokens: 16,
            metadata: {
              tenantId: tenant_id,
              correlationId: correlation_id,
              agentCode: 'classifier',
            },
          })

          if (!result.ok) {
            // BLU-34: record tenant-visible failure before rethrowing.
            //
            // No `agent_runs` row exists yet at this point (insertion is
            // step 4, after classification), so we can't mark a run failed
            // — the audit row IS the tenant-visible signal. Under Inngest
            // retries this step re-fires, and each attempt writes one
            // audit row (per-attempt semantics, NOT exactly-once — there
            // is no durable run to guard on). That's acceptable for a
            // low-volume failure mode; downstream consumers (ops-web
            // Activity view) can dedupe on correlation_id if they need
            // single-row display.
            //
            // Audit insert itself is best-effort: if it fails, we log and
            // still rethrow the original classifier error (the real
            // signal). Swallowing the audit failure avoids masking the
            // root cause with a transient DB hiccup.
            try {
              const ctx = newTenantContext({
                tenantId: TenantId(tenant_id),
                correlationId: correlation_id,
              })
              await withTenant(dbToUse, ctx, async (tx) => {
                await tx.insert(schema.auditLog).values({
                  tenantId: tenant_id,
                  eventKind: 'orchestrator.classifier_failed',
                  eventSummary: `classifier LLM failed: ${result.error.kind}`,
                  eventPayload: {
                    thread_id,
                    message_id,
                    correlation_id,
                    classifier_error: {
                      kind: result.error.kind,
                      message: result.error.message,
                    },
                  },
                })
              })
            } catch (auditErr) {
              logger.error('audit_log insert failed during classifier failure', {
                tenantId: tenant_id,
                correlationId: correlation_id,
                auditError: auditErr instanceof Error ? auditErr.message : String(auditErr),
                classifierError: result.error.kind,
              })
            }
            throw new Error(
              `classifier call failed: ${result.error.kind}: ${result.error.message}`,
            )
          }

          const raw = result.value.text.trim().toLowerCase().replace(/[^a-z_]/g, '')
          const matched = AGENT_WHITELIST.find((code) => code === raw)
          const agentCode: AgentCode = matched ?? 'concierge'

          return {
            agentCode,
            downgraded: matched === undefined,
            rawText: result.value.text.trim(),
            langfuseTraceId: result.value.langfuseTraceId,
            costUsd: result.value.costUsd,
            inputTokens: result.value.tokens.input,
            outputTokens: result.value.tokens.output,
          }
        })

        if (classification.downgraded) {
          span.update({
            metadata: {
              'classifier.downgraded': true,
              'classifier.raw': classification.rawText,
            },
          })
          logger.warn('classifier downgraded', {
            correlationId: correlation_id,
            tenantId: tenant_id,
            rawText: classification.rawText,
            normalizedTo: classification.agentCode,
          })
        }

        // Step 3: resolve agent_definition + latest prompt for the chosen agent.
        const { agentDefinitionId, promptId } = await step.run('resolve-agent', async () => {
          const [def] = await dbToUse
            .select({ id: schema.agentDefinitions.id })
            .from(schema.agentDefinitions)
            .where(eq(schema.agentDefinitions.code, classification.agentCode))
            .limit(1)
          if (def === undefined) {
            throw new Error(`agent_definition not seeded for code=${classification.agentCode}`)
          }
          const [prompt] = await dbToUse
            .select({ id: schema.prompts.id })
            .from(schema.prompts)
            .where(eq(schema.prompts.agentDefinitionId, def.id))
            .orderBy(desc(schema.prompts.version))
            .limit(1)
          if (prompt === undefined) {
            throw new Error(`no prompt seeded for agent ${classification.agentCode}`)
          }
          return { agentDefinitionId: def.id, promptId: prompt.id }
        })

        // Step 4: insert agent_runs row (idempotent on trigger_ref=message_id).
        const runId = await step.run('write-agent-run', async () => {
          const ctx = newTenantContext({
            tenantId: TenantId(tenant_id),
            correlationId: correlation_id,
          })
          return await withTenant(dbToUse, ctx, async (tx) => {
            const [existing] = await tx
              .select({ id: schema.agentRuns.id })
              .from(schema.agentRuns)
              .where(
                and(
                  eq(schema.agentRuns.tenantId, tenant_id),
                  eq(schema.agentRuns.threadId, thread_id),
                  eq(schema.agentRuns.triggerKind, 'user_message'),
                  eq(schema.agentRuns.triggerRef, message_id),
                ),
              )
              .limit(1)
            if (existing !== undefined) {
              return existing.id
            }

            const [inserted] = await tx
              .insert(schema.agentRuns)
              .values({
                tenantId: tenant_id,
                threadId: thread_id,
                agentDefinitionId,
                promptId,
                triggerKind: 'user_message',
                triggerRef: message_id,
                input: {
                  message_id,
                  context_message_count: context.length,
                  classification: {
                    agent_code: classification.agentCode,
                    downgraded: classification.downgraded,
                    raw: classification.rawText,
                  },
                },
                status: 'running',
                model: CLASSIFIER_MODEL,
                inputTokens: classification.inputTokens,
                outputTokens: classification.outputTokens,
                // cost_cents is integer; classifier calls at Haiku pricing
                // round sub-cent. Actual USD is preserved in Langfuse traces.
                costCents: Math.round(classification.costUsd * 100),
                ...(classification.langfuseTraceId !== '' && {
                  langfuseTraceId: classification.langfuseTraceId,
                }),
              })
              .returning({ id: schema.agentRuns.id })
            if (inserted === undefined) {
              throw new Error('agent_runs insert returned no row')
            }
            return inserted.id
          })
        })

        // Step 5: load tenant + agent policies (BLU-34).
        //
        // Real SELECT under `withTenant` — RLS keeps the read tenant-scoped
        // at the DB layer as well. Filters:
        //   * agent_definition_id IS NULL OR = resolved — tenant-wide rules
        //     AND agent-specific rules merge into the same rule list.
        //   * effective_to IS NULL — rule is currently in force (never retired).
        //   * effective_from <= now() — rule has actually started. Future-
        //     dated rows in the table (preparing for a scheduled policy
        //     change) stay inactive until their activation time. Without
        //     this, future-dated policies leak into the current decision
        //     set.
        // The `allActionsDefault` stays hardcoded `approval_required` —
        // that is the platform-wide default (ADR + AGENTS.md principle
        // #8). Per-action enforcement against `rules` is BLU-25's job;
        // this step just hands the rule list forward.
        const policy = await step.run('load-policy', async () => {
          const ctx = newTenantContext({
            tenantId: TenantId(tenant_id),
            correlationId: correlation_id,
          })
          return await withTenant(dbToUse, ctx, async (tx) => {
            const rules = await tx
              .select()
              .from(schema.policies)
              .where(
                and(
                  eq(schema.policies.tenantId, tenant_id),
                  or(
                    isNull(schema.policies.agentDefinitionId),
                    eq(schema.policies.agentDefinitionId, agentDefinitionId),
                  ),
                  isNull(schema.policies.effectiveTo),
                  lte(schema.policies.effectiveFrom, sql`now()`),
                ),
              )
            return {
              allActionsDefault: 'approval_required' as const,
              rules,
            }
          })
        })

        // Step 6: hand off to the agent runtime.
        await step.sendEvent('request-agent-run', {
          name: 'agent.run.requested',
          // Inngest event-level dedup — two orchestrator runs on the same
          // message won't emit two agent-run-requested events.
          id: `event:${idempotency_key}:agent-run`,
          data: {
            tenant_id,
            correlation_id,
            idempotency_key: `${idempotency_key}:agent-run`,
            run_id: runId,
            agent_code: classification.agentCode,
            thread_id,
            message_id,
          },
        })

      const output: OrchestratorRouteOutput = {
        run_id: runId,
        agent_code: classification.agentCode,
        classifier_downgraded: classification.downgraded,
        policy_default: policy.allActionsDefault,
        policy_rule_count: policy.rules.length,
        langfuse_trace_id: classification.langfuseTraceId,
      }
      span.update({ output })
      return output
    },
  )
}

// Inngest wiring — subscribes to thread.message.received and invokes the
// pure handler above. Kept thin so tests can exercise the handler without
// Inngest scheduling.
export const orchestratorRoute = inngest.createFunction(
  {
    id: 'orchestrator-route',
    name: 'Orchestrator: route thread.message.received',
  },
  { event: 'thread.message.received' },
  async ({ event, step }) =>
    handleOrchestratorRoute({
      event,
      step: step as unknown as OrchestratorStep,
    }),
)
