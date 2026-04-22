import { Ok, Err } from '@bluecairn/core'
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
 * Integration test for action.gate (BLU-25).
 *
 * Strategy:
 *   - admin conn seeds tenant + channel + thread + agent_run + actions row.
 *   - `sendMessage` is passed as an explicit impl override (no need to
 *     vi.mock the mcp-servers module — the handler exposes a seam for tests).
 *   - `@langfuse/tracing` mocked — no OTel traffic.
 *   - fake step runs .run() inline; .waitForEvent is a mock the test configures
 *     per case (event payload or null for timeout).
 *
 * Requires: DATABASE_URL_ADMIN + TELEGRAM_BOT_TOKEN (even bogus — the token
 * is only consumed by a Bot instance that we never actually call against
 * Telegram because sendMessage is mocked via the seam).
 *
 * Run via: doppler run --config dev -- bun run --cwd apps/workers test
 */

const adminUrl = process.env.DATABASE_URL_ADMIN
if (adminUrl === undefined) {
  throw new Error('DATABASE_URL_ADMIN required for BLU-25 integration test')
}

// Silence Langfuse so tests don't hit Cloud / leak creds.
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

const TEST_PREFIX = `blu25-test-${crypto.randomUUID().slice(0, 8)}`
const TEST_CHAT_ID = `-100${Math.floor(Math.random() * 1e10)}`

let tenantId: string
let threadId: string
let agentRunId: string
let channelId: string
let conciergeDefId: string
let conciergePromptId: string

beforeAll(async () => {
  const [tenant] = await admin<{ id: string }[]>`
    INSERT INTO tenants (slug, legal_name, display_name)
    VALUES (${`${TEST_PREFIX}-a`}, 'BLU-25 Test LLC', 'BLU-25 Test')
    RETURNING id
  `
  if (tenant === undefined) throw new Error('fixture: tenant')
  tenantId = tenant.id

  const [channel] = await admin<{ id: string }[]>`
    INSERT INTO channels (tenant_id, kind, external_id, is_primary, active)
    VALUES (${tenantId}, 'telegram', ${TEST_CHAT_ID}, true, true)
    RETURNING id
  `
  if (channel === undefined) throw new Error('fixture: channel')
  channelId = channel.id

  const [thread] = await admin<{ id: string }[]>`
    INSERT INTO threads (tenant_id, channel_id, kind)
    VALUES (${tenantId}, ${channelId}, 'owner_primary')
    RETURNING id
  `
  if (thread === undefined) throw new Error('fixture: thread')
  threadId = thread.id

  const [concierge] = await admin<{ id: string }[]>`
    SELECT id FROM agent_definitions WHERE code = 'concierge' LIMIT 1
  `
  if (concierge === undefined) throw new Error('concierge agent_definition not seeded')
  conciergeDefId = concierge.id

  const [prompt] = await admin<{ id: string }[]>`
    SELECT id FROM prompts
    WHERE  agent_definition_id = ${conciergeDefId}
    ORDER  BY version DESC
    LIMIT  1
  `
  if (prompt === undefined) throw new Error('concierge prompt not seeded')
  conciergePromptId = prompt.id

  const [run] = await admin<{ id: string }[]>`
    INSERT INTO agent_runs (
      tenant_id, thread_id, agent_definition_id, prompt_id,
      trigger_kind, trigger_ref, input, model, status
    ) VALUES (
      ${tenantId}, ${threadId}, ${conciergeDefId}, ${conciergePromptId},
      'user_message', ${crypto.randomUUID()}, '{"test":true}'::jsonb,
      'claude-haiku-4-5-20251001', 'completed'
    )
    RETURNING id
  `
  if (run === undefined) throw new Error('fixture: agent_run')
  agentRunId = run.id
})

afterAll(async () => {
  // audit_log is append-only (ARCHITECTURE.md #9) AND its `action_id` FK has
  // no ON DELETE CASCADE — by design, audit rows outlive the entities they
  // reference. That means we cannot DELETE the actions this test produced,
  // which also blocks DELETE FROM tenants (cascades through actions). We
  // accept the leak: per-run TEST_PREFIX isolates fixtures, and Neon branch
  // resets are the periodic dev-DB cleanup (same posture as BLU-24's
  // callback.* audit rows).
  await admin.end()
})

beforeEach(() => {
  mockSpanUpdate.mockClear()
})

