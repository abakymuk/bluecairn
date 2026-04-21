# ADR-0004: Inngest for durable execution

**Status:** Accepted
**Date:** 2026-04-20
**Deciders:** Vlad, Claude (cofounder-architect)

## Context

BlueCairn performs many operations that must survive crashes, retries, and restarts: agent runs that span multiple tool calls, vendor webhooks that must not be lost, scheduled jobs (morning briefings, weekly close), long-running workflows (multi-step disputes, onboarding), and recovery from transient vendor API failures.

A naive approach — in-memory execution with setTimeout, raw queues, or cron jobs — fails in production. A pod restart loses in-flight work. A webhook delivered during a deploy is silently dropped. A retry storm on a vendor outage amplifies into incident.

We need a **durable execution** system that:
- Checkpoints work step by step so that crashes don't lose progress.
- Handles retries with exponential backoff.
- Supports scheduled and delayed invocations.
- Provides visibility: which runs are live, which failed, where they are stuck.
- Integrates cleanly with our TypeScript codebase.
- Is operable by a solo founder without dedicated ops effort.

## Decision

**We use Inngest as our durable execution engine for all side-effecting operations.**

Every action that has a side effect outside our own process — send a message, post a review response, create a PO, update an external system, run a scheduled job — executes as an Inngest function.

Inngest provides:
- **Durable steps** (`step.run`): checkpointed execution across function lifetimes.
- **Retries with backoff**: configured per step.
- **Scheduled invocations** (`cron`, `sleep`, `waitForEvent`): for morning briefings, weekly closes, delayed follow-ups.
- **Concurrency controls**: per-tenant rate limits, global concurrency caps.
- **Observability**: step-level traces in the Inngest dashboard, correlated with our own Langfuse and Sentry.

We use **Inngest Cloud** as the managed hosting layer. Self-hosting is possible later if economics or data-residency require it.

## Alternatives considered

**Temporal.** Industry-grade durable execution, used by large companies. Richer workflow primitives. But: heavy to operate (self-hosted requires dedicated infrastructure), steeper learning curve, bigger SDK footprint, more expensive managed option. Overkill for our scale; we'd pay the complexity tax on every workflow even when we don't need its full power. Rejected for now — revisit if we outgrow Inngest.

**Trigger.dev.** Very close competitor to Inngest with similar DX. Active development. But: smaller ecosystem, less mature ergonomics at the time of decision, Inngest has stronger Vercel-deployment integration and better step-level primitives for our patterns. Close call; Inngest wins on polish and track record.

**Raw queues (BullMQ, SQS, similar).** Implement durability ourselves. Rejected: we'd be rebuilding the primitives Inngest provides, with less observability, more code to maintain, and more failure modes. Solo-founder scarcity favors tools that absorb complexity.

**Postgres-based job queues (pg-boss, graphile-worker).** Attractive — one less moving piece since we already run Postgres. But: lacks step-level checkpointing, weaker scheduling primitives, no built-in observability dashboard. We'd bolt on all of that. Rejected; Inngest's step primitive alone is worth the separate system.

**Cloudflare Workers + Queues + Cron Triggers.** Edge-native durable primitives. Attractive for cost and deployment model. But: newer, less mature for complex workflows, harder to reason about step-level durability and visibility. Rejected for now; revisit when edge workflows mature.

## Consequences

**Accepted benefits:**
- Every side-effecting operation is crash-safe by default.
- Retries, scheduling, and sleep are first-class primitives, not code we write and debug.
- Step-level observability without our own instrumentation.
- Inngest's local dev experience means we can simulate production flows on our laptop.
- Concurrency and rate-limiting are declarative, not hand-rolled.
- Our TypeScript functions remain pure-looking — the durability is a decorator, not a framework rewrite.

**Accepted costs:**
- One more external vendor (Inngest Cloud). We accept this for their operational leverage.
- Step-level checkpointing has small latency overhead per step. Acceptable for our workloads.
- Inngest's pricing scales with function invocations; we track this cost.
- Debugging across Inngest steps requires learning their dashboard in addition to our own traces.
- If Inngest had a major outage, our async operations would queue up but not fail catastrophically — we've validated this recovery behavior.

**Rules this decision creates:**
- Any operation with a side effect that is not internal-only uses Inngest. No setTimeout, no custom queues, no cron jobs outside Inngest.
- Function boundaries are drawn thoughtfully: each step should be idempotent and resumable.
- Event naming follows a clear convention: `domain.action.subject` (e.g., `vendor.delivery.reconciled`).
- Tenant context is carried in every event payload, never inferred.
- Inngest functions are tested with integration tests against the local Inngest dev server.

## Revisit conditions

- If Inngest's pricing at our scale becomes materially worse than self-hosting or alternatives.
- If we grow to a team where we can operate Temporal economically and its richer features (long-running workflows, complex signals) become valuable.
- If Inngest as a vendor shows signs of instability or misalignment with our needs.
- If Cloudflare or another edge platform delivers a durable-execution primitive that fits our stack better.

Default bet: Inngest will scale with us through at least the first 1,000 tenants. Beyond that, we reassess.
