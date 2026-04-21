import { sql } from 'drizzle-orm'
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tenants } from '../platform/tenants.js'
import { users } from '../platform/users.js'
import { agentDefinitions } from './agent-definitions.js'

/**
 * Per-tenant rules governing agent behavior: approval thresholds,
 * quiet hours, escalation rules.
 *
 * See DATA-MODEL.md § policies.
 */
export const policies = pgTable(
  'policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentDefinitionId: uuid('agent_definition_id').references(() => agentDefinitions.id), // null = tenant-wide
    actionKind: text('action_kind'), // null = all actions of the agent
    ruleKey: text('rule_key').notNull(), // 'auto_approve_under_cents', 'quiet_hours_start', ...
    ruleValue: jsonb('rule_value').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_policies_lookup')
      .on(table.tenantId, table.agentDefinitionId, table.actionKind, table.ruleKey)
      .where(sql`${table.effectiveTo} is null`),
  ],
)

export type Policy = typeof policies.$inferSelect
export type NewPolicy = typeof policies.$inferInsert
