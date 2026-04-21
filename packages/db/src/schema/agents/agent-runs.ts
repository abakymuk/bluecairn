import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tenants } from '../platform/tenants.js'
import { threads } from '../platform/threads.js'
import { agentDefinitions } from './agent-definitions.js'
import { prompts } from './prompts.js'

/**
 * Every invocation of an agent. Append-only. Primary unit of observability.
 *
 * See DATA-MODEL.md § agent_runs.
 */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id').references(() => threads.id),
    agentDefinitionId: uuid('agent_definition_id')
      .notNull()
      .references(() => agentDefinitions.id),
    promptId: uuid('prompt_id')
      .notNull()
      .references(() => prompts.id),
    triggerKind: text('trigger_kind').notNull(), // user_message | scheduled | webhook | agent_handoff
    triggerRef: text('trigger_ref'),
    input: jsonb('input').notNull(),
    output: jsonb('output'),
    status: text('status').notNull().default('running'), // running | completed | failed | escalated
    model: text('model').notNull(), // 'claude-opus-4-7', etc.
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costCents: integer('cost_cents'),
    latencyMs: integer('latency_ms'),
    langfuseTraceId: text('langfuse_trace_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_agent_runs_tenant_time').on(table.tenantId, sql`${table.startedAt} desc`),
    index('idx_agent_runs_thread').on(table.threadId, sql`${table.startedAt} desc`),
    index('idx_agent_runs_agent_time').on(table.agentDefinitionId, sql`${table.startedAt} desc`),
    index('idx_agent_runs_status')
      .on(table.status)
      .where(sql`${table.status} in ('running', 'escalated')`),
  ],
)

export type AgentRun = typeof agentRuns.$inferSelect
export type NewAgentRun = typeof agentRuns.$inferInsert
