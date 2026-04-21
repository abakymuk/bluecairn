import { sql } from 'drizzle-orm'
import { boolean, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { users } from '../platform/users.js'
import { agentDefinitions } from './agent-definitions.js'

/**
 * Versioned prompt artifacts. Referenced by agent_runs. Never edited in place —
 * new versions are inserted.
 *
 * See DATA-MODEL.md § prompts and ENGINEERING.md § Prompts and prompts.
 */
export const prompts = pgTable(
  'prompts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentDefinitionId: uuid('agent_definition_id')
      .notNull()
      .references(() => agentDefinitions.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    evalPassed: boolean('eval_passed').notNull().default(false),
    evalRunUrl: text('eval_run_url'),
    createdByUserId: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  },
  (table) => [
    unique('prompts_agent_version_unique').on(table.agentDefinitionId, table.version),
    index('idx_prompts_active')
      .on(table.agentDefinitionId)
      .where(sql`${table.activatedAt} is not null and ${table.deactivatedAt} is null`),
  ],
)

export type Prompt = typeof prompts.$inferSelect
export type NewPrompt = typeof prompts.$inferInsert
