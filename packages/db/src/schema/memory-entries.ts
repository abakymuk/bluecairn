import { sql } from 'drizzle-orm'
import { index, pgTable, smallint, text, timestamp, uuid, vector } from 'drizzle-orm/pg-core'
import { tenants } from './platform/tenants.js'

/**
 * Semantic memory for a tenant. Used by the Memory MCP server for retrieval.
 *
 * Embeddings use OpenAI text-embedding-3-small (1536 dim, cosine similarity).
 * HNSW index for sub-linear vector search.
 *
 * See DATA-MODEL.md § memory_entries and § pgvector strategy.
 */
export const memoryEntries = pgTable(
  'memory_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'preference' | 'fact' | 'event' | 'pattern'
    content: text('content').notNull(),
    contentEmbedding: vector('content_embedding', { dimensions: 1536 }),
    sourceRef: text('source_ref'), // reference to agent_run, thread, etc.
    importance: smallint('importance').notNull().default(5), // 1-10
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_memory_tenant_kind')
      .on(table.tenantId, table.kind)
      .where(sql`${table.archivedAt} is null`),
    index('idx_memory_embedding')
      .using('hnsw', table.contentEmbedding.op('vector_cosine_ops')),
  ],
)

export type MemoryEntry = typeof memoryEntries.$inferSelect
export type NewMemoryEntry = typeof memoryEntries.$inferInsert
