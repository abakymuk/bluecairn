import { sql } from 'drizzle-orm'
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { agentDefinitions } from '../agents/agent-definitions.js'
import { agentRuns } from '../agents/agent-runs.js'
import { tenants } from './tenants.js'
import { threads } from './threads.js'
import { users } from './users.js'

/**
 * Individual messages in threads. From user (operator), from agent,
 * or from the system (events rendered as messages).
 *
 * See DATA-MODEL.md § messages.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    authorKind: text('author_kind').notNull(), // user | agent | system
    authorUserId: uuid('author_user_id').references(() => users.id),
    authorAgentId: uuid('author_agent_id').references(() => agentDefinitions.id),
    content: text('content').notNull(),
    attachments: jsonb('attachments').notNull().default(sql`'[]'::jsonb`),
    idempotencyKey: text('idempotency_key'),
    externalMessageId: text('external_message_id'), // Telegram message_id, etc.
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_messages_thread_created').on(table.threadId, table.createdAt),
    index('idx_messages_tenant_created').on(table.tenantId, table.createdAt),
    uniqueIndex('idx_messages_idempotency')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
  ],
)

export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