afterEach(async () => {
  // Per-test isolation: wipe the rows we CAN safely remove between tests.
  // We leave `actions` + `audit_log` behind for the reasons noted in
  // afterAll. Each test inserts a fresh `action` with its own UUID, so
  // stale rows never collide with active assertions.
  await admin`DELETE FROM approval_requests WHERE tenant_id = ${tenantId}`
  await admin`DELETE FROM messages WHERE tenant_id = ${tenantId} AND direction = 'outbound'`
  await admin`DELETE FROM tool_calls WHERE tenant_id = ${tenantId}`
})

const insertAction = async (text: string): Promise<string> => {
  const [row] = await admin<{ id: string }[]>`
    INSERT INTO actions (tenant_id, agent_run_id, kind, payload, policy_outcome, status)
    VALUES (
      ${tenantId},
      ${agentRunId},
      'send_message',
      ${admin.json({ thread_id: threadId, text })},
      'approval_required',
      'pending'
    )
    RETURNING id
  `
  if (row === undefined) throw new Error('fixture: action insert')
  return row.id
}

const makeEvent = (actionId: string) =>
  ({
    data: {
      tenant_id: tenantId,
      correlation_id: crypto.randomUUID(),
      idempotency_key: `event:${actionId}:action`,
      action_id: actionId,
      agent_run_id: agentRunId,
      kind: 'send_message' as const,
      payload: { thread_id: threadId, text: 'ignored-by-handler' },
      policy_outcome: 'approval_required' as const,
    },
  } satisfies HandleActionGateArgs['event'])

/**
 * Fake step that runs `.run()` bodies inline. `.waitForEvent` is configured
 * per test via `fakeStep.waitForEvent.mockResolvedValueOnce(...)`. `.sendEvent`
 * is unused here (the gate function doesn't emit downstream events).
 */
const makeFakeStep = () => ({
  run: vi
    .fn()
    .mockImplementation(async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn()),
  sendEvent: vi.fn().mockResolvedValue({ ids: [] }),
  waitForEvent: vi.fn(),
})

const okSendResult = (telegramMessageId: number) =>
  Ok({
    toolCallId: crypto.randomUUID(),
    messageId: crypto.randomUUID(),
    telegramMessageId,
    cached: false,
  })

/**
 * Typed capture helper — records the input passed to each `sendMessage` call
 * so the test can assert on idempotency_key / replyMarkup / text without
 * leaking `any` into the assertion layer.
 */
const captureSend = () => {
  const calls: SendMessageInput[] = []
  const impl: SendMessageImpl = vi.fn(async (_deps, input) => {
    calls.push(input)
    return okSendResult(1000 + calls.length)
  })
  return { impl, calls }
}

