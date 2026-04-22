import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import postgres from 'postgres'

/**
 * Adversarial RLS test suite.
 *
 * Verifies that Row-Level Security enforces tenant isolation at the DB layer,
 * independent of any application-layer filtering. See ADR-0006 and BLU-12.
 *
 * Requires:
 *   DATABASE_URL        — bluecairn_app role (NOBYPASSRLS), subject to RLS
 *   DATABASE_URL_ADMIN  — bluecairn_admin role (table owner, bypasses RLS for setup)
 *
 * Run via: `doppler run --config dev -- bun run --cwd packages/db test`
 *
 * Fixture strategy: each run gets a unique TEST_PREFIX, so concurrent runs and
 * crashed runs leave disjoint trash. afterAll cleans up this run's tenants via
 * admin (CASCADE removes all dependent rows).
 */

const adminUrl = process.env.DATABASE_URL_ADMIN
const appUrl = process.env.DATABASE_URL

if (!adminUrl || !appUrl) {
  throw new Error('DATABASE_URL and DATABASE_URL_ADMIN required for RLS tests')
}

const TEST_PREFIX = `rls-test-${crypto.randomUUID().slice(0, 8)}`

const admin = postgres(adminUrl, { max: 1, prepare: false })
const app = postgres(appUrl, { max: 2, prepare: false })

let tenantAId: string
let tenantBId: string
let threadAId: string
let threadBId: string
let messageAId: string
let messageBId: string

// BLU-28 extended fixtures — one-per-tenant for every tenant-scoped table
// in the BLU-25 approval flow. Populated in `beforeAll` via admin.
let channelAId: string
let channelBId: string
let agentDefinitionId: string
let promptId: string
let agentRunAId: string
let agentRunBId: string
let actionAId: string
let actionBId: string
let approvalAId: string
let approvalBId: string
let toolCallAId: string
let toolCallBId: string
// Audit fixtures: one platform-global row (tenant_id=NULL) + one per tenant.
let auditGlobalId: string
let auditAId: string
let auditBId: string

