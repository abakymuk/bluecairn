import { Ok } from '@bluecairn/core'
import { createDatabase } from '@bluecairn/db'
import postgres from 'postgres'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

/**
 * BLU-28 / closes BLU-25 AC #9.
 *
 * Adversarial coverage for action.gate's Layer-5 defence against
 * cross-tenant approval decision events.
 *
 * Two tenants seeded: A owns a real pending action + approval; B is a
 * bystander (no action of its own in the fixture). The forged event
 * pretends to be "tenant B approved tenant A's action" — if the
 * Telegram webhook (BLU-24) is thin and a button is smuggled, this is
 * the resulting Inngest event shape. action.gate's BLU-28 hardening
 * short-circuits before mark-approved and records
 * `approval.decision.tenant_mismatch` under the action's tenant.
 *
 * Run via: doppler run --config dev -- bun run --cwd apps/workers test
 */

const adminUrl = process.env.DATABASE_URL_ADMIN
if (adminUrl === undefined) {
  throw new Error('DATABASE_URL_ADMIN required for BLU-28 adversarial test')
}

const { mockSpanUpdate } = vi.hoisted(() => ({ mockSpanUpdate: vi.fn() }))
vi.mock('@langfuse/tracing', () => ({
  startActiveObservation: async (
    _name: string,
    callback: (span: { update: typeof mockSpanUpdate }) => Promise<unknown>,
  ) => callback({ update: mockSpanUpdate }),
  getActiveTraceId: vi.fn().mockReturnValue('test-trace-id'),
  getActiveSpanId: vi.fn().mockReturnValue('test-span-id'),
}))

const { handleActionGate } = await import('../../src/functions/action-gate.js')
type HandleActionGateArgs = Parameters<typeof handleActionGate>[0]
type SendMessageImpl = NonNullable<HandleActionGateArgs['sendMessageImpl']>
type SendMessageInput = Parameters<SendMessageImpl>[1]

const admin = postgres(adminUrl, { max: 1, prepare: false })
const db = createDatabase(adminUrl)

const TEST_PREFIX = `blu28-gate-${crypto.randomUUID().slice(0, 8)}`
const CHAT_A = `-100${Math.floor(Math.random() * 1e10)}`

let tenantAId: string
let tenantBId: string
let threadAId: string
let agentRunAId: string
let conciergeDefId: string
let conciergePromptId: string

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

  const [channel] = await admin<{ id: string }[]>`
    INSERT INTO channels (tenant_id, kind, external_id, is_primary, active)
    VALUES (${tenantAId}, 'telegram', ${CHAT_A}, true, true)
    RETURNING id
  `
  if (!channel) throw new Error('fixture: channel')

  const [thread] = await admin<{ id: string }[]>`
    INSERT INTO threads (tenant_id, channel_id, kind)
    VALUES (${tenantAId}, ${channel.id}, 'owner_primary')
    RETURNING id
  `
  if (!thread) throw new Error('fixture: thread')
  threadAId = thread.id

  const [concierge] = await admin<{ id: string }[]>`
    SELECT id FROM agent_definitions WHERE code = 'concierge' LIMIT 1
  `
  if (!concierge) throw new Error('concierge agent_definition not seeded')
  conciergeDefId = concierge.id

  const [prompt] = await admin<{ id: string }[]>`
    SELECT id FROM prompts WHERE agent_definition_id = ${conciergeDefId}
    ORDER BY version DESC LIMIT 1
  `
  if (!prompt) throw new Error('concierge prompt not seeded')
  conciergePromptId = prompt.id

  const [run] = await admin<{ id: string }[]>`
    INSERT INTO agent_runs (
      tenant_id, thread_id, agent_definition_id, prompt_id,
      trigger_kind, trigger_ref, input, model, status
    ) VALUES (
      ${tenantAId}, ${threadAId}, ${conciergeDefId}, ${conciergePromptId},
      'user_message', ${crypto.randomUUID()}, '{"test":"A"}'::jsonb,
      'claude-haiku-4-5-20251001', 'completed'
    )
    RETURNING id
  `
  if (!run) throw new Error('fixture: agent_run')
  agentRunAId = run.id
})