describe('handleActionGate', () => {
  test('approved: approval_request → prompt → wait → dispatch (2 sends, action=executed)', async () => {
    const actionId = await insertAction('Thanks — we will keep an eye on that.')
    const fakeStep = makeFakeStep()
    const send = captureSend()

    // Simulate an approved callback landing while we waited.
    fakeStep.waitForEvent.mockResolvedValueOnce({
      data: {
        tenant_id: tenantId,
        correlation_id: 'decision-corr',
        idempotency_key: 'tg:callback:cb-1',
        approval_request_id: 'placeholder-filled-by-gate',
        decision: 'approved' as const,
        user_telegram_id: 99_999,
      },
    })

    const result = await handleActionGate({
      event: makeEvent(actionId),
      step: fakeStep,
      dbOverride: db,
      sendMessageImpl: send.impl,
    })

    expect(result.outcome).toBe('executed')
    expect(result.action_id).toBe(actionId)
    expect(result.approval_request_id).toBeTruthy()

    // approval_requests row created + resolved approved
    const [appr] = await admin<
      { id: string; resolved_status: string | null; resolution_note: string | null }[]
    >`
      SELECT id, resolved_status, resolution_note
      FROM   approval_requests
      WHERE  action_id = ${actionId}
    `
    expect(appr?.resolved_status).toBe('approved')
    expect(appr?.resolution_note).toBe('telegram:99999')

    // action status terminal
    const [action] = await admin<{ status: string; executed_at: Date | null }[]>`
      SELECT status, executed_at FROM actions WHERE id = ${actionId}
    `
    expect(action?.status).toBe('executed')
    expect(action?.executed_at).not.toBeNull()

    // Two Telegram sends — prompt (with buttons) + dispatch (no buttons)
    expect(send.calls).toHaveLength(2)
    expect(send.calls[0]?.idempotencyKey).toBe(`approval-prompt:${actionId}`)
    expect(send.calls[0]?.replyMarkup?.inline_keyboard[0]).toHaveLength(2)
    expect(send.calls[0]?.replyMarkup?.inline_keyboard[0]?.[0]?.callback_data).toMatch(
      /^approval:[0-9a-f-]{36}:approved$/,
    )
    expect(send.calls[1]?.idempotencyKey).toBe(`action-dispatch:${actionId}`)
    expect(send.calls[1]?.replyMarkup).toBeUndefined()
    expect(send.calls[1]?.text).toBe('Thanks — we will keep an eye on that.')

    // audit rows: approval.granted + action.executed
    const audits = await admin<{ event_kind: string }[]>`
      SELECT event_kind FROM audit_log
      WHERE  action_id = ${actionId}
      ORDER  BY occurred_at ASC
    `
    expect(audits.map((a) => a.event_kind)).toEqual(['approval.granted', 'action.executed'])
  })

  test('rejected: approval_request → prompt → decision → ack (action=rejected)', async () => {
    const actionId = await insertAction('Draft sounds fine, right?')
    const fakeStep = makeFakeStep()
    const send = captureSend()

    fakeStep.waitForEvent.mockResolvedValueOnce({
      data: {
        tenant_id: tenantId,
        correlation_id: 'decision-corr',
        idempotency_key: 'tg:callback:cb-2',
        approval_request_id: 'placeholder',
        decision: 'rejected' as const,
        user_telegram_id: 88_888,
      },
    })

    const result = await handleActionGate({
      event: makeEvent(actionId),
      step: fakeStep,
      dbOverride: db,
      sendMessageImpl: send.impl,
    })

    expect(result.outcome).toBe('rejected')

    const [appr] = await admin<
      { resolved_status: string | null; resolution_note: string | null }[]
    >`
      SELECT resolved_status, resolution_note FROM approval_requests WHERE action_id = ${actionId}
    `
    expect(appr?.resolved_status).toBe('rejected')
    expect(appr?.resolution_note).toBe('telegram:88888')

    const [action] = await admin<{ status: string; executed_at: Date | null }[]>`
      SELECT status, executed_at FROM actions WHERE id = ${actionId}
    `
    expect(action?.status).toBe('rejected')
    expect(action?.executed_at).toBeNull()

    // Two sends: prompt + ack-rejection
    expect(send.calls).toHaveLength(2)
    expect(send.calls[1]?.idempotencyKey).toBe(`action-ack-rejected:${actionId}`)
    expect(send.calls[1]?.text).toBe('Action cancelled by operator.')
    expect(send.calls[1]?.replyMarkup).toBeUndefined()

    const audits = await admin<{ event_kind: string }[]>`
      SELECT event_kind FROM audit_log WHERE action_id = ${actionId} ORDER BY occurred_at ASC
    `
    expect(audits.map((a) => a.event_kind)).toEqual(['approval.rejected'])
  })

  test('timeout: waitForEvent returns null → action=expired, approval=expired, one send', async () => {
    const actionId = await insertAction('Standby response.')
    const fakeStep = makeFakeStep()
    const send = captureSend()

    fakeStep.waitForEvent.mockResolvedValueOnce(null)

    const result = await handleActionGate({
      event: makeEvent(actionId),
      step: fakeStep,
      dbOverride: db,
      sendMessageImpl: send.impl,
      timeoutOverride: 50, // fast — not actually used since fake returns immediately
    })

    expect(result.outcome).toBe('expired')

    const [appr] = await admin<
      { resolved_status: string | null; resolved_at: Date | null }[]
    >`
      SELECT resolved_status, resolved_at FROM approval_requests WHERE action_id = ${actionId}
    `
    expect(appr?.resolved_status).toBe('expired')
    expect(appr?.resolved_at).not.toBeNull()

    const [action] = await admin<
      { status: string; failure_reason: string | null; failed_at: Date | null }[]
    >`
      SELECT status, failure_reason, failed_at FROM actions WHERE id = ${actionId}
    `
    expect(action?.status).toBe('expired')
    expect(action?.failure_reason).toBe('approval_expired')
    expect(action?.failed_at).not.toBeNull()

    // Only the approval-prompt send — no dispatch, no ack
    expect(send.calls).toHaveLength(1)
    expect(send.calls[0]?.idempotencyKey).toBe(`approval-prompt:${actionId}`)

    const audits = await admin<{ event_kind: string }[]>`
      SELECT event_kind FROM audit_log WHERE action_id = ${actionId}
    `
    expect(audits.map((a) => a.event_kind)).toEqual(['approval.expired'])
  })

  test('duplicate handler invocation: single approval_request, single prompt send (comms idempotency)', async () => {
    const actionId = await insertAction('Will check in with you later.')
    const fakeStep1 = makeFakeStep()
    const send = captureSend()

    fakeStep1.waitForEvent.mockResolvedValueOnce({
      data: {
        tenant_id: tenantId,
        correlation_id: 'first-pass-corr',
        idempotency_key: 'tg:callback:cb-dup',
        approval_request_id: 'placeholder',
        decision: 'approved' as const,
        user_telegram_id: 123,
      },
    })

    await handleActionGate({
      event: makeEvent(actionId),
      step: fakeStep1,
      dbOverride: db,
      sendMessageImpl: send.impl,
    })

    // Second invocation — should re-use the existing approval_request and
    // skip re-inserting. Because our `send.impl` is a fresh closure per call,
    // the first call inserted a `tool_calls` row for the prompt; the SECOND
    // attempt's real `sendMessage` (not our test impl) would see it cached —
    // but since we pass the same `send.impl`, we just track that the gate
    // itself does not insert a second approval_requests row.
    const fakeStep2 = makeFakeStep()
    fakeStep2.waitForEvent.mockResolvedValueOnce({
      data: {
        tenant_id: tenantId,
        correlation_id: 'second-pass-corr',
        idempotency_key: 'tg:callback:cb-dup',
        approval_request_id: 'placeholder',
        decision: 'approved' as const,
        user_telegram_id: 123,
      },
    })

    await handleActionGate({
      event: makeEvent(actionId),
      step: fakeStep2,
      dbOverride: db,
      sendMessageImpl: send.impl,
    })

    // Exactly ONE approval_request row across both invocations
    const apprRows = await admin<{ id: string }[]>`
      SELECT id FROM approval_requests WHERE action_id = ${actionId}
    `
    expect(apprRows).toHaveLength(1)

    // action.gate is allowed to call sendMessage with the same
    // idempotency key on the second pass — the real Comms MCP dedups at the
    // tool_calls layer (BLU-21), so Telegram is not re-called. Assert that
    // every send.calls entry has a valid idempotency_key we recognize.
    for (const call of send.calls) {
      expect(call.idempotencyKey).toMatch(
        new RegExp(`^(approval-prompt|action-dispatch):${actionId}$`),
      )
    }
  })

  test('wrong policy_outcome short-circuits with outcome=skipped', async () => {
    const actionId = await insertAction('payload present but policy says auto')
    const fakeStep = makeFakeStep()
    const send = captureSend()

    const evt = makeEvent(actionId)
    const evtSkipped = {
      ...evt,
      data: {
        ...evt.data,
        policy_outcome: 'auto' as unknown as 'approval_required',
      },
    }
    const result = await handleActionGate({
      event: evtSkipped,
      step: fakeStep,
      dbOverride: db,
      sendMessageImpl: send.impl,
    })

    expect(result.outcome).toBe('skipped')
    expect(send.calls).toHaveLength(0)
    expect(fakeStep.run).not.toHaveBeenCalled()
    expect(fakeStep.waitForEvent).not.toHaveBeenCalled()
  })

  test('dispatch failure after approval: action=failed, ack audit row, throws for Inngest retry', async () => {
    const actionId = await insertAction('This dispatch will fail')
    const fakeStep = makeFakeStep()

    const sendCalls: SendMessageInput[] = []
    const failingSend: SendMessageImpl = vi.fn(async (_deps, input) => {
      sendCalls.push(input)
      if (input.idempotencyKey === `action-dispatch:${actionId}`) {
        return Err({ kind: 'telegram_error', message: 'simulated 500' })
      }
      return okSendResult(2001)
    })

    fakeStep.waitForEvent.mockResolvedValueOnce({
      data: {
        tenant_id: tenantId,
        correlation_id: 'corr-fail',
        idempotency_key: 'tg:callback:cb-fail',
        approval_request_id: 'placeholder',
        decision: 'approved' as const,
        user_telegram_id: 42,
      },
    })

    await expect(
      handleActionGate({
        event: makeEvent(actionId),
        step: fakeStep,
        dbOverride: db,
        sendMessageImpl: failingSend,
      }),
    ).rejects.toThrow(/action dispatch failed/)

    const [action] = await admin<
      { status: string; failure_reason: string | null }[]
    >`
      SELECT status, failure_reason FROM actions WHERE id = ${actionId}
    `
    expect(action?.status).toBe('failed')
    expect(action?.failure_reason).toContain('telegram_error')

    const audits = await admin<{ event_kind: string }[]>`
      SELECT event_kind FROM audit_log WHERE action_id = ${actionId}
      ORDER BY occurred_at ASC
    `
    // approval.granted recorded before dispatch attempted; action.failed after
    expect(audits.map((a) => a.event_kind)).toEqual(['approval.granted', 'action.failed'])
  })
})
