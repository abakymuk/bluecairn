import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Registry of agents. One row per agent role. Platform-global (no tenant_id).
 * Static data updated via migrations + seed scripts, not runtime code.
 *
 * See DATA-MODEL.md § agent_definitions and AGENTS.md.
 */
export const agentDefinitions = pgTable('agent_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(), // 'vendor_ops', 'inventory', 'finance', ...
  personaName: text('persona_name').notNull(), // 'Sofia', 'Marco', 'Dana', ...
  displayScope: text('display_scope').notNull(), // 'Vendor Ops', 'Inventory', ...
  priority: text('priority').notNull(), // P0 | P1 | P2
  activeFrom: timestamp('active_from', { withTimezone: true }).notNull().defaultNow(),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
})

export type AgentDefinition = typeof agentDefinitions.$inferSelect
export type NewAgentDefinition = typeof agentDefinitions.$inferInsert
