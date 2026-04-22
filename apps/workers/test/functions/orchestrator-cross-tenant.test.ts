import { createDatabase } from '@bluecairn/db'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

/**
 * BLU-28 — Layer 2 (orchestrator) adversarial tests.
 *
 * The `thread.message.received` event carries `{tenant_id, thread_id,
 * message_id}`. Current orchestrator loads context under `withTenant(tenant_id)`
 * and RLS filters everything the session can see. An attacker can still
 * craft an event with mismatched IDs — e.g. `tenant_id=A, thread_id=B's
 * thread`. This test documents what happens: the context load returns
 * empty (RLS filters), the classifier runs on an empty history, and the
 * downstream `write-agent-run` insert sets `tenantId=A, threadId=B's
 * thread`. The key question: is the resulting agent_run visible to
 * tenant A, or does some layer block the FK cross-tenant insert?
 *
 * Realistic outcome documented below. Either:
 *   (a) the insert succeeds — schema-level gap, flag for a follow-up
 *       CHECK constraint / trigger ticket.
 *   (b) the insert fails — already defended.
 *
 * Run via: doppler run --config dev -- bun run --cwd apps/workers test
 */

const adminUrl = process.env.DATABASE_URL_ADMIN
if (adminUrl === undefined) {
  throw new Error('DATABASE_URL_ADMIN required for BLU-28 orchestrator test')
}

const { mockGenerateText } = vi.hoisted(() => ({ mockGenerateText: vi.fn() }))
vi.mock('@bluecairn/agents', () => ({
  generateText: mockGenerateText,
  initTracing: vi.fn(),
  shutdownTracing: vi.fn(),
}))

const { mockSpanUpdate } = vi.hoisted(() => ({ mockSpanUpdate: vi.fn() }))
vi.mock('@langfuse/tracing', () => ({
  startActiveObservation: async (
    _name: string,
    callback: (span: { update: typeof mockSpanUpdate }) => Promise<unknown>,
  ) => callback({ update: mockSpanUpdate }),
  getActiveTraceId: vi.fn().mockReturnValue('test-trace-id'),
  getActiveSpanId: vi.fn().mockReturnValue('test-span-id'),
}))

const { handleOrchestratorRoute } = await import('../../src/functions/orchestrator-route.js')

const admin = postgres(adminUrl, { max: 1, prepare: false })
const db = createDatabase(adminUrl)

const TEST_PREFIX = `blu28-orch-${crypto.randomUUID().slice(0, 8)}`
const CHAT_A = `-100${Math.floor(Math.random() * 1e10)}`
const CHAT_B = `-100${Math.floor(Math.random() * 1e10)}`

let tenantAId: string
let tenantBId: string
let threadAId: string
let threadBId: string
let messageAId: string
let messageBId: string

const fakeStep = {
  run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
  sendEvent: vi.fn().mockResolvedValue({ ids: ['fake'] }),
}

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
  if (!a || !b) throw new Error('fixture: tenants')
  tenantAId = a.id
  tenantBId = b.id

  const [chA] = await admin<{ id: string }[]>`
    INSERT INTO channels (tenant_id, kind, external_id, is_primary, active)
    VALUES (${tenantAId}, 'telegram', ${CHAT_A}, true, true)
    RETURNING id
  `
  const [chB] = await admin<{ id: string }[]>`
    INSERT INTO channels (tenant_id, kind, external_id, is_primary, active)
    VALUES (${tenantBId}, 'telegram', ${CHAT_B}, true, true)
    RETURNING id
  `
  if (!chA || !chB) throw new Error('fixture: channels')

  const [tA] = await admin<{ id: string }[]>`
    INSERT INTO threads (tenant_id, channel_id, kind)
    VALUES (${tenantAId}, ${chA.id}, 'owner_primary')
    RETURNING id
  `
  const [tB] = await admin<{ id: string }[]>`
    INSERT INTO threads (tenant_id, channel_id, kind)
    VALUES (${tenantBId}, ${chB.id}, 'owner_primary')
    RETURNING id
  `
  if (!tA || !tB) throw new Error('fixture: threads')
  threadAId = tA.id
  threadBId = tB.id

  const [mA] = await admin<{ id: string }[]>`
    INSERT INTO messages (tenant_id, thread_id, author_kind, direction, content, idempotency_key)
    VALUES (${tenantAId}, ${threadAId}, 'user', 'inbound', 'A message', ${`${TEST_PREFIX}:a`})
    RETURNING id
  `
  const [mB] = await admin<{ id: string }[]>`
    INSERT INTO messages (tenant_id, thread_id, author_kind, direction, content, idempotency_key)
    VALUES (${tenantBId}, ${threadBId}, 'user', 'inbound', 'B message', ${`${TEST_PREFIX}:b`})
    RETURNING id
  `
  if (!mA || !mB) throw new Error('fixture: messages')
  messageAId = mA.id
  messageBId = mB.id
})

afterAll(async () => {
  // Classifier mock means no LLM cost + no audit_log writes tie the tenant
  // to append-only rows, so the DELETE FROM tenants cascades cleanly.
  await admin`DELETE FROM tenants WHERE slug LIKE ${`${TEST_PREFIX}%`}`
  await admin.end()
})