afterAll(async () => {
  // audit_log is append-only + FK to actions without cascade, so actions +
  // tenants cannot be deleted once we wrote audit rows. Per-run TEST_PREFIX
  // isolates fixtures across runs. Neon branch reset is the periodic
  // cleanup (same posture as BLU-24/25/27 test suites).
  await admin.end()
})

beforeEach(() => {
  mockSpanUpdate.mockClear()
})

afterEach(async () => {
  // We never reach dispatch in these tests, so approval_requests stays at
  // 1 row per case — leaving it is fine. But wipe to keep re-runs
  // deterministic (per-test inserts a fresh action + approval).
  await admin`DELETE FROM approval_requests WHERE tenant_id = ${tenantAId}`
})

const insertActionA = async (text: string): Promise<string> => {
  const [row] = await admin<{ id: string }[]>`
    INSERT INTO actions (tenant_id, agent_run_id, kind, payload, policy_outcome, status)
    VALUES (
      ${tenantAId},
      ${agentRunAId},
      'send_message',
      ${admin.json({ thread_id: threadAId, text })},
      'approval_required',
      'pending'
    )
    RETURNING id
  `
  if (!row) throw new Error('fixture: action insert')
  return row.id
}

const makeEvent = (actionId: string) =>
  ({
    data: {
      tenant_id: tenantAId,
      correlation_id: crypto.randomUUID(),
      idempotency_key: `event:${actionId}:action`,
      action_id: actionId,
      agent_run_id: agentRunAId,
      kind: 'send_message' as const,
      payload: { thread_id: threadAId, text: 'ignored-by-handler' },
      policy_outcome: 'approval_required' as const,
    },
  } satisfies HandleActionGateArgs['event'])

const makeFakeStep = () => ({
  run: vi
    .fn()
    .mockImplementation(async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn()),
  sendEvent: vi.fn().mockResolvedValue({ ids: [] }),
  waitForEvent: vi.fn(),
})

const captureSend = () => {
  const calls: SendMessageInput[] = []
  const impl: SendMessageImpl = vi.fn(async (_deps, input) => {
    calls.push(input)
    return Ok({
      toolCallId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      telegramMessageId: 1000 + calls.length,
      cached: false,
    })
  })
  return { impl, calls }
}

