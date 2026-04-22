# BlueCairn — Decisions

*Last updated: April 2026 — v0.1*
*Index of Architecture Decision Records. The actual records live in `adr/`.*

---

## Why this document exists

Every engineering codebase accumulates decisions — explicit and implicit — that shape what it becomes. In six months, no one remembers why we chose Postgres over Planetscale. In two years, no one remembers why MCP, not OpenAPI. In five years, no one remembers why multi-tenant from day one.

**Architecture Decision Records (ADRs)** are our way of refusing to lose that memory. Each ADR captures:

- The context that produced the decision.
- The decision itself.
- The alternatives we considered and rejected.
- The consequences — what we accepted along with the choice.
- The conditions that would cause us to revisit it.

ADRs are immutable once accepted. They are never edited in place. New decisions supersede old ones via new ADRs.

This document is the **index and format guide**. The actual records live in `adr/`.

---

## Format

Every ADR follows this structure:

```markdown
# ADR-NNNN: <Short decision title>

**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-NNNN
**Date:** YYYY-MM-DD
**Deciders:** Vlad, Claude (cofounder-architect)

## Context
<What situation or problem triggered the need for a decision?
 What was true about our constraints, goals, or environment?>

## Decision
<What did we decide? State plainly.>

## Alternatives considered
<What else did we weigh? Why did we reject each?>

## Consequences
<What do we now accept in exchange for this decision?
 Both the intended benefits and the costs we knowingly take on.>

## Revisit conditions
<Under what future circumstances would we re-examine this decision?>
```

Target length: 400–800 words. Enough to capture real reasoning, not so much that no one re-reads them.

---

## Status lifecycle

- **Proposed**: draft, under consideration. Not yet binding.
- **Accepted**: the decision is in force. Referenced freely in code and other docs.
- **Deprecated**: no longer the active guidance, but not explicitly replaced. Rare.
- **Superseded by ADR-NNNN**: replaced by a newer decision. The old ADR stays in the tree, unedited, with a pointer to its successor.

We never delete an ADR. The historical record is part of the institution.

---

## When to write an ADR

Write an ADR when:

- A technical choice will shape the codebase for 12+ months.
- An alternative exists that reasonable engineers would prefer.
- The decision involves tradeoffs that future-us will want to revisit.
- The decision is implicit in the code and not obvious from reading it.

Do not write an ADR for:

- Trivial style or formatting choices (handled by linters and conventions).
- Decisions that are obviously dictated by our VISION or PRODUCT documents (no ADR for "we do multi-tenant"; that's in VISION).
- Third-party library selections unless they represent a structural commitment (we'd write an ADR for "Postgres," not for "zod").

---

## Index

| # | Title | Status | Date |
|---|---|---|---|
| [0001](adr/0001-typescript-as-primary-language.md) | TypeScript as primary language | Accepted | 2026-04-20 |
| [0002](adr/0002-postgres-as-primary-store.md) | Postgres as primary store | Accepted | 2026-04-20 |
| [0003](adr/0003-mcp-as-tool-protocol.md) | MCP as tool protocol between agents and integrations | Accepted | 2026-04-20 |
| [0004](adr/0004-inngest-for-durable-execution.md) | Inngest for durable execution | Accepted | 2026-04-20 |
| [0005](adr/0005-model-abstraction-via-vercel-ai-sdk.md) | Model abstraction via Vercel AI SDK | Accepted | 2026-04-20 |
| [0006](adr/0006-multi-tenant-from-day-one.md) | Multi-tenant from day one | Accepted | 2026-04-20 |
| [0007](adr/0007-chat-first-no-customer-dashboard.md) | Chat-first interface, no customer dashboard | Accepted | 2026-04-20 |
| [0008](adr/0008-managed-service-not-saas.md) | Managed service, not SaaS | Accepted | 2026-04-20 |
| [0009](adr/0009-telegram-first-for-mvp.md) | Telegram-first for MVP | Accepted | 2026-04-22 |
| [0010](adr/0010-langfuse-cloud-for-m0-m1.md) | Langfuse Cloud for M0/M1 | Accepted | 2026-04-22 |
| [0011](adr/0011-minimal-in-repo-eval-runner.md) | Minimal in-repo eval runner for M2/M3 | Accepted | 2026-04-22 |
| [0012](adr/0012-documents-mcp-transport.md) | Documents MCP transport | Accepted | 2026-04-22 |
| [0013](adr/0013-memory-retrieval-policy.md) | Memory retrieval policy | Accepted | 2026-04-22 |

---

## How to add a new ADR

1. Copy the most recent ADR as a starting template.
2. Increment the number. ADRs are numbered sequentially, zero-padded to 4 digits.
3. Give it a short, descriptive title. Title becomes filename: `00NN-<kebab-case-title>.md`.
4. Write it following the format above.
5. Open a PR. Discuss in the PR if needed (yes, even solo — the PR discussion is where the reasoning lives).
6. On merge, update this index.

---

## Relationship to other documents

- **ADRs support ARCHITECTURE.md** — they explain the reasoning behind the architectural principles.
- **ADRs can amend VISION, PRODUCT, or ARCHITECTURE** — if an ADR's decision conflicts with a higher-level document, the higher-level document is updated.
- **ADRs cannot override VISION's core ideology** — those values are not subject to ADR.

---

*Drafted by Vlad and Claude (cofounder-architect) in April 2026.*
*Index updated with each new ADR. Format versioning in git.*
