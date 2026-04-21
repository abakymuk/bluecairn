import { sql } from 'drizzle-orm'
import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

/**
 * Per-tenant channel configuration.
 * kinds: 'telegram' (MVP primary per ADR-0009), 'whatsapp', 'sms', 'voice'
 *
 * For MVP, only 'telegram' is provisioned. 'whatsapp' and 'sms' deferred to Month 11+.
 *
 * See DATA-MODEL.md § channels.
 */
export const channels = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // telegram | whatsapp | sms | voice
    externalId: text('external_id').notNull(), // telegram chat_id, twilio SID, etc.
    phoneE164: text('phone_e164'),
    displayName: text('display_name'),
    config: jsonb('config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    isPrimary: boolean('is_primary').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_channels_primary_per_tenant')
      .on(table.tenantId, table.kind)
      .where(sql`${table.isPrimary} and ${table.active}`),
  ],
)

export type Channel = typeof channels.$inferSelect
export type NewChannel = typeof channels.$inferInsert
