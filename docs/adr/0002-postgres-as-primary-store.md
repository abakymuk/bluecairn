# ADR-0002: Postgres as primary store

**Status:** Accepted
**Date:** 2026-04-20
**Deciders:** Vlad, Claude (cofounder-architect)

## Context

BlueCairn stores several data shapes: relational domain records (tenants, vendors, deliveries, inventory, finances), immutable logs (audit, tool calls, agent runs), vectors (semantic memory, embeddings), session state, and operational metadata.

We can either:
- Use a single primary database for most needs, with specialized stores where justified.
- Use multiple specialized stores from day one (relational DB + vector DB + log store + cache).

The solo-founder context is decisive here. Every additional system is another set of credentials, another client library, another failure mode, another backup regime. We want minimum systems, maximum leverage per system.

The multi-tenancy requirement (ADR-0006) also shapes the choice: we need a data store where tenant isolation is enforced at the storage layer, not just the application layer.

## Decision

**Postgres is the single primary data store for BlueCairn.** We use Neon as the managed provider for its serverless model, branching capability, and native `pgvector` support.

Within Postgres, we rely on:
- **Row-level security (RLS)** for tenant isolation, set via `app.current_tenant` session variable.
- **`pgvector`** for embedding storage and similarity search.
- **JSONB** for genuinely-variable payloads (tool call arguments, LLM responses, flexible metadata).
- **Triggers** for immutability enforcement on the audit log.
- **Drizzle ORM** for schema definition and migrations.

**Upstash Redis** is a secondary store, used only for ephemeral hot-path state: session caching, rate limiters, idempotency keys, short-lived locks. Redis is not a system of record.

## Alternatives considered

**PlanetScale / Vitess.** Scales horizontally beautifully. But: MySQL-compatible (weaker than Postgres on `jsonb`, arrays, vectors, triggers), no native vector support (requires a sidecar), RLS is not first-class. Scaling is a problem we don't have and may never have at our target customer count. Rejected.

**DynamoDB.** Serverless, scales to huge, cheap at low volume. But: weak for relational queries (we will do many), weak for ad-hoc analytics, no vector support. The access patterns of BlueCairn are relational; forcing them into single-table designs would slow us. Rejected.

**Firestore / Firebase.** Fast for prototypes. But: vendor lock-in is heavy, multi-tenancy is harder to enforce rigorously, SQL access is missing. Wrong for a built-to-last system. Rejected.

**Separate Postgres + dedicated vector DB (Pinecone / Weaviate / Qdrant).** More performant vectors at extreme scale. But: two systems to operate, no SQL joins between structured data and vectors (a major loss for an agent system that wants `WHERE tenant_id = X AND similar_to(Y)` queries), extra ops burden for a solo founder. At our scale (millions, not billions, of vectors per tenant) `pgvector` is sufficient. Rejected for now; revisit if we cross the pain threshold.

**MongoDB.** Document model feels natural for some of our flexible data. But: weaker ACID on multi-document transactions (which we need for consistency across related writes), weaker SQL ecosystem, JSONB in Postgres covers the document use case. Rejected.

**Supabase (Postgres + BaaS).** Good product, Postgres-based. Close cousin to what we're choosing. We use Neon instead because: better branching for dev/staging workflows, more pure focus on Postgres without BaaS layer we don't need, better pricing model for our shape.

## Consequences

**Accepted benefits:**
- One system to operate, one client library, one backup regime, one query language.
- Full SQL power: joins, window functions, CTEs, transactions, triggers.
- Multi-tenancy enforced at the data layer via RLS.
- Vector search integrated with structured queries.
- Neon branching gives us cheap dev/staging databases and safe schema change workflows.
- Drizzle provides type-safe schema and migrations in our primary language.
- Postgres is a 30-year-old project with the momentum and stability we want in a 30-year horizon.

**Accepted costs:**
- We accept some performance cost on vector operations versus specialized vector DBs. Acceptable at our scale.
- Neon is a single vendor. Migration to self-hosted Postgres or another managed provider is possible but non-trivial.
- RLS has a learning curve and small performance overhead. We accept this for the isolation guarantee.
- JSONB is flexible but easy to abuse. We discipline ourselves to document and migrate out of JSONB when shapes stabilize.

**Rules this decision creates:**
- All persistent state goes through Postgres unless a compelling reason exists (documented via follow-up ADR).
- Redis is ephemeral only. Any data that must survive a restart goes to Postgres.
- Schema lives in TypeScript (Drizzle) and is version-controlled with migrations.
- Every migration tested on a Neon branch before merging.

## Revisit conditions

- If vector workloads exceed ~100M entries per tenant or require sub-millisecond recall.
- If tenant count exceeds ~5000 and isolation/performance becomes bottlenecked (may require sharding or per-tenant schemas).
- If Neon as a vendor becomes unstable, prohibitively expensive, or misaligned with our needs.
- If a breakthrough in a new class of database (vector-native relational, or distributed-transactional vector) changes the math.

Default bet: Postgres will still be the right answer in 2035. We build accordingly.
