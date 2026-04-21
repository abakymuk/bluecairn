import { sql } from 'drizzle-orm'
import { index, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { actions } from './agents/actions.js'
import { agentRuns } from './agents/agent-runs.js'
import { users } from './platform/users.js'

/**
 * Immutable trail. Every platform event with compliance or trust significance.
 *
 * Immutability is enforced by triggers — those are defined in the raw SQL
 * migration `migrations-manual/0003_audit_triggers.sql`. Drizzle does not
 * generate triggers directly.
 *
 * Never write UPDATE or DELETE against this table.
 *
 * See DATA-MODEL.md § audit_log and ARCHITECTURE.md principle #9.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id'), // nullable for platform-global events
    userId: uuid('user_id').references(() => users.id),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id),
    actionId: uuid('action_id').references(() => actions.id),
    eventKind: text('event_kind').notNull(), // 'action_executed', 'approval_granted', ...
    eventSummary: text('event_summary').notNull(),
    eventPayload: jsonb('event_payload'),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_tenant_time').on(table.tenantId, sql`${table.occurredAt} desc`),
    index('idx_audit_kind_time').on(table.eventKind, sql`${table.occurredAt} desc`),
  ],
)

export type AuditLog = typeof auditLog.$inferSelect
export type NewAuditLog = typeof auditLog.$inferInsert
