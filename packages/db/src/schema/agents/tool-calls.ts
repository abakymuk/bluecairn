import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from '../platform/tenants.js'
import { agentRuns } from './agent-runs.js'

/**
 * Every MCP tool call made inside an agent run. Append-only.
 *
 * See DATA-MODEL.md § tool_calls.
 */
export const toolCalls = pgTable(
  'tool_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentRunId: uuid('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    mcpServer: text('mcp_server').notNull(), // 'pos', 'accounting', 'comms', ...
    toolName: text('tool_name').notNull(),
    arguments: jsonb('arguments').notNull(),
    result: jsonb('result'),
    error: text('error'),
    status: text('status').notNull().default('running'), // running | success | error
    latencyMs: integer('latency_ms'),
    idempotencyKey: text('idempotency_key'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_tool_calls_run').on(table.agentRunId, table.startedAt),
    index('idx_tool_calls_tenant_time').on(table.tenantId, sql`${table.startedAt} desc`),
    uniqueIndex('idx_tool_calls_idempotency')
      .on(table.tenantId, table.mcpServer, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
  ],
)

export type ToolCall = typeof toolCalls.$inferSelect
export type NewToolCall = typeof toolCalls.$inferInsert
