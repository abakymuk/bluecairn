---
description: Scaffold a new agent package per docs/AGENTS.md § Agent anatomy
argument-hint: <agent-code>
---

Task: scaffold a new agent — `$ARGUMENTS`.

1. Read `docs/AGENTS.md` § Agent anatomy in full. The file list and policy defaults there are authoritative.
2. Confirm the agent code and persona name against the table in `.claude/CLAUDE.md`. Persona names are stable — never rename an existing one.
3. Create `packages/agents/src/$ARGUMENTS/` with:
   - `prompt.md` — frontmatter (`version`, `model`, `temperature`) + content placeholder.
   - `meta.ts` — declares model, tool list, default policies.
   - `tools.ts` — MCP tool registrations only. No direct vendor SDK imports.
   - `policies.ts` — default approval policies. Ship in `approval_required`.
   - `guardrails.ts` — pre-execution checks (tenant scope, rate caps, cost caps).
   - `evals/unit.jsonl`, `evals/regression.jsonl`, `evals/rubric.md`, `evals/adversarial.jsonl`.
   - `index.ts` — barrel.
4. Add the agent to orchestrator routing and to the `agent_definitions` seed.
5. Autonomy is earned per-tenant, not granted at ship. Do not wire any workflow to `autonomous` by default.
6. Do not edit `docs/AGENTS.md` — Vlad owns that update.

Present the file plan and wait for approval before writing.
