import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uuid, vector } from 'drizzle-orm/pg-core'
import { channels } from './channels.js'
import { tenants } from './tenants.js'

/**
 * A conversation between the operator(s) of a tenant and BlueCairn.
 * Typically one primary thread per tenant; model allows multiple
 * (e.g., staff thread, emergency thread).
 *
 * See DATA-MODEL.md § threads.
 */
export const threads = pgTable(
  'threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id').references(() => channels.id),
    kind: text('kind').notNull().default('owner_primary'),
    title: text('title'),
    summary: text('summary'),
    summaryEmbedding: vector('summary_embedding', { dimensions: 1536 }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_threads_tenant')
      .on(table.tenantId)
      .where(sql`${table.deletedAt} is null`),
    index('idx_threads_last_message').on(
      table.tenantId,
      sql`${table.lastMessageAt} desc nulls last`,
    ),
  ],
)

export type Thread = typeof threads.$inferSelect
export type NewThread = typeof threads.$inferInsert
