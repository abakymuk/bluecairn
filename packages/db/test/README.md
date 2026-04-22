# `packages/db/test/` — adversarial RLS + tenant-isolation coverage

This directory holds the canonical Row-Level Security test suite for the
monorepo. The companion cross-layer adversarial tests live next to the
code they exercise (`apps/api/test/`, `apps/workers/test/`) but every
layer of defence is indexed here.

Run locally:

```bash
doppler run --config dev -- bun run --cwd packages/db test
```

Full adversarial sweep across the monorepo:

```bash
doppler run --config dev -- bunx turbo test
```

---

## Adversarial coverage matrix (M1)

Each row lists an attack scenario, the M1 code path that executes when
it's exercised, and the test file + case number that locks in the
defence.

| # | Attack scenario | Layer | Defence | Test |
|---|---|---|---|---|
| 1 | session=A SELECT tenants/threads/messages of B | L6 | RLS `USING tenant_id = current_tenant_id()` | `rls.test.ts` #1–#3 |
| 2 | INSERT with foreign `tenant_id` | L6 | RLS CHECK clause on writes | `rls.test.ts` #4 |
| 3 | UPDATE / DELETE invisible row | L6 | RLS affects 0 rows (not error) | `rls.test.ts` #5–#6 |
| 4 | Subquery bypass / cross-table JOIN leak | L6 | Outer SELECT still RLS-filtered | `rls.test.ts` #7–#8 |
| 5 | session=A SELECT / UPDATE / DELETE on **channels** | L6 | Policy on `channels` | `rls.test.ts` #9–#10 |
| 6 | session=A SELECT foreign **agent_runs** | L6 | Policy on `agent_runs` | `rls.test.ts` #11 |
| 7 | session=A SELECT / UPDATE foreign **actions** | L6 | Policy on `actions` | `rls.test.ts` #12–#13 |
| 8 | session=A SELECT / UPDATE foreign **approval_requests** | L6 | Policy on `approval_requests` | `rls.test.ts` #14–#15 |
| 9 | session=A SELECT foreign **tool_calls** | L6 | Policy on `tool_calls` | `rls.test.ts` #16 |
| 10 | session=A reads platform-global **audit_log** (tenant_id=NULL) | L6 | Policy carve-out `OR tenant_id IS NULL` | `rls.test.ts` #17 |
| 11 | session=A inserts platform-global **audit_log** (tenant_id=NULL) | L6 | Same carve-out allows through | `rls.test.ts` #18 |
| 12 | Cross-tenant FK: insert `approval_request` pointing at another tenant's `action` | L6 | ⚠️ **Schema gap** — RLS allows insert (own tenant passes), FK accepts; app-layer `action.gate` load-action step blocks; documented for future CHECK/trigger hardening | `rls.test.ts` #19 |
| 13 | `app.current_tenant` / `app.correlation_id` session-var invariants | L6 | `withTenant` sets both via `set_config(..., true)` | `rls.test.ts` #20 |
| 14 | Orchestrator event-payload mismatch (tenant_id=A + thread_id=B) | L2 | `withTenant(A)` context load returns empty; tenant B never polluted regardless of handler throw vs orphan agent_run | `apps/workers/test/functions/orchestrator-cross-tenant.test.ts` |
| 15 | Comms MCP cross-tenant send (input.tenant_id ≠ thread.tenant_id) | L4 | Explicit `tenant_mismatch` error before any DB write or Telegram call (`send-message.ts:175-183`) | `packages/mcp-servers/test/comms/send-message.test.ts` (pre-BLU-28 existing coverage) |
| 16 | Callback smuggling: A's `approval_request_id` in B's chat | L1 | Webhook resolves tenant from chat_id (not from callback_data); `callback.emitted` audit under the resolving tenant; L5 rejects | `apps/api/test/callback-cross-tenant.test.ts` |
| 17 | action.gate receives cross-tenant decision event | L5 | New `rejected_mismatch` outcome + `approval.decision.tenant_mismatch` audit row under action's tenant (BLU-28 hardening) | `apps/workers/test/functions/action-gate-cross-tenant.test.ts` |
| 18 | ops-web admin-role reads without audit | L2/ops-web | Every fetch in `apps/ops-web/src/lib/data/threads.ts` + `audit.ts` writes `event_kind='ops_web_read'` with `auth_user_id` (migration 0006) | `apps/ops-web/src/lib/data/*` — covered by BLU-27 + BLU-28 smoke |

**Total: 18 adversarial scenarios across 6 layers.** 20 assertions in
`rls.test.ts` (L6) + 8 in cross-layer test files.

---

## Fixture pattern

Every test file seeds its own tenants with a per-run `TEST_PREFIX`
based on `crypto.randomUUID().slice(0, 8)`. `afterAll` tries to
cascade-delete via `DELETE FROM tenants WHERE slug LIKE '<prefix>%'`
— but `audit_log` is append-only (migration 0003 trigger) AND has a
nullable `tenant_id` FK with no cascade (by design, audit survives
tenant purge). So audit rows from test runs linger forever in the
dev DB. Periodic Neon branch reset is the cleanup.

---

## Schema gaps flagged for future hardening

Not fixed in M1; each needs a migration + DDL work. Both are
app-layer defended today — the listed tests exercise the app-layer
defence and document the schema-level hole.

1. **`approval_requests.tenant_id = actions.tenant_id`** — no CHECK
   constraint enforcing FK-tenant match. Test #12 lands the
   documented state; the `action.gate` load-action step is the
   app-layer defence.

2. **`agent_runs.tenant_id = threads.tenant_id`** — same pattern.
   Orchestrator cross-tenant test documents whichever concrete
   outcome is current.

Candidate future ticket: *Schema-level tenant-FK enforcement*.

---

## References

- [ADR-0006](../../../docs/adr/0006-multi-tenant-from-day-one.md) — Multi-tenant from day one
- `migrations-manual/0002_rls_policies.sql` — canonical policy definitions
- `migrations-manual/0006_audit_log_auth_user.sql` — BLU-27 ops-pod identity bridge
- BLU-28 (this expansion) + BLU-25 AC#9 (closed herein)