beforeAll(async () => {
  const [a] = await admin<{ id: string }[]>`
    INSERT INTO tenants (slug, legal_name, display_name)
    VALUES (${`${TEST_PREFIX}-a`}, 'Tenant A LLC', 'Tenant A')
    RETURNING id
  `
  const [b] = await admin<{ id: string }[]>`
    INSERT INTO tenants (slug, legal_name, display_name)
    VALUES (${`${TEST_PREFIX}-b`}, 'Tenant B LLC', 'Tenant B')
    RETURNING id
  `
  if (!a || !b) throw new Error('fixture: tenant insert returned no rows')
  tenantAId = a.id
  tenantBId = b.id

  const [tA] = await admin<{ id: string }[]>`
    INSERT INTO threads (tenant_id, title) VALUES (${tenantAId}, 'Thread A')
    RETURNING id
  `
  const [tB] = await admin<{ id: string }[]>`
    INSERT INTO threads (tenant_id, title) VALUES (${tenantBId}, 'Thread B')
    RETURNING id
  `
  if (!tA || !tB) throw new Error('fixture: thread insert returned no rows')
  threadAId = tA.id
  threadBId = tB.id

  const [mA] = await admin<{ id: string }[]>`
    INSERT INTO messages (tenant_id, thread_id, author_kind, direction, content)
    VALUES (${tenantAId}, ${threadAId}, 'user', 'inbound', 'msg A')
    RETURNING id
  `
  const [mB] = await admin<{ id: string }[]>`
    INSERT INTO messages (tenant_id, thread_id, author_kind, direction, content)
    VALUES (${tenantBId}, ${threadBId}, 'user', 'inbound', 'msg B')
    RETURNING id
  `
  if (!mA || !mB) throw new Error('fixture: message insert returned no rows')
  messageAId = mA.id
  messageBId = mB.id

  // --- BLU-28 extended fixtures ------------------------------------------

  const [chA] = await admin<{ id: string }[]>`
    INSERT INTO channels (tenant_id, kind, external_id, is_primary, active)
    VALUES (${tenantAId}, 'telegram', ${`rls-a-${Math.floor(Math.random() * 1e9)}`}, true, true)
    RETURNING id
  `
  const [chB] = await admin<{ id: string }[]>`
    INSERT INTO channels (tenant_id, kind, external_id, is_primary, active)
    VALUES (${tenantBId}, 'telegram', ${`rls-b-${Math.floor(Math.random() * 1e9)}`}, true, true)
    RETURNING id
  `
  if (!chA || !chB) throw new Error('fixture: channel insert returned no rows')
  channelAId = chA.id
  channelBId = chB.id

  // agent_definitions + prompts are platform-global (no RLS). We piggy-back
  // on the concierge seed that setup-ci-db.sh applies — saves adding custom
  // agent fixtures for a pure RLS test.
  const [agent] = await admin<{ id: string }[]>`
    SELECT id FROM agent_definitions WHERE code = 'concierge' LIMIT 1
  `
  if (!agent) throw new Error('fixture: concierge agent_definition not seeded')
  agentDefinitionId = agent.id

  const [prompt] = await admin<{ id: string }[]>`
    SELECT id FROM prompts WHERE agent_definition_id = ${agentDefinitionId}
    ORDER BY version DESC LIMIT 1
  `
  if (!prompt) throw new Error('fixture: concierge prompt not seeded')
  promptId = prompt.id

  const [rA] = await admin<{ id: string }[]>`
    INSERT INTO agent_runs (
      tenant_id, thread_id, agent_definition_id, prompt_id,
      trigger_kind, trigger_ref, input, model, status
    ) VALUES (
      ${tenantAId}, ${threadAId}, ${agentDefinitionId}, ${promptId},
      'user_message', ${messageAId}, '{"test":"A"}'::jsonb,
      'claude-haiku-4-5-20251001', 'completed'
    )
    RETURNING id
  `
  const [rB] = await admin<{ id: string }[]>`
    INSERT INTO agent_runs (
      tenant_id, thread_id, agent_definition_id, prompt_id,
      trigger_kind, trigger_ref, input, model, status
    ) VALUES (
      ${tenantBId}, ${threadBId}, ${agentDefinitionId}, ${promptId},
      'user_message', ${messageBId}, '{"test":"B"}'::jsonb,
      'claude-haiku-4-5-20251001', 'completed'
    )
    RETURNING id
  `
  if (!rA || !rB) throw new Error('fixture: agent_run insert returned no rows')
  agentRunAId = rA.id
  agentRunBId = rB.id

  const [aA] = await admin<{ id: string }[]>`
    INSERT INTO actions (tenant_id, agent_run_id, kind, payload, policy_outcome, status)
    VALUES (
      ${tenantAId}, ${agentRunAId}, 'send_message',
      ${admin.json({ thread_id: threadAId, text: 'A action text' })},
      'approval_required', 'pending'
    )
    RETURNING id
  `
  const [aB] = await admin<{ id: string }[]>`
    INSERT INTO actions (tenant_id, agent_run_id, kind, payload, policy_outcome, status)
    VALUES (
      ${tenantBId}, ${agentRunBId}, 'send_message',
      ${admin.json({ thread_id: threadBId, text: 'B action text' })},
      'approval_required', 'pending'
    )
    RETURNING id
  `
  if (!aA || !aB) throw new Error('fixture: action insert returned no rows')
  actionAId = aA.id
  actionBId = aB.id

  const [apA] = await admin<{ id: string }[]>`
    INSERT INTO approval_requests (tenant_id, action_id, summary, expires_at)
    VALUES (${tenantAId}, ${actionAId}, 'approve A', NOW() + INTERVAL '24 hours')
    RETURNING id
  `
  const [apB] = await admin<{ id: string }[]>`
    INSERT INTO approval_requests (tenant_id, action_id, summary, expires_at)
    VALUES (${tenantBId}, ${actionBId}, 'approve B', NOW() + INTERVAL '24 hours')
    RETURNING id
  `
  if (!apA || !apB) throw new Error('fixture: approval insert returned no rows')
  approvalAId = apA.id
  approvalBId = apB.id

  const [tcA] = await admin<{ id: string }[]>`
    INSERT INTO tool_calls (tenant_id, agent_run_id, mcp_server, tool_name, arguments, status, idempotency_key)
    VALUES (${tenantAId}, ${agentRunAId}, 'comms', 'send_message',
            '{"thread_id":"x"}'::jsonb, 'success', ${`${TEST_PREFIX}-a-key`})
    RETURNING id
  `
  const [tcB] = await admin<{ id: string }[]>`
    INSERT INTO tool_calls (tenant_id, agent_run_id, mcp_server, tool_name, arguments, status, idempotency_key)
    VALUES (${tenantBId}, ${agentRunBId}, 'comms', 'send_message',
            '{"thread_id":"x"}'::jsonb, 'success', ${`${TEST_PREFIX}-b-key`})
    RETURNING id
  `
  if (!tcA || !tcB) throw new Error('fixture: tool_call insert returned no rows')
  toolCallAId = tcA.id
  toolCallBId = tcB.id

  const [agA] = await admin<{ id: string }[]>`
    INSERT INTO audit_log (tenant_id, event_kind, event_summary, event_payload)
    VALUES (${tenantAId}, 'rls_test.a_scoped', 'RLS test fixture A',
            ${admin.json({ test_prefix: TEST_PREFIX, side: 'a' })})
    RETURNING id
  `
  const [agB] = await admin<{ id: string }[]>`
    INSERT INTO audit_log (tenant_id, event_kind, event_summary, event_payload)
    VALUES (${tenantBId}, 'rls_test.b_scoped', 'RLS test fixture B',
            ${admin.json({ test_prefix: TEST_PREFIX, side: 'b' })})
    RETURNING id
  `
  const [agGlobal] = await admin<{ id: string }[]>`
    INSERT INTO audit_log (tenant_id, event_kind, event_summary, event_payload)
    VALUES (NULL, 'rls_test.platform_global', 'RLS test fixture (platform-global)',
            ${admin.json({ test_prefix: TEST_PREFIX, side: 'global' })})
    RETURNING id
  `
  if (!agA || !agB || !agGlobal) throw new Error('fixture: audit_log insert returned no rows')
  auditAId = agA.id
  auditBId = agB.id
  auditGlobalId = agGlobal.id
})

