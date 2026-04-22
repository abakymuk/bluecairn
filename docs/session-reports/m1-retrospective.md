# M0 + M1 retrospective

*Written: 2026-04-22*
*Tracking issue: [BLU-39](https://linear.app/oveglobal/issue/BLU-39/m1-retrospective)*
*Covers:* M0 Foundation (2026-04-20 → 2026-04-21) + M1 Orchestrator + Comms (2026-04-21 → 2026-04-22)

---

## Shipped vs plan

### M0 — Foundation (ROADMAP target: Apr–May 2026)

All 5 milestones 100% in Linear, closed 2026-04-21:
1. **Monorepo scaffolded** — Turborepo + Bun workspaces + strict tsconfig + `.claude/CLAUDE.md`. BLU-1, BLU-2, BLU-6, BLU-7, BLU-8.
2. **Accounts & infra provisioned** — Neon (dev/staging/main), Telegram bot via @BotFather, Langfuse Cloud (pivoted from self-host during M0 — see ADR-0010). BLU-3, BLU-4, BLU-5.
3. **First migration + RLS verified** — Drizzle schema for core platform + agent platform + audit_log (immutable) + memory_entries (pgvector); RLS enabled on every tenant-scoped table; 8 adversarial cross-tenant tests green. BLU-9, BLU-10, BLU-11, BLU-12.
4. **First inbound Telegram message persisted** — Hono `/webhooks/telegram` → canonicalize → `withTenant` persist. First real Nick-to-bot message in `threads` table. BLU-13, BLU-14.
5. **CI/CD green end-to-end** — GitHub Actions (typecheck, lint, RLS + webhook integration tests on Postgres service container). Railway staging deploy of `apps/api` on merge-to-main. BLU-15, BLU-17. (BLU-16 canceled as duplicate of BLU-15.)

### M1 — Orchestrator + Comms (ROADMAP target: 2026-05-30)

All 4 milestones 100%, closed 2026-04-22:
1. **Durable plumbing + telemetry** — Inngest Cloud provisioned, `apps/workers` scaffolded, Vercel AI SDK + Langfuse Cloud instrumentation smoke-tested on staging, webhook refactored to emit `thread.message.received` event instead of inline-processing. BLU-18, BLU-19, BLU-20.
2. **Comms + orchestration** — Comms MCP `send_message` tool, Orchestrator v0.1 (`orchestrator.route` Inngest function — Haiku intent classifier → whitelist routing to `concierge`), Concierge catchall agent stub. BLU-21, BLU-22, BLU-23.
3. **Approval + ops-web** — Telegram `callback_query` handler, full inline-button approval data-path (callback → `approval_requests` → Inngest-gated action), `apps/ops-web` Next.js 15 + Better Auth + Google OAuth + allow-list, read-only thread viewer. BLU-24, BLU-25, BLU-26, BLU-27.
4. **Exit gates + ADRs** — RLS adversarial suite expanded to L2/L4/L6 (orchestrator/MCP/workers), M1 exit-gate harness (synthetic load → P95 latency + cost tracking validation), ADR-0009 Telegram-first + ADR-0010 Langfuse Cloud authored + ratified. BLU-28, BLU-29, BLU-30.

Also absorbed into M1 (not originally scoped): BLU-36 workers CI-driven staging deploy + BLU-37 workers self-sync readiness-gated retry — emerged from Railway deployment realities that weren't obvious pre-staging.

**Delta: ~3 weeks early** vs ROADMAP.

---

## Why early

Three compounding factors:

1. **M0 scaffolding carried more than M0 needed.** The monorepo, RLS-adversarial tests, audit_log immutability, and agent-platform schema all landed in M0 even though only core platform tables + first Telegram message were required for the M0 gate. Result: M1 started with ~60% of its plumbing already in place.
2. **Phase-3 decisions (approval UX, ops-web auth, orchestrator intent classifier) were resolved upfront rather than iterated.** No design-then-rewrite cycles. Better Auth + Google OAuth + email allow-list was decided before BLU-26 started; Haiku-as-classifier decided before BLU-22 started; two-button approval (Approve/Reject only) decided before BLU-25 started. Each decision saved a rebuild.
3. **Railway deployment flaws surfaced early.** BLU-36 + BLU-37 + the Inngest dev-mode fix + CI deadlock fix all happened in one day (2026-04-22). Painful, but it flushed the staging path before M2 depends on it. Cost: ~4 unscoped PRs. Benefit: M2 doesn't hit them.

What *didn't* compress the timeline: scope-cutting. Every BLU-NN in the original M0/M1 plan shipped except BLU-16 (duplicate of BLU-15). `comms.send_email` was explicitly deferred during ADR-0009 work (see "Tech debt" below); everything else is in.

---

## Tech debt accepted

1. **BLU-34 — orchestrator + agent failure-path hardening.** BLU-22 classifier LLM failure throws without `audit_log`; BLU-23 concierge LLM failure leaves `agent_runs` in `running` state forever; BLU-22 policy-step returns hardcoded default instead of reading `policies` table. Acceptable for M1 (no real production traffic, Inngest retries mask most issues), **not acceptable for M2** — Sofia will hit LLM failures orders of magnitude more often and the audit log is the source of truth for ops-web's Activity view.
2. **BLU-35 — eval harness not yet wired.** `packages/agents/src/concierge/evals/unit.jsonl` exists as the authoring artifact; no runner executes it. `bun run eval concierge` doesn't work. **Not acceptable for M2** — Sofia's M2 exit gate ("100% of discrepancies caught") cannot be measured without a runner. *Update 2026-04-22 (post-retro): resolved in the same session via ADR-0011 — in-repo minimal TypeScript runner at `packages/evals/`, not Braintrust/Promptfoo.*
3. **Per-step OTel trace topology in Langfuse** (ADR-0010 consequence). Inngest's `step.run` checkpointing emits one OTel trace per checkpointed step, so a single message→response flow surfaces as ~13 sibling `inngest.execution` traces in Langfuse instead of one unified tree. In-step nesting (`llm.*` and `tool.*` spans) renders correctly. **Polish deferred to M2+**; tracked in ADR-0010 consequences.
4. **`comms.send_email` was dropped from M1 scope.** ROADMAP Month 1 originally listed both `send_message` and `send_email`; only `send_message` shipped. Dana (M3) needs `send_email`. Tracked as part of the outbound-channel expansion tracking issue (see "Carry-forward").
5. **M0 + M1 Linear project status still `Backlog`** despite 100% milestone progress. Mechanical cleanup; Step 6 of the current milestone-0 plan flips them to Completed.

Items 1, 2, 5 are closed within milestone-0 (`M1 debt + Sofia prereqs`). Items 3 and 4 carry into M2+.

---

## ADR candidates for M2

Decisions that Sofia build will force, better ratified now than rediscovered mid-sprint:

1. ~~**Eval harness choice — Braintrust + Promptfoo vs minimal custom runner.**~~ *Resolved by [ADR-0011](../adr/0011-minimal-in-repo-eval-runner.md) on 2026-04-22 during BLU-35 — in-repo TypeScript runner in `packages/evals/`, advisory CI, revisit triggers documented.*
2. **Documents MCP transport — vendor-specific OCR vs Anthropic PDF + vision.** Sofia's `parse_invoice` and `extract_receipt` need a reliable document-understanding path. Anthropic's PDF + vision is model-abstraction consistent (ADR-0005) but more expensive per parse than vendor OCR; vendor OCR drags another SDK into `packages/integrations/`. **Load-bearing: rebuilding this after Sofia ships is a multi-week cost.**
3. **Memory retrieval policy — recency vs semantic vs hybrid, eviction threshold.** `packages/memory/` is a stub. Sofia + future agents will write `memory_entries` aggressively; without a retrieval policy, memory queries either return everything (expensive) or miss relevant context (failure mode). **Load-bearing: changing retrieval semantics post-hoc rewrites every memory-dependent prompt.**

Optional but worth considering:

4. **Approval UX iteration — two-button vs richer control.** BLU-25 shipped Approve/Reject only. Sofia's vendor-dispute drafts may want Approve / Reject / Edit-then-send. Ratify scope before M2-milestone-5 builds the Sofia workflow e2e.
5. **Outbound-channel expansion timeline.** Tracked as a separate issue (not this retro), but may deserve an ADR codifying when/how `comms.send_email` + voice + WhatsApp get added.

---

## Carry-forward (blocks M2 execution)

1. **Track A Month 0 confirmation from Nick.** ROADMAP Month 0 Track A: commissary contracted, permits secured, menu locked, wholesale conversations started. Month 1 Track A: farmers-market launch. Month 2 Track A: first real vendor relationships — flour, butter, packaging. **Sofia's training data depends on Track A happening.** Platform side has no visibility into Track A status right now; user will confirm w/ Nick. Until confirmed, M2 milestones 1–6 stay as shape-only stubs in Linear.

2. **M2 scope decision.** ROADMAP schedules Sofia in Month 2 and Marco+Dana in Month 3. M0+M1 shipped 3 weeks early. Three options: (a) keep Sofia-only, bank the buffer for Track A catch-up; (b) pull Marco+Dana forward into M2; (c) slip M2 start to match Track A reality. **Recommendation: (a)** — product integrity comes from matching platform cadence to Nick's operational reality, not from beating the ROADMAP.

3. **M1 ADR backlog.** Three candidate ADRs above (eval harness, Documents MCP, memory retrieval) should be drafted + ratified **before** M2 decomposition, not during.

---

## What worked (worth repeating for M2)

- Small Linear issues with explicit AC + out-of-scope sections. BLU-1 through BLU-37 average ~5 AC items each. Claude Code + human reviewer both reference them; drift rare.
- Every issue references a doc section or ADR. Non-obvious decisions surface early.
- PRs small: most M1 PRs under 300 lines. Exit-gate harness (BLU-29) was the largest at ~800 lines and should have been two PRs in hindsight — one-off lesson, not a pattern to break.
- Supervised-mode-by-default for approval flow. Two-tap UX caught three false positives in BLU-25 dogfood tests that would have auto-sent in autonomy mode.
- Staging deployed on merge-to-main from Day 1 (BLU-17). Every PR exercised the real deploy path; no "works on my machine."

## What didn't work (avoid for M2)

- **Four follow-up PRs landed after the "done" state on 2026-04-22** (Inngest dev-mode fix, CI deadlock fix, workers CI-driven deploy, workers self-sync retry). None had a parent Linear issue at the time of the PR. This is the anti-pattern LINEAR-SETUP.md § "Anti-patterns" flags: "PR that doesn't reference an issue (unless it's a trivial fix)." These weren't trivial. For M2: if an unscoped issue emerges, file a BLU-NN first, then PR against it. Takes 2 minutes; preserves traceability.
- **Two ADRs (0009, 0010) ratified same-day as the pivot code they describe** (BLU-30, merged 2026-04-22 18:45). Timing worked because the pivots were already lived; risk was that the ADRs rubber-stamp rather than discipline. For M2: when a pivot is contemplated, draft the ADR *before* the code lands whenever the lead time allows.
- **`apps/workers` shipped without the readiness-gated self-sync pattern** (BLU-37). Three PRs to stabilize. Lesson: when adding a new Inngest service, assume the handler mount is asynchronous from the process boot and wait for it explicitly.

---

## Next actions (not in this retro — see M2 milestone-0)

- BLU-34 ship — orchestrator + agent failure paths hardened
- BLU-35 ship — in-repo eval runner wired (ADR-0011)
- BLU-38 ship — docs actualized (in flight, same PR as this retro)
- BLU-39 close — this retro written (self-referential; closes on PR merge)
- M2 milestones 1-6 stubbed in Linear (shape only; issues wait on Track A)
- Comms outbound-channel expansion tracking issue opened
- M0 + M1 projects flipped from `Backlog` to `Completed`
- User confirms Track A Month 0 status with Nick
