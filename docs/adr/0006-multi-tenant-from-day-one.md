# ADR-0006: Multi-tenant from day one

**Status:** Accepted
**Date:** 2026-04-20
**Deciders:** Vlad, Claude (cofounder-architect)

## Context

BlueCairn's first tenant is our own operation (farmers markets). Second is the acquired café. Third is Hearth & Rise. Fourth through dozens are external customers starting Month 12.

A natural temptation for a solo founder is to build single-tenant first ("for our café, we'll extend later") and add multi-tenancy when external customers arrive. This is a well-known failure mode. Retrofitting multi-tenancy onto a single-tenant codebase is rarely cheap, often impossible without a rewrite, and always introduces correctness risk at the worst moment — when real external customers are depending on the system.

We have evidence from prior projects (Potlucky, drayage tooling, peer anecdotes across many startups): teams that deferred multi-tenancy paid 3–10x the cost to add it later, and several of them shipped cross-tenant data bugs in production during the migration.

## Decision

**BlueCairn is multi-tenant from the first commit. There is no single-tenant phase.**

Specifically:

1. Every table that holds tenant data has a non-null `tenant_id uuid` column.
2. Every query issued by application code filters explicitly by `tenant_id` and takes an explicit tenant context object — no ambient tenant state.
3. Row-level security (RLS) is enabled at the Postgres layer on every tenant-scoped table, enforced via `set local app.current_tenant = '<uuid>'` at the start of each request or job.
4. The application connects to the database under a role without the `bypassrls` privilege. RLS is a correctness backstop, not a nicety.
5. Every MCP tool call carries tenant context; MCP servers enforce tenant scoping.
6. Every Inngest event includes `tenant_id` in its payload; workers process per-tenant with the right context loaded.
7. Every log line and trace is tagged with `tenant_id` for incident response.
8. Cross-tenant queries exist only in a separate, privileged admin pathway with explicit role elevation and full audit.

Our own operations (farmers markets, café, Hearth) each get their own distinct tenant from the moment they onboard. We dogfood multi-tenancy with ourselves before any external customer arrives.

## Alternatives considered

**Single-tenant first, multi-tenant later.** Classic startup pattern, often rationalized as "we need to move fast and we don't have customers yet." Rejected for reasons stated above. The "later" is never cheap.

**Multi-database (one Postgres per tenant).** Strongest isolation possible. Rejected: operational burden is enormous (N migrations to apply, N backups, N monitoring targets), cross-tenant queries for our own analytics become painful, onboarding is slow. Appropriate for highly-regulated verticals or massive enterprise customers; not appropriate for independent restaurants at our scale.

**Multi-schema (one Postgres schema per tenant).** A middle ground. Rejected: Drizzle and most ORMs are not schema-aware in a way that makes this clean; migrations across many schemas are awkward; the operational overhead grows with customer count. The benefits over RLS are marginal at our scale.

**Shared-schema with application-layer filtering only.** What most startups actually do. Rejected: a single missing `WHERE tenant_id = ?` in a query is a cross-tenant data leak, and these bugs are catastrophic and embarrassing. RLS at the database layer is a hard safety net.

**Shared-schema with RLS (our choice).** Single Postgres schema; tenant isolation enforced at both application and database layers.

## Consequences

**Accepted benefits:**
- Cross-tenant data leaks are blocked by the database itself, not only by code review discipline.
- Adding a new tenant is cheap — a row in `tenants` and a provisioning workflow.
- Cross-tenant analytics (for us, not for customers) are possible through privileged pathways.
- Every architectural decision is stress-tested early against the multi-tenant constraint. No "oh, we didn't think about that" surprises at Month 12.
- Our own three operations exercise multi-tenancy before external customers depend on it.

**Accepted costs:**
- Every query and every MCP call carries tenant context explicitly. Code is slightly more verbose.
- RLS policies add minor per-query overhead (typically single-digit ms).
- Developers must think about tenant context on every change. We accept the cognitive cost as a feature — it prevents errors.
- Debugging across tenants requires explicit elevation (good for security, occasional inconvenience for us).
- Domain tables, analytics queries, and migrations all need multi-tenant awareness.

**Rules this decision creates:**
- No table without `tenant_id` (exceptions: platform-global tables like `agent_definitions`, `prompts`, `users` which are explicitly cross-tenant by role).
- No "current tenant" global or implicit state. Tenant context is always an explicit parameter.
- No query issued without a tenant context object (enforced by Drizzle query helpers in `packages/db`).
- RLS policies are defined per table at creation time in the migration, not added later.
- Testing includes multi-tenant adversarial scenarios: create two tenants with overlapping data, verify the database blocks cross-tenant reads even when the application has a bug.

## Revisit conditions

- If our customer base grows to a scale (5000+ tenants) where shared-schema performance becomes a bottleneck and sharding or per-tenant schemas are required. We don't design for this now; we design so the refactor is possible.
- If we win a customer whose compliance posture requires physical database isolation (per-tenant database). In that case, we support hybrid: most tenants shared-schema, a small number on dedicated instances, behind the same application code.
- Never revisited downward. The decision to be multi-tenant does not get reversed.

This is the single most important architectural decision in the early codebase. It is non-negotiable.
