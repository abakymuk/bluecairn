# ADR-0011: Minimal in-repo eval runner for M2/M3

**Status:** Accepted
**Date:** 2026-04-22
**Deciders:** Vlad, Claude (cofounder-architect)

## Context

ARCHITECTURE.md § Evals, ENGINEERING.md § Layer 3 Agent evals, AGENTS.md § Prompt versioning and eval gating, and CLAUDE.md § Tech stack all named **Braintrust + Promptfoo** as the intended eval toolchain. None of this was ever installed. `packages/evals/` shipped in M1 as a stub plus the BLU-29 exit-gate harness; concierge unit cases were authored as `packages/agents/src/concierge/evals/unit.jsonl`, but `bun run eval concierge` — required by BLU-23 AC #14 — does not work. M2 (Sofia) cannot close its exit gate ("100% of discrepancies caught", "zero false disputes") without a runner that executes those assertions.

BLU-35 forced the choice. Braintrust is a managed eval platform (hosted UI, datasets, per-run pricing, proprietary). Promptfoo is an open-source CLI that reads YAML/JSONL and runs assertions locally. Both are useful. Neither is load-bearing for the volume M0 + M1 + early-M2 generate: five cases for Concierge, fifteen-ish planned for Sofia unit. Hosted eval infrastructure at this scale is a solution looking for a problem. We also have no team yet — a hosted UI has nobody to use it, and cross-tenant eval comparison doesn't exist until external customers land (Month 12+).

What we *do* have: the Vercel AI SDK `generateText` wrapper (`packages/agents/src/llm.ts`), which already emits Langfuse traces with tenant/run/correlation metadata (ADR-0005, ADR-0010); an authored `prompt.md` per agent; JSONL cases with a stable case schema. The gap between "cases exist on disk" and "`bun run eval concierge` runs the cases" is on the order of a few hundred lines of TypeScript.

## Decision

**For M2 and M3, BlueCairn ships its own minimal eval runner inside `packages/evals/`.** Concretely:

1. **Runner location:** `packages/evals/src/runner/`. Entry point: `packages/evals/src/runner/cli.ts`, invoked via `bun run eval <agent-code>` (the existing `packages/evals/package.json` `eval` script is rewired to this CLI).
2. **Per-agent evaluable entry point:** each agent exports an `evalCall` function (e.g. `packages/agents/src/concierge/evalCall.ts`) that accepts a case input + `LlmMetadata` and calls `generateText`. The runner imports agent code one-way (`evals → agents`). Agents do **not** depend on evals.
3. **Prompt source of truth:** the runner reads the authored `prompt.md` file directly. The DB seed in `packages/db/scripts/seed-<agent>-prompt-v<N>.sql` is a **derived artifact** of the authored file. Drift between the two is the author's responsibility to prevent when updating prompts; a future CI check may compare the two but is not in BLU-35 scope.
4. **Assertions supported in unit cases:** `contains`, `forbidden`, `ends_with_signoff`, `max_sentences`, `should_ask_clarification`, `should_acknowledge_originally`. The first four are deterministic string/regex checks. The last two use an **LLM-judge** (Haiku 4.5) that must return the literal text `YES` or `NO` and is parsed with a strict case-sensitive exact-match parser. Anything else (including `Yes`, `Y`, `yes.`, `YES.`) is a fail rather than a silent pass.
5. **Langfuse tagging:** the `LlmMetadata` type gains optional `eval?: string` (e.g. `"concierge/unit"`) and `caseId?: string` (e.g. `"ack-vendor-complaint"`). These flow through to the existing `experimental_telemetry.metadata` as `eval` and `case_id` keys; Langfuse's trace-by-metadata view groups them. No new span hierarchy is added.
6. **CI integration:** a new `.github/workflows/eval.yml` runs `bun run eval concierge` on PRs that touch `packages/agents/**` or `packages/evals/**`, posts a pass/fail summary, and **always exits 0 at the workflow level**. Evals are advisory, not a merge gate. Locally, the CLI exits 1 on any failure. Folding evals into the blocking `ci.yml` requires (a) runner stability across several PRs and (b) explicit ADR-or-ticket sign-off to flip the gate.
7. **Out of scope:** regression evals (captured from real traffic post-M2-launch), rubric evals with written judging rubrics (M3+), adversarial evals beyond what already lives in `unit.jsonl` (M3+), per-PR eval gating (M4+).

## Alternatives considered

