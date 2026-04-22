# Session handoff — 2026-04-22

*Written: 2026-04-22, end of session*
*Purpose: give a new Claude Code session full context to pick up from where we left off.*
*Precedent: [m1-retrospective.md](m1-retrospective.md) — same format, same directory.*

---

## Summary

M2 milestone-0 (`M1 debt + Sofia prereqs`) is functionally complete. All defined exit criteria — BLU-34 (failure paths), BLU-35 (eval runner + ADR-0011), BLU-38 (doc actualization), BLU-39 (M1 retrospective) — shipped this session across three PRs ([#35](https://github.com/abakymuk/bluecairn/pull/35), [#36](https://github.com/abakymuk/bluecairn/pull/36), [#37](https://github.com/abakymuk/bluecairn/pull/37)). Two architectural questions for M2 were carved into ADRs that need ratification: [BLU-42](https://linear.app/oveglobal/issue/BLU-42) (ADR-0012 Documents MCP transport) and [BLU-43](https://linear.app/oveglobal/issue/BLU-43) (ADR-0013 Memory retrieval policy). One known non-gating follow-up — [BLU-41](https://linear.app/oveglobal/issue/BLU-41) (post-finalize handoff failure path) — sits in Backlog. Sofia build beyond the ADRs is blocked on Track A (Nick's operational reality — commercial kitchen still in prep, no farmers-market launch yet, no real vendor relationships).

**Next action for the new session:** ratify the ADR-0012 + ADR-0013 recommendations below, then draft + PR + merge both ADRs, then pause. Do **not** decompose M2 milestones 1–6 into issues before Track A signal lands.

---

## What shipped this session

Three merged PRs, all on `main` at `cadb024`.

### [PR #35](https://github.com/abakymuk/bluecairn/pull/35) — [BLU-38](https://linear.app/oveglobal/issue/BLU-38) + [BLU-39](https://linear.app/oveglobal/issue/BLU-39) — doc actualization + M1 retrospective
Commit: `6ca147b`. Updated `.claude/CLAUDE.md`, `docs/ROADMAP.md` (Month 0 + Month 1 only), `docs/LINEAR-SETUP.md`, `.env.example` to reflect Telegram-first (ADR-0009) and Langfuse Cloud (ADR-0010). Current-phase line switched from "Month 0 — Foundation" to "Between M1 and M2". Stripped `[M1+]` annotations from `apps/workers/` + `apps/ops-web/`. Filled in the GitHub repo URL. First entry in `docs/session-reports/`: the M1 retrospective itself.

### [PR #36](https://github.com/abakymuk/bluecairn/pull/36) — [BLU-35](https://linear.app/oveglobal/issue/BLU-35) — in-repo eval runner ([ADR-0011](../adr/0011-minimal-in-repo-eval-runner.md))
Commits: `ce13c77` + `7f2a75c` (review fixes). New `packages/evals/src/runner/` package. `bun run eval concierge` runs the 5-case unit suite via the production `generateText` wrapper, passing 5/5. Langfuse tags every eval call `metadata.eval = "concierge/unit"` + `metadata.case_id`. LLM-judge uses strict `YES`/`NO` parser. Advisory CI workflow at `.github/workflows/eval.yml` (always exits 0 at workflow level — promoting to blocking requires a fresh ADR). Rewrote ENGINEERING.md / ARCHITECTURE.md / AGENTS.md / .claude/CLAUDE.md / m1-retrospective.md to replace all Braintrust/Promptfoo references. Review-driven fixes in `7f2a75c`: `${PIPESTATUS[0]}` capture in the workflow, judge token/cost rollup through `runCase`, root `bun run eval` entry via direct passthrough to the package.

### [PR #37](https://github.com/abakymuk/bluecairn/pull/37) — [BLU-34](https://linear.app/oveglobal/issue/BLU-34) — failure paths
Commits: `17ef169` + `a44ca52` (review P1: onFailure) + `fbb6a0f` (review P2: infra-throw tagging). Orchestrator `load-policy` now reads the `policies` table under `withTenant` (filters `tenant_id`, `agent_definition_id IS NULL OR = resolved`, `effective_to IS NULL`, `effective_from <= now()`). Classifier LLM failure writes `orchestrator.classifier_failed` audit row under tenant context (per-attempt semantics, not exactly-once — no `agent_run` exists yet to guard on). Concierge failure path moved to the Inngest function's `onFailure` handler so `agent_runs.status` only flips to `failed` after retries are actually exhausted — fixes the PR-v1 premature-terminal-state bug. Every thrown error tagged `[step=<name>]` via new `toTaggedStepError`, covering both hand-authored throws and raw infra exceptions (Drizzle, `withTenant`, `generateText` panic). 25 workers tests; 117 repo-wide; all green under `doppler run -- bunx turbo typecheck lint test --force`. Out-of-scope carved into [BLU-41](https://linear.app/oveglobal/issue/BLU-41) (post-finalize handoff).

---

## Final Linear state (end of session)

Team BLU has **41 issues** (BLU-1 … BLU-43; BLU-38 → BLU-43 were all opened this session).

- **M0 — Foundation:** 17 issues, all Done + 1 Duplicate (BLU-16). Project status `Completed`. All 5 milestones 100%.
- **M1 — Orchestrator + Comms:** 15 issues (BLU-18 … BLU-30, BLU-37), all Done. Project status `Completed`. All 4 milestones 100%.
- **M2 — Sofia Online:** project status `Backlog` still (active project, not Completed). Milestones:
  - `M1 debt + Sofia prereqs` (milestone-0): **80% progress; all originally-defined exit criteria met.** Done: [BLU-34](https://linear.app/oveglobal/issue/BLU-34), [BLU-35](https://linear.app/oveglobal/issue/BLU-35), [BLU-38](https://linear.app/oveglobal/issue/BLU-38), [BLU-39](https://linear.app/oveglobal/issue/BLU-39). Open (non-gating): [BLU-41](https://linear.app/oveglobal/issue/BLU-41).
  - `Vendor ops domain schema` (milestone 1): stubbed, 0 issues.
  - `Documents MCP` (milestone 2): stubbed; [BLU-42](https://linear.app/oveglobal/issue/BLU-42) parked here as the ADR-0012 authoring ticket.
  - `Memory MCP` (milestone 3): stubbed; [BLU-43](https://linear.app/oveglobal/issue/BLU-43) parked here as the ADR-0013 authoring ticket.
  - `Sofia prompt v1 + eval suite` (milestone 4): stubbed, 0 issues.
  - `Sofia workflow e2e` (milestone 5): stubbed, 0 issues.
  - `M2 exit-gate harness` (milestone 6): stubbed, 0 issues.
- **M3 — Marco + Dana** / **M4 — Iris + Café Acquisition** / **M5 — Leo + First Autonomy:** scheduled chronologically (Jul–Oct 2026); `Backlog`; 0 issues each.

### Open tickets (status and routing)

| Ticket | Title | Status | Milestone |
|---|---|---|---|
| [BLU-40](https://linear.app/oveglobal/issue/BLU-40) | Track: Comms MCP outbound-channel expansion curve | Backlog | (none — tracking ticket, no project) |
| [BLU-41](https://linear.app/oveglobal/issue/BLU-41) | Concierge post-finalize handoff failure path | Backlog | M2 / milestone-0 (non-gating) |
| [BLU-42](https://linear.app/oveglobal/issue/BLU-42) | ADR-0012: Documents MCP transport | Backlog | M2 / milestone 2 |
| [BLU-43](https://linear.app/oveglobal/issue/BLU-43) | ADR-0013: Memory retrieval policy | Backlog | M2 / milestone 3 |

---

## Docs + memory deltas

### Repo docs (in git)

- **New ADR:** [`docs/adr/0011-minimal-in-repo-eval-runner.md`](../adr/0011-minimal-in-repo-eval-runner.md). Added to `docs/DECISIONS.md` index.
- **New session report:** `docs/session-reports/m1-retrospective.md` (PR #35).
- **New session report:** this file — `docs/session-reports/2026-04-22-session-handoff.md` (PR forthcoming).
- **Updated:** `.claude/CLAUDE.md`, `docs/ROADMAP.md` (M0 + M1 only), `docs/LINEAR-SETUP.md`, `docs/ENGINEERING.md`, `docs/ARCHITECTURE.md`, `docs/AGENTS.md`, `.env.example` — all per PR #35 + PR #36.

### Claude memory (local, not in git)

- **Updated:** `project_bluecairn.md` — current phase line, tech stack (ADRs 0001–0011, Langfuse Cloud, in-repo runner), GitHub URL, end-of-session Linear snapshot.
- **Updated:** `project_track_a_status.md` — explicit "do NOT decompose M2 milestones 1–6 before Track A signal" rule per Vlad's 2026-04-22 decision.
- **New:** `project_active_threads.md` — lean status/unblocker/recommendation/pointer per open thread (BLU-41, BLU-42, BLU-43). Points here for decision-tree detail.
- **New:** `feedback_narrow_ac_framing.md` — rule captured earlier: when closing an AC retroactively from a later ticket, flip with the narrow wording Vlad authorized, not the original expansive claim.
- **Index:** `MEMORY.md` updated to 7 entries.

---

## Open architectural questions — decision trees (authoritative source)

These are the reason the new session exists. Ratify + draft + PR + merge each ADR, in this order. Per Vlad's sequencing: ratify both before writing either, so the drafts can mutually reference each other's final shape.

### ADR-0012 — Documents MCP transport ([BLU-42](https://linear.app/oveglobal/issue/BLU-42))

**Scope:** backs `documents.parse_invoice` + `documents.extract_receipt` MCP tools for Sofia's M2 milestone 2. The transport decides cost per document, accuracy on informal farmers-market receipts, and what vendor SDK surface (if any) lands in `packages/integrations/`.

**Options:**
1. **Anthropic PDF + vision via Vercel AI SDK.** ADR-0005-consistent (already how every other LLM call flows). No new vendor SDK. Pay-per-token (~$0.03–0.10/doc at Sonnet pricing depending on pages). Model reasons about unfamiliar invoice structures — matters because farmers-market receipts are informal.
2. **Vendor OCR** (AWS Textract, Google Document AI, Mindee, Rossum). Cheaper per doc (~$0.01–0.05). Explicit per-field confidence scores. But: adds vendor SDK to `packages/integrations/`, weaker on unfamiliar templates, template-matching drift over time.
3. **Hybrid** — OCR first-pass, Anthropic fallback for low-confidence fields. Best accuracy/cost theoretically. Doubles moving parts. Hard to justify at M2 volume (dozens of receipts/month).

**Recommendation: Option (1) — Anthropic PDF + vision.**

Rationale:
- M2 volume is genuinely low (farmers-market cadence, tens of invoices/month).
- Farmers-market vendor receipts are NOT structured forms; they're hand-written or improvised. Model reasoning beats template OCR on this format.
- No new SDK in `packages/integrations/` — keeps the dependency surface tight.
- Stays consistent with ADR-0005 (Vercel AI SDK as the single model abstraction).
- Migration path to OCR is a Documents MCP implementation swap, not an architectural reshape — the tool contract (`parse_invoice(url) → {…confidence}`) stays identical.

**Revisit triggers** (for the ADR body):
- Document volume ≥ 1,000/month for two consecutive weeks.
- Café acquisition (ROADMAP Month 4) brings structured Square / Toast receipts — OCR economics flip because templates are known.
- Per-document cost becomes material on the P&L.
- Anthropic PDF+vision accuracy regression against a hand-labeled benchmark.

**ADR body shape** (per `docs/DECISIONS.md` template):
- Context: re-state the scope + recent M1-retrospective identification of this as a load-bearing candidate.
- Decision: Option (1), specifying tool signatures + confidence threshold routing to human approval per principle #8.
- Alternatives considered: (2) + (3) with the rationale for rejection.
- Consequences: per-doc cost ceiling; rule that agents never import `@ai-sdk/*` directly — Documents MCP wraps it.
- Revisit conditions: the four above.

### ADR-0013 — Memory retrieval policy ([BLU-43](https://linear.app/oveglobal/issue/BLU-43))

**Scope:** backs `memory.search_memory` + `memory.store_memory` for Sofia's M2 milestone 3. `memory_entries` table + 1536-dim pgvector embedding (OpenAI `text-embedding-3-small`) already landed in M0 (BLU-11); embedding provider is fixed, retrieval semantics are not.

**Open sub-decisions:**

1. **Ranking formula.** Options:
   - (a) Pure semantic (cosine top-k).
   - (b) Pure recency (ORDER BY `created_at` DESC, top-k).
   - (c) **Hybrid — `score = cosine_sim + recency_weight * decay(age)`. Top-k = 10 default. `kind` filter required.** ← recommended.
2. **Score threshold.** Options:
   - Hard floor (drop results below threshold, possibly return < k).
   - **Soft ranking (always return top-k; caller interprets the score).** ← recommended.
3. **Eviction policy.** Options:
   - **None in M2 (memory grows unbounded per tenant; fine at M2 volume).** ← recommended.
   - TTL.
   - Per-tenant size cap (LRU-style).
   - Both.
4. **`kind` parameter semantics.** Options:
   - Optional.
   - **Required — prevents accidental cross-domain retrieval (e.g., Sofia pulling Dana's finance memories).** ← recommended.

**Recommendation: hybrid cosine + recency decay, required `kind`, soft ranking, no eviction in M2.**

Rationale:
- Sofia's dispute-history-per-vendor needs both "same vendor" (kind + recency) AND "similar dispute" (semantic similarity). Hybrid captures both.
- Required `kind` is cheap to enforce and expensive to retrofit — make callers be explicit from day one.
- Soft ranking avoids fragile threshold tuning at a volume where every retrieval matters.
- Eviction is premature optimization at M2 — revisit once we actually see the growth curve.

**Revisit triggers** (for the ADR body):
- Memory entry count per tenant ≥ 10k for two consecutive weeks.
- Retrieval latency P95 regression beyond the 300ms target set in milestone 3 stub.
- Any cross-tenant query bug (trust failure — rewrite policy).
- Embedding provider change (forces re-embedding — separate ADR).

**Hard rule (in consequences):** tenant isolation via RLS (ADR-0006) is absolute and non-skippable regardless of what retrieval semantics evolve to.

**ADR body shape:**
- Context: scope + M1-retrospective identification + pgvector schema already in place.
- Decision: hybrid formula + required `kind` + soft ranking + no eviction in M2, with the specific SQL outline (pgvector `<=>` operator for cosine, `created_at` derivation for decay).
- Alternatives considered: pure semantic, pure recency, hard floor, TTL eviction, size-cap eviction — each with rejection rationale.
- Consequences: top-k fixed default; callers must pass `kind`; memory grows unbounded pre-revisit-trigger; every `memory.search_memory` read runs under `withTenant` RLS context.
- Revisit conditions: the four above.

---

## Next-action sequence

1. Vlad ratifies both decision trees above (or counter-proposes).
2. Draft `docs/adr/0012-documents-mcp-transport.md` per the ratified shape.
3. Draft `docs/adr/0013-memory-retrieval-policy.md` per the ratified shape.
4. Update `docs/DECISIONS.md` index with both new entries.
5. One branch, one PR for both ADRs (they're cohesive M2 prep). Convention: `oveglobalio/blu-42-43-adrs-m2-mcp`. Or two branches if Vlad prefers separate merges. Either is defensible.
6. Transition [BLU-42](https://linear.app/oveglobal/issue/BLU-42) + [BLU-43](https://linear.app/oveglobal/issue/BLU-43) to `In Progress` on branch creation; `In Review` on PR open; auto-close on merge.
7. **Pause.** No M2 milestone 1–6 issue decomposition. No [BLU-41](https://linear.app/oveglobal/issue/BLU-41) pickup unless explicitly tagged as warm-up.

---

## Blockers external to platform (Track A)

Per ROADMAP Month 0 Track A, Nick owes four deliverables before Sofia issue-level decomposition makes sense:

- [ ] Commissary kitchen selected **and contracted**. Current status: *preparing to start* — contract not confirmed.
- [ ] Farmers-market permits + booth reservations secured (2–3 markets/week). Current status: not confirmed.
- [ ] Initial menu locked (5–8 SKUs). Current status: not confirmed.
- [ ] Wholesale conversations started. Current status: ✅ in progress.

The minimum signal needed to unblock M2 milestone 1 decomposition: **farmers-market launch with at least one real vendor relationship** (ROADMAP Month 2 Track A: flour / butter / packaging). Until then, architectural contracts (ADRs) are safe to land; issue-level flows would commit to a fictional operational reality and force rewrites.

Update `project_track_a_status.md` in memory as Nick reports progress.

---

## Starter prompt for the new session

Copy-paste as the first message of the new session:

> Read `~/.claude/projects/-Users-abakymuk-BlueCairn/memory/MEMORY.md` first, then `bluecairn/docs/session-reports/2026-04-22-session-handoff.md`. That gets you full context: what shipped, current Linear state, open architectural questions with my decision trees for ADR-0012 and ADR-0013 awaiting my ratification. Do not decompose M2 milestones 1–6 — Track A signal still pending. Next action: confirm my ADR-0012 + ADR-0013 recommendations, then draft + PR + merge both ADRs, then pause.

---

## What didn't happen (and why)

- **No M2 milestone 1–6 issue decomposition.** Deliberate. Vlad's 2026-04-22 call: decomposing before Nick has real vendor relationships would commit Sofia's workflow shape to a fictional operational reality. ADRs codify safe architectural contracts (transport, retrieval policy); issue-level flows require operational reality.
- **No [BLU-41](https://linear.app/oveglobal/issue/BLU-41) (post-finalize handoff) work.** Deliberate. It's non-gating and Vlad flagged it as a warm-up candidate only if Track A is slow.
- **No orchestrator classifier-audit dedup.** Accepted as per-attempt semantics — no durable `agent_run` exists at classifier time to guard against duplicate audit rows under Inngest retries. Documented in BLU-22 AC #7 flip.
- **No `send_email` implementation.** Deliberately deferred when Dana's M3 morning briefing needs it (per ROADMAP). Tracking in [BLU-40](https://linear.app/oveglobal/issue/BLU-40).
