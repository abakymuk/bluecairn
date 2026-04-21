import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tenants } from '../platform/tenants.js'
import { users } from '../platform/users.js'
import { actions } from './actions.js'
import { agentDefinitions } from './agent-definitions.js'

/**
 * Persistent to-dos and follow-ups. Used for work spanning conversations
 * or requiring reminder logic.
 *
 * See DATA-MODEL.md § tasks.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    createdByAgentId: uuid('created_by_agent_id').references(() => agentDefinitions.id),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id),
    title: text('title').notNull(),
    description: text('description'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    priority: text('priority').notNull().default('normal'), // low | normal | high | urgent
    status: text('status').notNull().default('open'), // open | in_progress | done | cancelled
    relatedActionId: uuid('related_action_id').references(() => actions.id),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_tasks_tenant_status').on(table.tenantId, table.status),
    index('idx_tasks_due')
      .on(table.tenantId, table.dueAt)
      .where(sql`${table.status} = 'open'`),
  ],
)

export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
