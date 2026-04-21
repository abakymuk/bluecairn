---
description: Review the current branch against BlueCairn engineering principles
---

Task: review the current branch against `main`.

1. Run `git diff main...HEAD --stat` then `git diff main...HEAD`. Read the full diff before commenting.
2. Check the diff against the ten principles in `.claude/CLAUDE.md` § Architecture principles:
   1. Layer boundaries — no cross-layer coupling.
   2. Agents never call vendors directly — MCP tools only, no SDK imports in `packages/agents/`.
   3. Durable by default — side effects go through Inngest, not `setTimeout` or raw queues.
   4. Multi-tenant from commit #1 — every tenant-scoped table has `tenant_id`, every query filters by it, RLS is set.
   5. Prompts are versioned artifacts — any prompt change has a version bump and an eval update.
   6. Observability — every LLM call traces to Langfuse.
   7. Idempotency on the boundary — every webhook, tool call, and user command has an idempotency key.
   8. Human approval default — new actions ship in `approval_required`.
   9. Audit everything — every agent action hits `audit_log`.
   10. Fail loud in dev, fail soft in prod — no stack traces reaching operators.
3. Additionally flag: `any` types without a narrowing comment, missing tests, missing RLS policies, prompt edits without eval updates, and vendor SDK imports outside `packages/integrations/`.
4. Report high-confidence findings only, with file:line references. Noise is worse than a missed issue. If the branch is clean, say so.