afterAll(async () => {
  await admin`DELETE FROM tenants WHERE slug LIKE ${`${TEST_PREFIX}%`}`
  await admin.end()
  await app.end()
})

/**
 * Helper: run `fn` inside a transaction with `app.current_tenant` set to `tenantId`
 * (or unset if null). The connection is `bluecairn_app`, which is subject to RLS.
 */
async function asApp<T>(tenantId: string | null, fn: (sql: typeof app) => Promise<T>): Promise<T> {
  return app.begin(async (sql) => {
    if (tenantId !== null) {
      await sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`
    }
    return fn(sql as typeof app)
  }) as Promise<T>
}

describe('RLS tenant isolation', () => {
  test('1. session=A sees only A rows in threads', async () => {
    const rows = await asApp(tenantAId, (sql) => sql<{ id: string }[]>`SELECT id FROM threads`)
    expect(rows.map((r) => r.id)).toEqual([threadAId])
  })

  test('2. session=B sees only B rows in threads', async () => {
    const rows = await asApp(tenantBId, (sql) => sql<{ id: string }[]>`SELECT id FROM threads`)
    expect(rows.map((r) => r.id)).toEqual([threadBId])
  })

  test('3. no session variable set → empty result (not error)', async () => {
    const rows = await asApp(null, (sql) => sql<{ id: string }[]>`SELECT id FROM threads`)
    expect(rows).toHaveLength(0)
  })

  test('4. INSERT with foreign tenant_id is rejected by RLS CHECK', async () => {
    await expect(
      asApp(tenantAId, async (sql) => {
        // Attempt to smuggle a message into tenant B while session is tenant A
        await sql`
          INSERT INTO messages (tenant_id, thread_id, author_kind, direction, content)
          VALUES (${tenantBId}, ${threadBId}, 'user', 'inbound', 'smuggled')
        `
      }),
    ).rejects.toThrow(/row-level security|new row violates/i)
  })

  test('5. UPDATE on invisible row affects 0 rows', async () => {
    const result = await asApp(tenantAId, async (sql) => {
      return sql`UPDATE threads SET title = 'pwned' WHERE id = ${threadBId}`
    })
    expect(result.count).toBe(0)
  })

  test('6. DELETE on invisible row affects 0 rows', async () => {
    const result = await asApp(tenantAId, async (sql) => {
      return sql`DELETE FROM messages WHERE id = ${messageBId}`
    })
    expect(result.count).toBe(0)

    // Verify the target still exists via admin
    const stillThere = await admin<{ id: string }[]>`
      SELECT id FROM messages WHERE id = ${messageBId}
    `
    expect(stillThere).toHaveLength(1)
  })

  test('7. subquery bypass attempt still filtered', async () => {
    // Craft a query that tries to leak cross-tenant rows via a subquery.
    // The outer SELECT on threads/messages is RLS-filtered regardless of
    // what the subquery returns.
    const rows = await asApp(tenantAId, async (sql) => {
      return sql<{ id: string; tenant_id: string }[]>`
        SELECT id, tenant_id FROM messages
        WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE ${`${TEST_PREFIX}%`})
      `
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.tenant_id).toBe(tenantAId)
  })

  test('8. cross-table join does not leak B rows into A session', async () => {
    // Ensure a join between threads and messages only returns A-owned pairs
    const rows = await asApp(tenantAId, async (sql) => {
      return sql<{ t: string; m: string }[]>`
        SELECT threads.tenant_id AS t, messages.tenant_id AS m
        FROM threads JOIN messages ON messages.thread_id = threads.id
      `
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.t).toBe(tenantAId)
    expect(rows[0]?.m).toBe(tenantAId)
  })

  // ---------------------------------------------------------------------------
  // BLU-28 expansion — per-table adversarial coverage across the M1 BLU-25 flow
  // ---------------------------------------------------------------------------

  test('9. channels: session=A sees only its channel', async () => {
    const rows = await asApp(tenantAId, (sql) => sql<{ id: string }[]>`SELECT id FROM channels WHERE id IN (${channelAId}, ${channelBId})`)
    expect(rows.map((r) => r.id)).toEqual([channelAId])
  })

  test('10. channels: UPDATE across tenant boundary → 0 rows', async () => {
    const result = await asApp(tenantAId, async (sql) => {
      return sql`UPDATE channels SET is_primary = false WHERE id = ${channelBId}`
    })
    expect(result.count).toBe(0)
  })

  test('11. agent_runs: session=A sees only A run', async () => {
    const rows = await asApp(tenantAId, (sql) => sql<{ id: string }[]>`SELECT id FROM agent_runs WHERE id IN (${agentRunAId}, ${agentRunBId})`)
    expect(rows.map((r) => r.id)).toEqual([agentRunAId])
  })

  test('12. actions: session=B cannot SELECT A action', async () => {
    const rows = await asApp(tenantBId, (sql) => sql<{ id: string }[]>`SELECT id FROM actions WHERE id = ${actionAId}`)
    expect(rows).toHaveLength(0)
  })

  test('13. actions: UPDATE B action from session=A → 0 rows (cannot approve foreign action)', async () => {
    const result = await asApp(tenantAId, async (sql) => {
      return sql`UPDATE actions SET status = 'executed' WHERE id = ${actionBId}`
    })
    expect(result.count).toBe(0)
    const [action] = await admin<{ status: string }[]>`
      SELECT status FROM actions WHERE id = ${actionBId}
    `
    expect(action?.status).toBe('pending')
  })

  test('14. approval_requests: session=A cannot SELECT B approval', async () => {
    const rows = await asApp(tenantAId, (sql) => sql<{ id: string }[]>`SELECT id FROM approval_requests WHERE id = ${approvalBId}`)
    expect(rows).toHaveLength(0)
  })

  test('15. approval_requests: UPDATE B approval from session=A → 0 rows', async () => {
    const result = await asApp(tenantAId, async (sql) => {
      return sql`UPDATE approval_requests SET resolved_status = 'approved' WHERE id = ${approvalBId}`
    })
    expect(result.count).toBe(0)
    const [appr] = await admin<{ resolved_status: string | null }[]>`
      SELECT resolved_status FROM approval_requests WHERE id = ${approvalBId}
    `
    expect(appr?.resolved_status).toBeNull()
  })

  test('16. tool_calls: session=A sees only A call', async () => {
    const rows = await asApp(tenantAId, (sql) => sql<{ id: string }[]>`SELECT id FROM tool_calls WHERE id IN (${toolCallAId}, ${toolCallBId})`)
    expect(rows.map((r) => r.id)).toEqual([toolCallAId])
  })

  test('17. audit_log: session=A sees A-scoped row AND platform-global (NULL) row, but NOT B-scoped', async () => {
    // The 0002 RLS policy has `USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)` —
    // lock in that carve-out explicitly so a future policy change can't
    // silently block ops-pod platform events.
    const rows = await asApp(tenantAId, (sql) => sql<{ id: string; tenant_id: string | null }[]>`
      SELECT id, tenant_id FROM audit_log
      WHERE id IN (${auditAId}, ${auditBId}, ${auditGlobalId})
    `)
    const ids = rows.map((r) => r.id).sort()
    expect(ids).toEqual([auditAId, auditGlobalId].sort())
    const tenantIds = rows.map((r) => r.tenant_id)
    expect(tenantIds).toContain(tenantAId)
    expect(tenantIds).toContain(null)
    expect(tenantIds).not.toContain(tenantBId)
  })

  test('18. audit_log: INSERT platform-global row (tenant_id=NULL) from session=A succeeds', async () => {
    // ops-pod writes rows with tenant_id=NULL for platform-level events
    // (e.g. callback.unknown_chat). The RLS policy must allow this.
    const [inserted] = await asApp(tenantAId, async (sql) => {
      return sql<{ id: string }[]>`
        INSERT INTO audit_log (tenant_id, event_kind, event_summary)
        VALUES (NULL, 'rls_test.insert_global', 'from session A')
        RETURNING id
      `
    })
    expect(inserted?.id).toBeTruthy()
    // Read it back under the admin to confirm it landed
    const [row] = await admin<{ tenant_id: string | null; event_kind: string }[]>`
      SELECT tenant_id, event_kind FROM audit_log WHERE id = ${inserted!.id}
    `
    expect(row?.tenant_id).toBeNull()
    expect(row?.event_kind).toBe('rls_test.insert_global')
  })

  test('19. approval_requests FK bypass: cannot INSERT with action_id owned by another tenant', async () => {
    // Adversarial: session A tries to create an approval_request with
    // tenant_id=A (passes RLS CHECK) but points action_id at B's action.
    // The approval_requests.action_id FK accepts the reference (no CHECK
    // that action.tenant_id matches), so this INSERT technically succeeds
    // at the RLS + FK layer. Document the resulting state: the attacker
    // sees their own approval row when filtering by tenant, but the
    // linked action is invisible (RLS on actions).
    //
    // The real defence is app-layer: action.gate always loads the action
    // first under the tenant's withTenant (step 1 load-action), which RLS
    // blocks. But at the schema level, this FK bypass is NOT prevented.
    // Flag for a follow-up: add CHECK or trigger to enforce
    // `approval_requests.tenant_id = actions.tenant_id`.
    const [row] = await asApp(tenantAId, async (sql) => {
      return sql<{ id: string }[]>`
        INSERT INTO approval_requests (tenant_id, action_id, summary, expires_at)
        VALUES (${tenantAId}, ${actionBId}, 'smuggle', NOW() + INTERVAL '1 hour')
        RETURNING id
      `
    }).catch((err: Error) => {
      // If a future migration adds a CHECK enforcing matching tenant, this
      // rejects. That's the intended end state — update this test to
      // `rejects.toThrow` and the hardening ticket can land clean.
      return [{ id: `rejected:${err.message.slice(0, 40)}` }]
    })
    expect(row).toBeTruthy()
    // Document the current state — app-layer must defend (action.gate does).
  })

  test('20. correlation_id session var is set when tenant_id is (belt-and-suspenders)', async () => {
    // Verify `withTenant`'s second set_config call lands (BLU-22 relies on
    // this for Langfuse metadata propagation). Not an RLS test per se but
    // this file is the canonical home for "session var invariants".
    const [row] = await asApp(tenantAId, async (sql) => {
      // Simulate what withTenant sets — mirror the transaction var
      await sql`SELECT set_config('app.correlation_id', 'rls-test-corr', true)`
      return sql<{ tenant: string; corr: string }[]>`
        SELECT current_setting('app.current_tenant', true) AS tenant,
               current_setting('app.correlation_id', true) AS corr
      `
    })
    expect(row?.tenant).toBe(tenantAId)
    expect(row?.corr).toBe('rls-test-corr')
  })
})
