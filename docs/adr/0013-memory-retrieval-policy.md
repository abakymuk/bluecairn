# ADR-0013: Memory retrieval policy

**Status:** Accepted
**Date:** 2026-04-22
**Deciders:** Vlad, Claude (cofounder-architect)

## Context

M2 milestone 3 ships the Memory MCP: `memory.search_memory` (retrieve) + `memory.store_memory` (write). The persistence layer already exists from M0 (BLU-11): a `memory_entries` table with 1536-dim `pgvector` embeddings (OpenAI `text-embedding-3-small`), tenant-scoped, RLS-enforced per ADR-0006. Schema and embedding provider are fixed. Retrieval *semantics* — how we rank, filter, and bound the result set — are not, and the M1 retrospective flagged this as a load-bearing ADR candidate: post-hoc changes to retrieval force re-regression-testing every memory-dependent prompt downstream.

Sofia (M2 first consumer) uses memory for two patterns: "retrieve past dispute outcomes for this vendor" (needs recency + vendor identity) and "retrieve similar disputes across vendors" (needs semantic similarity). Marco, Dana, Iris, and later agents will each own their own `kind` prefixes (`vendor_history`, `reconciliation_note`, `review_response`, …). Cross-domain retrieval — Sofia accidentally surfacing a Dana finance memory — is a trust failure, not merely a quality issue.

## Decision

ADR-0013 codifies retrieval policy as two layers: **hard invariants** (non-negotiable; rewrite requires a new superseding ADR) and **M2 defaults** (tunable via config; no ADR needed to adjust). This split is deliberate — we want the contract to be stable, and the coefficients to stay agile as real traffic shapes them.

### Hard invariants

1. **`kind` parameter is required** on every `memory.search_memory` call. The MCP tool schema rejects calls without it. No implicit "search all kinds" mode. Cross-domain retrieval is prevented by construction, as defense in depth on top of RLS.
2. **Soft ranking.** Retrieval always returns up to `top_k` results. No hard score floor, no early termination when scores look weak. Callers receive the score per row and interpret it themselves; the tool never decides "no result" on the caller's behalf.
3. **No eviction policy in M2.** Memory grows unbounded per tenant. No TTL, no size cap, no background pruning job.
4. **RLS is absolute** (ADR-0006). Every `memory.search_memory` and `memory.store_memory` call runs inside `withTenant(tenant_id)`. A zero-row result from a missing session context is the expected failure mode; it is never papered over with a service-role bypass.

Changing any of these four requires a new ADR that supersedes this one.

### M2 defaults (tunable)

1. **Ranking formula:** `score = cosine_sim + recency_weight * decay(age_days)`. Cosine similarity is the `pgvector` `<=>` operator negated (so larger is better); decay is an exponential `exp(-age_days / half_life_days)`.
2. **`top_k` default is 10.** Callers may pass `top_k` (1–50) to override.
3. **Coefficients ship with initial values** in `packages/mcp-servers/memory/config.ts`: `recency_weight = 0.3`, `half_life_days = 30`. These are placeholders sized to favor cosine similarity as the primary signal with a modest recency lift.
4. **Score field is returned** alongside each row, so callers can filter or rank further downstream.

Tuning `recency_weight`, `half_life_days`, or `top_k` is a config change plus a Sofia eval pass — **not** an ADR. Changing the *formula* (e.g. adding a popularity factor, replacing cosine) does require a new ADR.

### SQL outline

```sql
select id, kind, content, metadata, created_at,
       ((embedding <=> :query_embedding) * -1)
       + :recency_weight * exp(
           -extract(epoch from (now() - created_at))
           / (:half_life_days * 86400)
         ) as score
  from memory_entries
 where tenant_id = current_setting('app.current_tenant')::uuid
   and kind = :kind
 order by score desc
 limit :top_k;
```

## Alternatives considered