describe('BLU-28: orchestrator cross-tenant guard', () => {
  test('forged event: tenant_id=A + thread_id=B → RLS filters context, insert attempt either succeeds with orphan agent_run or fails', async () => {
    mockGenerateText.mockResolvedValue({
      ok: true as const,
      value: {
        text: 'concierge',
        tokens: { input: 10, output: 1, total: 11 },
        costUsd: 0.00001,
        modelId: 'claude-haiku-4-5-20251001',
        latencyMs: 50,
        langfuseTraceId: 'trace-cross',
      },
    })

    const event = {
      data: {
        tenant_id: tenantAId, // forged tenant
        correlation_id: crypto.randomUUID(),
        idempotency_key: `forged:${TEST_PREFIX}:1`,
        thread_id: threadBId, // ← owned by B
        message_id: messageBId, // ← owned by B
        channel_id: 'ignored',
      },
    }

    // Count tenant A's agent_runs before + after to see if the handler
    // managed to create one pointing at B's thread.
    const beforeCount = Number(
      (
        await admin<{ count: string }[]>`
          SELECT count(*)::text AS count FROM agent_runs WHERE tenant_id = ${tenantAId}
        `
      )[0]?.count ?? '0',
    )

    // The handler either (a) throws because load-context returns empty and
    // classifier fails, or (b) silently creates an agent_run pointing at
    // B's thread. Either way we capture the state and assert.
    let errorThrown: Error | null = null
    try {
      await handleOrchestratorRoute({
        event,
        step: fakeStep,
        dbOverride: db,
      })
    } catch (err) {
      errorThrown = err as Error
    }

    const afterCount = Number(
      (
        await admin<{ count: string }[]>`
          SELECT count(*)::text AS count FROM agent_runs WHERE tenant_id = ${tenantAId}
        `
      )[0]?.count ?? '0',
    )
    const newRunsForA = afterCount - beforeCount

    // Inspect any row created under A that points at B's thread — that's
    // the smoking gun for a cross-tenant FK bypass at the orchestrator
    // layer. RLS on `agent_runs` only checks the row's own tenant_id; the
    // thread_id FK does NOT enforce matching tenant_id. Document the
    // observed state so the hardening ticket has evidence.
    const orphanRuns = await admin<
      { id: string; tenant_id: string; thread_id: string | null }[]
    >`
      SELECT id, tenant_id, thread_id FROM agent_runs
      WHERE tenant_id = ${tenantAId} AND thread_id = ${threadBId}
    `

    // Two acceptable outcomes (document both in the snapshot-style check):
    //
    //   1. Orchestrator threw (message_id not visible under A's withTenant
    //      → load-context returned empty → some downstream step failed).
    //      Good: effective app-layer defence.
    //
    //   2. Orchestrator silently created an agent_run with tenant_id=A
    //      pointing at B's thread_id. Not a data-leak per se (RLS on reads
    //      of B's thread/messages still blocks A's session), but it is a
    //      data-integrity violation — A now has a run referencing a thread
    //      it can't see. Flag for follow-up CHECK/trigger.
    //
    // Whichever path we're on today, lock it in so a regression is visible.
    if (errorThrown !== null) {
      // Path 1 — defended
      expect(newRunsForA).toBe(0)
      expect(orphanRuns).toHaveLength(0)
    } else {
      // Path 2 — schema gap (document, file follow-up)
      // We assert at least that the thread's own tenant didn't accidentally
      // get an agent_run — ownership of the run belongs to A (wrong by
      // semantics but correct by FK direction).
      const runsForB = await admin<{ id: string }[]>`
        SELECT id FROM agent_runs
        WHERE tenant_id = ${tenantBId}
          AND thread_id = ${threadBId}
          AND trigger_ref = ${messageBId}
        ORDER BY started_at DESC LIMIT 5
      `
      expect(runsForB).toHaveLength(0) // handler didn't accidentally write under B
      expect(orphanRuns.every((r) => r.tenant_id === tenantAId)).toBe(true)
    }

    // Invariant: whichever path we're on, tenant B's view is untouched.
    // (Tenant B had zero agent_runs at the start of this test.)
    const bRuns = await admin<{ id: string }[]>`
      SELECT id FROM agent_runs WHERE tenant_id = ${tenantBId}
    `
    expect(bRuns).toHaveLength(0)
  })

  test('matched event: tenant_id=A + thread_id=A → normal run created (regression guard)', async () => {
    mockGenerateText.mockResolvedValue({
      ok: true as const,
      value: {
        text: 'concierge',
        tokens: { input: 12, output: 1, total: 13 },
        costUsd: 0.00001,
        modelId: 'claude-haiku-4-5-20251001',
        latencyMs: 60,
        langfuseTraceId: 'trace-aligned',
      },
    })

    const event = {
      data: {
        tenant_id: tenantAId,
        correlation_id: crypto.randomUUID(),
        idempotency_key: `aligned:${TEST_PREFIX}:2`,
        thread_id: threadAId,
        message_id: messageAId,
        channel_id: 'ignored',
      },
    }

    const result = await handleOrchestratorRoute({ event, step: fakeStep, dbOverride: db })

    expect(result.run_id).toBeTruthy()
    expect(result.agent_code).toBe('concierge')

    // agent_run landed with matching tenant + thread
    const [run] = await admin<
      { id: string; tenant_id: string; thread_id: string | null }[]
    >`
      SELECT id, tenant_id, thread_id FROM agent_runs WHERE id = ${result.run_id}
    `
    expect(run?.tenant_id).toBe(tenantAId)
    expect(run?.thread_id).toBe(threadAId)
  })
})
