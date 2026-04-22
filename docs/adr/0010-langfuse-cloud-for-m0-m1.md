# ADR-0010: Langfuse Cloud for M0/M1

**Status:** Accepted
**Date:** 2026-04-22
**Deciders:** Vlad, Claude (cofounder-architect)

## Context

ARCHITECTURE principle #6 is *observability before scale*: every LLM call is traced in Langfuse from Day 1. The architecture commits to Langfuse as the observability backend; it does not commit to how it is hosted. Early drafts of CLAUDE.md § Tech stack read "Langfuse (self-hosted)," on the theory that we would own our observability infrastructure end-to-end.

During M0 we confronted what self-hosted Langfuse v3 actually costs in operational surface. A production-ready self-host is Postgres + ClickHouse + Redis + S3-compatible object storage + two application containers (web + worker). On Railway/Fly, a minimum configuration runs roughly $60–120/month at zero traffic; the ClickHouse tier is the dominant cost and the dominant operational unknown for a solo-founder stack. Against that, our M0 + M1 traffic is negligible — Nick sending a handful of Telegram messages, eval runs, and staging smokes. We were about to pay for and operate a ClickHouse cluster in exchange for observability of a few thousand spans a month.

Langfuse Cloud publishes a Hobby tier: 50,000 events/month, US region, free, zero infrastructure. We pivoted M0 to Cloud Hobby; staging now emits traces to `us.cloud.langfuse.com` and the code in `packages/agents/src/tracing.ts` wires `@langfuse/tracing` via OTel. The decision was made in practice; this ADR ratifies it and specifies when to reverse it.

## Decision

**For M0 and M1, BlueCairn uses Langfuse Cloud (Hobby tier, US region) as the LLM observability backend.**

Concretely:

1. Traces go to `https://us.cloud.langfuse.com`, project id `cmo8v8xq601xnad07bma8r7qr`.
2. `packages/agents/src/tracing.ts` configures the `NodeTracerProvider` + `LangfuseSpanProcessor` against the Cloud endpoint. No code change is needed to flip to self-host later — only environment variables.
3. `LANGFUSE_HOST` + `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` are the only required env vars; the self-hosted `LANGFUSE_HOST=https://langfuse.bluecairn.internal` example in `.env.example` is replaced with the Cloud URL.
4. Span attributes carry no customer PII. Tenant is represented by `tenant_id` (a UUID), thread by `thread_id` (UUID), message by `message_id` (UUID). No raw customer text fields are sent to Cloud as span attributes. Prompt + completion bodies are sent to Langfuse via its intended API (that is the product); this ADR constrains *attribute* metadata, not observation payloads.
5. Self-hosted Langfuse stays the intended end-state before Month 12 pilot; the migration is its own future ADR.

## Alternatives considered

**Self-hosted Langfuse v3 on Railway/Fly.** Rejected for M0/M1 — multi-container deploy, ClickHouse ops expertise we don't have, $60–120/mo for observability of near-zero traffic, and no compliance driver forcing the question. Defers shipping agent work for infrastructure that isn't on the critical path yet. Revisit at Month 12.

**Helicone.** Rejected — Langfuse was already selected alongside the Vercel AI SDK (ADR-0005) for its first-party OTel integration via `@langfuse/tracing`. Switching observability vendors mid-M1 is churn; Helicone would require rewriting the instrumentation layer.

**LangSmith.** Rejected — LangChain-adjacent, designed around a framework we don't use; pricing for independent operators is less favorable than Langfuse Hobby. Mental model cost of adopting LangChain idioms is not free.

**Logs-only, no hosted observability.** Rejected — violates principle #6. Stdout grep is not observability. You cannot reason about token cost, latency distribution, prompt regressions, or trace hierarchy from logs. We commit to real observability from Day 1 or we do not commit at all.

## Consequences

**Accepted benefits:**
- Zero infrastructure overhead during the signal-loop phase. Engineering attention stays on agents and the orchestrator.
- Real traces with correct token + USD cost attribution from Day 1 (verified by BLU-20 + BLU-33 on staging).
- 50,000 events/month headroom comfortably covers M0 + M1 volume including eval runs.
- Migration to self-host is a config change, not a code change. No lock-in beyond the account.

**Accepted costs:**
- Data resident in US (Hobby tier region). Acceptable while all customers are US-based. Becomes a gating constraint the moment a non-US customer asks.
- **Per-step OTel trace topology is a known limitation.** Inngest's `step.run` checkpointing emits one OTel trace per checkpointed step, so a single message-to-response flow surfaces in Langfuse as ~13 sibling `inngest.execution` traces rather than one unified tree. In-step nesting (the `llm.*` and `tool.*` spans emitted inside a step) renders correctly; cross-step unification is polish deferred to M2+. We accept this; it is not an open question (session-report-m1-loop observation #8).
- No private-network access; traces egress over the public internet (TLS).
- Cost model shifts when we scale: beyond Hobby, Cloud pricing becomes a real line item. This is a trigger for the self-host migration, not a permanent cost.

**Rules this decision creates:**
- Span attributes must not contain customer PII (names, phone numbers, plaintext messages). Payload bodies are fine; *attributes* are searchable and must stay tenant-scoped UUID-only.
- Alert wired at 40,000 events/month (80% of Hobby quota). Breaching triggers a planned migration, not a scramble.
- The self-hosted deploy is deferred to its own ADR at revisit time.

## Revisit conditions

- Langfuse event volume ≥ 40,000/month (80% of the Hobby quota) for two consecutive weeks.
- T-3 months before the Month 12 pilot window (approximately January 2027) — we plan the migration before the pilot loads it.
- Any compliance or data-residency request from a prospective customer that Hobby cannot satisfy.

Until one of these fires, Cloud Hobby remains the backend. Self-hosting earlier would trade agent-quality time for infrastructure time we do not need to buy yet.