**Pure semantic (cosine top-k, no recency).** Rejected. Sofia's dispute-history-per-vendor pattern needs "same vendor, recent" more than "globally most-similar"; pure cosine surfaces a three-year-old similar-but-unrelated dispute over yesterday's actual precedent. Also brittle at small corpus sizes (M2 reality): early memory is sparse and cosine scores are noisy.

**Pure recency** (`ORDER BY created_at DESC`). Rejected. Discards semantic similarity entirely. Works only when every stored memory is equally relevant to every query — never true in practice.

**Hard score floor.** Rejected. Threshold tuning is fragile at low corpus volume. Soft ranking with the score exposed to callers gives agents enough information to decide for themselves.

**TTL eviction.** Rejected for M2. TTL assumes we know the freshness curve of different memory kinds; we don't. Also premature at M2 volume (tens of entries per tenant per week). Revisit when we see growth.

**Per-tenant size cap (LRU).** Rejected for M2. LRU requires tracking last-access, which adds a write path on every read. Not worth the engineering at M2 volume. Revisit at the 10k-entries-per-tenant threshold.

**Optional `kind`.** Rejected. Constraining callers is cheap; trust-failure incidents are expensive. Making `kind` required from day one costs nothing now and is hard to retrofit.

## Consequences

**Accepted benefits:**

- Cross-domain retrieval is architecturally impossible within the tool contract. Defense in depth on top of RLS.
- The ADR codifies shape, not coefficients. Tuning the ranking formula's numbers doesn't burn ADR review cycles.
- SQL plan is a single `pgvector` `<=>` scan plus `ORDER BY` with `LIMIT`. Predictable perf at M2 corpus sizes. P95 < 300ms is the M2 milestone-3 target.
- Every `memory.search_memory` call is traced in Langfuse with metadata (`memory.kind`, `memory.top_k`, `memory.scores_returned`). Retrieval quality is observable from day one.

**Accepted costs:**

- Unbounded memory growth per tenant. M2 reality: tens of entries per week per tenant. The 10k-per-tenant revisit threshold sits at ~3 years of ops-only usage per Nick's tenant at current cadence — plenty of time to design eviction deliberately.
- No score calibration across `kind`s. Scores for `vendor_history` are not directly comparable to scores for `reconciliation_note`; callers must be aware. Documented in the MCP tool schema.
- Initial `recency_weight` and `half_life_days` are educated guesses. Tuning will follow once real Sofia traffic lands.

**Rules this decision creates:**

- **`kind` is a string enum declared in `packages/memory/src/kinds.ts`.** New kinds land via PR + a one-line addition to that file. The MCP tool schema validates against this enum at call time.
- **No memory write without `kind`.** Enforced in `memory.store_memory`'s input schema.
- **Retrieval config changes don't need an ADR.** They need a PR that updates `packages/mcp-servers/memory/config.ts` and runs the Sofia eval suite to confirm no regression. Invariant changes *do* need an ADR.

**Documents updated in the same PR:**

- `docs/DECISIONS.md` index (0013 row added).
- *(Deferred to M2 milestone 3 decomposition, post-Track-A signal):* `docs/AGENTS.md` § Sofia memory usage, `packages/mcp-servers/memory/README.md`, `packages/memory/src/kinds.ts`. Scope of this PR is ADR-only.

## Revisit conditions

- Memory entry count per tenant ≥ **10,000** for two consecutive weeks. Eviction (TTL, LRU, or both) becomes worth the engineering.
- Retrieval **P95 latency regression beyond the 300ms** target set in M2 milestone 3. Forces either an index change, a `top_k` reduction, or a corpus partition.
- **Any cross-tenant query bug.** RLS failure is a trust incident — rewrite the retrieval stack, not just this ADR.
- **Embedding provider change** (separate future ADR). Switching off `text-embedding-3-small` forces a re-embed of every row in `memory_entries`; can't be done in-place under this ADR.

Any one fires → a new ADR supersedes. Until then, the hard invariants hold and the M2 defaults stay tunable via config.