describe('BLU-28: action.gate cross-tenant decision guard', () => {
  test('forged decision event with B tenant_id + A approval_request_id → rejected_mismatch + audit row', async () => {
    // Tenant A creates a real action + approval (via the gate's normal path).
    const actionId = await insertActionA('A pending action, awaiting approval')
    const fakeStep = makeFakeStep()
    const send = captureSend()

    // The adversary sends a decision carrying TENANT_B's id pointed at
    // TENANT_A's approval_request (step 1-3 still ran under A, so
    // approvalRequestId is A's). waitForEvent returns that forged event.
    fakeStep.waitForEvent.mockImplementation(async (_name, _opts) => ({
      data: {
        tenant_id: tenantBId, // ← forged: should match tenant_id on the gate's event (A), but B
        correlation_id: 'forged-corr',
        idempotency_key: 'tg:callback:forged',
        approval_request_id: 'placeholder-filled-by-gate', // gate passes the real A id into `if`
        decision: 'approved' as const,
        user_telegram_id: 99_999,
      },
    }))

    const result = await handleActionGate({
      event: makeEvent(actionId),
      step: fakeStep,
      dbOverride: db,
      sendMessageImpl: send.impl,
    })

    // Short-circuit: new outcome, approval row stays pending, action stays awaiting_approval
    expect(result.outcome).toBe('rejected_mismatch')
    expect(result.approval_request_id).toBeTruthy()

    const [appr] = await admin<
      { resolved_status: string | null; resolved_at: Date | null }[]
    >`
      SELECT resolved_status, resolved_at FROM approval_requests WHERE action_id = ${actionId}
    `
    expect(appr?.resolved_status).toBeNull()
    expect(appr?.resolved_at).toBeNull()

    const [action] = await admin<{ status: string; executed_at: Date | null }[]>`
      SELECT status, executed_at FROM actions WHERE id = ${actionId}
    `
    // Action stayed in awaiting_approval (set by step 2); dispatch never ran
    expect(action?.status).toBe('awaiting_approval')
    expect(action?.executed_at).toBeNull()

    // Only the approval-prompt send happened — no dispatch, no rejection ack
    expect(send.calls).toHaveLength(1)
    expect(send.calls[0]?.idempotencyKey).toBe(`approval-prompt:${actionId}`)

    // Audit row: cross-tenant mismatch recorded under A's tenant (action's
    // tenant, where forensics would search)
    const audits = await admin<
      {
        event_kind: string
        tenant_id: string | null
        event_payload: { expected_tenant_id: string; decision_event_tenant_id: string }
      }[]
    >`
      SELECT event_kind, tenant_id, event_payload
      FROM   audit_log
      WHERE  action_id = ${actionId}
      ORDER  BY occurred_at ASC
    `
    expect(audits.map((a) => a.event_kind)).toEqual(['approval.decision.tenant_mismatch'])
    expect(audits[0]?.tenant_id).toBe(tenantAId)
    expect(audits[0]?.event_payload.expected_tenant_id).toBe(tenantAId)
    expect(audits[0]?.event_payload.decision_event_tenant_id).toBe(tenantBId)
  })

  test('matching tenant_id → normal approved path (regression: hardening does not break the happy case)', async () => {
    const actionId = await insertActionA('A happy-path action')
    const fakeStep = makeFakeStep()
    const send = captureSend()

    fakeStep.waitForEvent.mockImplementation(async () => ({
      data: {
        tenant_id: tenantAId, // ← matches the gate's tenant_id
        correlation_id: 'matching-corr',
        idempotency_key: 'tg:callback:matching',
        approval_request_id: 'placeholder',
        decision: 'approved' as const,
        user_telegram_id: 88_888,
      },
    }))

    const result = await handleActionGate({
      event: makeEvent(actionId),
      step: fakeStep,
      dbOverride: db,
      sendMessageImpl: send.impl,
    })

    expect(result.outcome).toBe('executed')
    const [action] = await admin<{ status: string }[]>`
      SELECT status FROM actions WHERE id = ${actionId}
    `
    expect(action?.status).toBe('executed')

    // Two sends (prompt + dispatch), audit trail matches BLU-25 canon
    expect(send.calls).toHaveLength(2)
    const audits = await admin<{ event_kind: string }[]>`
      SELECT event_kind FROM audit_log WHERE action_id = ${actionId} ORDER BY occurred_at
    `
    expect(audits.map((a) => a.event_kind)).toEqual(['approval.granted', 'action.executed'])
  })

  test('matching tenant_id + rejected decision → normal reject path', async () => {
    const actionId = await insertActionA('A reject-path action')
    const fakeStep = makeFakeStep()
    const send = captureSend()

    fakeStep.waitForEvent.mockImplementation(async () => ({
      data: {
        tenant_id: tenantAId,
        correlation_id: 'reject-corr',
        idempotency_key: 'tg:callback:reject',
        approval_request_id: 'placeholder',
        decision: 'rejected' as const,
        user_telegram_id: 123,
      },
    }))

    const result = await handleActionGate({
      event: makeEvent(actionId),
      step: fakeStep,
      dbOverride: db,
      sendMessageImpl: send.impl,
    })

    expect(result.outcome).toBe('rejected')
    const audits = await admin<{ event_kind: string }[]>`
      SELECT event_kind FROM audit_log WHERE action_id = ${actionId} ORDER BY occurred_at
    `
    expect(audits.map((a) => a.event_kind)).toEqual(['approval.rejected'])
  })
})