**Braintrust.** Rejected for M2/M3 — hosted UI is the primary value proposition, and we have no team to consume it. Per-eval pricing becomes a real line item at eval volume (10+ cases × dozens of prompt iterations × multiple agents × months), paid before we know what shape our evals converge on. Good tool; wrong timing. Revisit when (a) team grows past two engineers, (b) cross-tenant eval comparison across external customers becomes a real need, or (c) eval volume exceeds ~1,000 cases/run for two consecutive weeks.

**Promptfoo.** Rejected for M2/M3 — another CLI to install, learn, and configure, for a harness we can write in a few hundred lines that reuses our existing `generateText` + Langfuse stack. Promptfoo's strength is rapid prompt iteration across many providers; we have exactly one provider per agent (pinned via ADR-0005) and the Vercel AI SDK already abstracts provider choice. Adopting it before we've stressed our own runner is premature optimization. Revisit at the same triggers as Braintrust.

**Both (as originally documented).** Rejected — would double the tool surface, double the things that can go wrong in CI, and force two configuration systems for the same assertion data. "Use A for local, B for CI" invariably ends with different behaviors between the two environments.

**No runner; keep only `vitest` unit tests on assertion helpers.** Rejected — BLU-23 AC #14 explicitly names `bun run eval concierge` as the completion bar, and M2 Sofia's exit gate references eval-suite-pass as a condition. We need a real runner, not just helper functions nobody calls.

## Consequences

**Accepted benefits:**
- Zero net-new vendor dependencies. `packages/evals/` depends on `@bluecairn/agents` + `@bluecairn/core` (already in the workspace) plus whatever the runner imports from `ai` / `@ai-sdk/anthropic` (already installed transitively via agents).
- Runner owns the full pipeline: JSONL parse → LLM call (via `generateText`) → assertion pass/fail → report. One place to debug, one place to extend when new assertion kinds arrive.
- Langfuse gets every eval call tagged with `eval` + `case_id` out of the box; trace-by-metadata queries work day-one.
- CI loop stays fast — evals run only on relevant path changes; the LLM-judge calls are Haiku (~$0.001/case).

**Accepted costs:**
- We maintain the runner. Each new assertion kind is a TypeScript function, not a config. Acceptable — assertion shape is stable; the last novel assertion shape landed with BLU-23.
- No hosted UI for reviewing eval history. Reports live in `packages/evals/reports/` as timestamped Markdown + the Langfuse traces themselves (searchable via Langfuse's metadata filter). If the ops pod grows or we need non-engineer eval review, this is a revisit trigger.
- Advisory CI means a red eval doesn't block merge. Authors are responsible for reading the workflow output. We accept the honor system at M2 volume; the moment we promote to a blocking gate we ratify it with a fresh ADR.

**Rules this decision creates:**
- **One-way dependency:** `@bluecairn/evals` may import from `@bluecairn/agents`. The reverse is forbidden — agents stay a leaf package consumable by workers + evals + future scripts.
- **Prompt source of truth:** `packages/agents/src/<agent>/prompt.md`. SQL seeds are derived. Never hand-edit an SQL seed's prompt text independent of the `.md`.
- **Langfuse metadata schema:** eval runs set `metadata.eval = "<agent>/<suite>"` and `metadata.case_id = "<case-id>"`. Deviating from this naming breaks the Langfuse dashboards that depend on it.
- **Strict LLM-judge parser:** judges return `YES` or `NO`, exact-match, no trimming, no punctuation. Any drift is a fail, not a lenient pass. This keeps the judge itself honest.

**Documents updated in the same PR:**
- `docs/ARCHITECTURE.md` § Evals (replace Braintrust + Promptfoo naming + soften CI claim to advisory).
- `docs/ENGINEERING.md` § Layer 3 Agent evals (same).
- `docs/AGENTS.md` § Prompt versioning and eval gating (drop tool names, soften CI claim).
- `docs/CLAUDE.md` § Tech stack (replace tool naming).
- `docs/session-reports/m1-retrospective.md` (ADR candidate resolved, rewording).
- `docs/DECISIONS.md` index.

## Revisit conditions

- Eval volume ≥ 1,000 cases per run for two consecutive weeks (hosted tooling becomes worth the per-eval cost).
- Team size grows past two engineers (hosted UI pays for itself in review time).
- Cross-tenant eval comparison becomes a real operational need (external customers, Month 12+ pilot window).
- LLM-judge patterns proliferate beyond a handful (hosted rubric-judge infrastructure starts to matter).
- The advisory CI stance gets gamed: a prompt merges with red evals and ships a regression to staging. That single incident flips the gate to blocking and triggers a fresh ADR.

Until one of these fires, the minimal in-repo runner stays. Promoting to Braintrust/Promptfoo later is a config-and-adapter change, not a rewrite — the JSONL cases remain platform-agnostic.
