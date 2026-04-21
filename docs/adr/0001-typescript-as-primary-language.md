# ADR-0001: TypeScript as primary language

**Status:** Accepted
**Date:** 2026-04-20
**Deciders:** Vlad, Claude (cofounder-architect)

## Context

BlueCairn is built by a solo founder-engineer with Claude Code as primary development tool, shipping a multi-tenant production system. Language choice shapes what we can build, how fast, and how safely.

The system spans: HTTP APIs (orchestrator, webhooks), long-running workers (Inngest functions), frontend web apps (ops-web, admin-web), MCP servers (one per capability domain), integration adapters (one per vendor), agent runtimes (prompt execution), and shared domain logic (money, tenant context, domain types).

We need a language that:
- Is understood deeply by Claude Code (we amplify velocity through AI).
- Has strong type safety (agents + multi-tenant data require contracts enforced by tools, not vigilance).
- Spans frontend and backend without context-switching.
- Has a mature ecosystem for every integration we'll touch (POS, accounting, banking, comms).
- Will still be a reasonable choice in 2040 (built-to-last horizon).

## Decision

**TypeScript, in strict mode, is the primary language of the BlueCairn codebase.**

All apps, workers, MCP servers, integration adapters, and shared packages are written in TypeScript. Bun is the primary runtime; Node 22 LTS is the fallback.

Strict mode settings enforced:
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`
- `exactOptionalPropertyTypes: true`
- `noFallthroughCasesInSwitch: true`

No `any` without an attached comment justifying it. No type assertions (`as`) without comments. Unknown input data is typed as `unknown` and narrowed with schema validation (Zod or Valibot).

## Alternatives considered

**Python.** Strong in the AI/LLM ecosystem, but weaker type safety at scale (`mypy` / `pyright` are real but feel bolted-on compared to TypeScript-native). Split frontend/backend context. Claude Code is competent in Python but produces more subtle errors than in TypeScript.

**Go.** Excellent for backend services, strong typing, fast. But: no shared frontend, weaker LLM/agent ecosystem (SDKs are less mature), fewer hand-held integrations with the tools we need (Vercel AI SDK, MCP SDK, Inngest). Pulls us toward a polyglot stack we can't afford to maintain solo.

**Rust.** Right for systems that need it; wrong for an agent-heavy, integration-heavy product where development velocity dominates. Would consume our capacity.

**Elixir / Phoenix.** Beautiful fit for real-time, fault-tolerant messaging. Rejected due to smaller ecosystem, weaker Claude Code proficiency, and single-language-discipline principle.

**Polyglot (e.g., Python for agents, TS for frontend).** Rejected explicitly. One solo developer maintaining two languages means two contexts, two test suites, two dependency trees, two deploy pipelines. The cost compounds.

## Consequences

**Accepted benefits:**
- One language across the entire stack.
- Type safety as a design tool, not just a bug-catcher — types express contracts between layers.
- Claude Code is at its best in TypeScript; velocity amplification is maximized.
- Vast ecosystem for every integration.
- Shared types between frontend and backend prevent a whole class of API bugs.
- Bun gives us fast startup, native TS execution, and a coherent toolchain.

**Accepted costs:**
- Some AI/ML-adjacent libraries are Python-first; we accept gaps or we wrap them via API calls.
- TypeScript's type system is expressive but has rough edges at its complexity frontier. We accept occasional awkward type gymnastics in exchange for overall safety.
- Bun is newer than Node. We accept the risk of edge cases and keep Node 22 as a fallback.
- Team hiring (future) has to filter for serious TypeScript discipline — a pool larger than Rust's but smaller than JavaScript-in-general.

**Rules this decision creates:**
- New services are TypeScript unless a compelling reason exists (documented in a follow-up ADR).
- No `any` except at untrusted-boundary parsing points, narrowed immediately via schema validation.
- Shared types live in `packages/core`.
- Runtime validation (Zod) happens at system boundaries; past the boundary, types are trusted.

## Revisit conditions

- If Claude Code (or its successor) becomes materially better in another language such that velocity differences are measurable and large.
- If a critical integration we need is available only in Python or another language and cannot be reasonably wrapped.
- If a new entrant language arrives with TypeScript-level safety and materially better runtime performance or ergonomics.
- If we grow to a team size where specialization across languages is possible without cost.

At the 5-year mark (2031), re-examine whether this decision still serves us. If it does — no change. If it doesn't — the ADR that supersedes this one will explain why.
