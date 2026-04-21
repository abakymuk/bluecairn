import { sql } from 'drizzle-orm'
import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { messages } from '../platform/messages.js'
import { tenants } from '../platform/tenants.js'
import { users } from '../platform/users.js'
import { actions } from './actions.js'

/**
 * Actions that require human approval open an approval request.
 *
 * See DATA-MODEL.md § approval_requests and AGENTS.md § approval policies.
 */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actionId: uuid('action_id')
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    requestedFromUserId: uuid('requested_from_user_id').references(() => users.id),
    messageId: uuid('message_id').references(() => messages.id), // message that asked for approval
    summary: text('summary').notNull(),
    stakesCents: bigint('stakes_cents', { mode: 'bigint' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    resolvedStatus: text('resolved_status'), // approved | rejected | expired | cancelled
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_approval_pending')
      .on(table.tenantId, table.createdAt)
      .where(sql`${table.resolvedStatus} is null`),
  ],
)

export type ApprovalRequest = typeof approvalRequests.$inferSelect
export type NewApprovalRequest = typeof approvalRequests.$inferInsert
