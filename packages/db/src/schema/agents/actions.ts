import { sql } from 'drizzle-orm'
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tenants } from '../platform/tenants.js'
import { agentRuns } from './agent-runs.js'

/**
 * Structured output from an agent. May require approval, may queue for
 * execution, may emit a message.
 *
 * See DATA-MODEL.md § actions.
 */
export const actions = pgTable(
  'actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentRunId: uuid('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // send_message | draft_email | create_po | update_schedule | ...
    payload: jsonb('payload').notNull(),
    policyOutcome: text('policy_outcome').notNull(), // auto | approval_required | notify_after
    status: text('status').notNull().default('pending'),
    // pending | awaiting_approval | approved | rejected | executing | executed | failed | cancelled
    executedAt: timestamp('executed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    inngestEventId: text('inngest_event_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_actions_tenant_status').on(table.tenantId, table.status),
    index('idx_actions_run').on(table.agentRunId),
    index('idx_actions_pending')
      .on(table.tenantId, table.createdAt)
      .where(sql`${table.status} in ('pending', 'awaiting_approval')`),
  ],
)

export type Action = typeof actions.$inferSelect
export type NewAction = typeof actions.$inferInsert
