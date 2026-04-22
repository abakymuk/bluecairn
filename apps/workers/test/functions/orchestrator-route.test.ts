import { createDatabase } from '@bluecairn/db'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Integration test for the M1 orchestrator (BLU-22).
 *
 * - admin conn (`DATABASE_URL_ADMIN`) seeds a test tenant + channel + thread +
 *   inbound messages per test run.
 * - `@bluecairn/agents` `generateText` is mocked so no real Haiku calls.
 * - `@langfuse/tracing` is mocked so no real OTel traffic.
 * - The handler (`handleOrchestratorRoute`) is imported AFTER mocks so it
 *   binds to the stubs.
 * - Fake `step` object runs `.run()` callbacks inline + records `.sendEvent`
 *   calls.
 *
 * Requires env: DATABASE_URL_ADMIN + concierge seed applied (see
 * `packages/db/scripts/seed-agent-definitions.sql` + `seed-concierge-prompt.sql`).
 * Run via:
 *   doppler run --config dev -- bun run --cwd apps/workers test
 */

const adminUrl = process.env.DATABASE_URL_ADMIN
if (adminUrl === undefined) {
  throw new Error('DATABASE_URL_ADMIN required for BLU-22 integration test')
}

// Mock @bluecairn/agents generateText — return deterministic text per test.
const { mockGenerateText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
}))

vi.mock('@bluecairn/agents', () => ({
  generateText: mockGenerateText,
  initTracing: vi.fn(),
  shutdownTracing: vi.fn(),
}))

// Mock @langfuse/tracing — fake span captures .update() calls but doesn't
// emit real OTel spans.
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

const TEST_PREFIX = `blu22-test-${crypto.randomUUID().slice(0, 8)}`
const TEST_CHAT_ID = `-100${Math.floor(Math.random() * 1e10)}`

let tenantId: string
let threadId: string
let messageId: string

const fakeStep = {
  run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
  sendEvent: vi.fn().mockResolvedValue({ ids: ['fake-event-id'] }),
}

beforeAll(async () => {
  const [tenant] = await admin<{ id: string }[]>`
    INSERT INTO tenants (slug, legal_name, display_name)
    VALUES (${`${TEST_PREFIX}-a`}, 'BLU-22 Test LLC', 'BLU-22 Test')
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

  const [thread] = await admin<{ id: string }[]>`
    INSERT INTO threads (tenant_id, channel_id, kind)
    VALUES (${tenantId}, ${channel.id}, 'owner_primary')
    RETURNING id
  `
  if (thread === undefined) throw new Error('fixture: thread')
  threadId = thread.id

  // Seed 2 prior inbound messages + 1 new "trigger" message. Orchestrator
  // uses message_id to identify which one to classify.
  await admin`
    INSERT INTO messages (tenant_id, thread_id, author_kind, direction, content, external_message_id, idempotency_key)
    VALUES (${tenantId}, ${threadId}, 'user', 'inbound', 'prior msg 1', '1', ${`${TEST_PREFIX}:1`})
  `
  await admin`
    INSERT INTO messages (tenant_id, thread_id, author_kind, direction, content, external_message_id, idempotency_key)
    VALUES (${tenantId}, ${threadId}, 'user', 'inbound', 'prior msg 2', '2', ${`${TEST_PREFIX}:2`})
  `
  const [trigger] = await admin<{ id: string }[]>`
    INSERT INTO messages (tenant_id, thread_id, author_kind, direction, content, external_message_id, idempotency_key)
    VALUES (${tenantId}, ${threadId}, 'user', 'inbound', 'when can I pick up my order?', '3', ${`${TEST_PREFIX}:3`})
    RETURNING id
  `
  if (trigger === undefined) throw new Error('fixture: trigger message')
  messageId = trigger.id
})

afterAll(async () => {
  await admin`DELETE FROM tenants WHERE slug LIKE ${`${TEST_PREFIX}%`}`
  await admin.end()
})

beforeEach(() => {
  mockGenerateText.mockReset()
  mockSpanUpdate.mockClear()
  fakeStep.sendEvent.mockClear()
})

afterEach(async () => {
  // Keep `messages` rows for multi-test consistency but reset agent_runs.
  await admin`DELETE FROM agent_runs WHERE tenant_id = ${tenantId}`
})

const makeEvent = (msgId: string = messageId) => ({
  data: {
    tenant_id: tenantId,
    thread_id: threadId,
    message_id: msgId,
    channel_id: crypto.randomUUID(),
    correlation_id: crypto.randomUUID(),
    idempotency_key: `tg:${TEST_CHAT_ID}:${msgId.slice(0, 4)}`,
  },
})

const okHaikuResult = (text: string) => ({
  ok: true as const,
  value: {
    text,
    tokens: { input: 40, output: 3, total: 43 },
    costUsd: 0.000055,
    modelId: 'claude-haiku-4-5-20251001',
    latencyMs: 320,
    langfuseTraceId: 'trace-from-haiku-call',
  },
})

describe('handleOrchestratorRoute', () => {
  test('happy path: classifies as concierge, writes agent_run, emits agent.run.requested', async () => {
    mockGenerateText.mockResolvedValueOnce(okHaikuResult('concierge'))

    const result = await handleOrchestratorRoute({
      event: makeEvent(),
      step: fakeStep,
      dbOverride: db,
    })

    expect(result.agent_code).toBe('concierge')
    expect(result.classifier_downgraded).toBe(false)
    expect(result.policy_default).toBe('approval_required')
    expect(result.langfuse_trace_id).toBe('trace-from-haiku-call')
    expect(result.run_id).toBeTruthy()

    // agent_runs row inserted with classification + model + tokens
    const runs = await admin<
      {
        id: string
        status: string
        model: string
        input_tokens: number | null
        output_tokens: number | null
        langfuse_trace_id: string | null
        input: { classification: { agent_code: string; downgraded: boolean } }
        trigger_ref: string
        trigger_kind: string
      }[]
    >`
      SELECT id, status, model, input_tokens, output_tokens, langfuse_trace_id, input, trigger_ref, trigger_kind
      FROM   agent_runs WHERE tenant_id = ${tenantId}
    `
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('running')
    expect(runs[0]?.model).toBe('claude-haiku-4-5-20251001')
    expect(runs[0]?.input_tokens).toBe(40)
    expect(runs[0]?.output_tokens).toBe(3)
    expect(runs[0]?.langfuse_trace_id).toBe('trace-from-haiku-call')
    expect(runs[0]?.trigger_kind).toBe('user_message')
    expect(runs[0]?.trigger_ref).toBe(messageId)
    expect(runs[0]?.input.classification.agent_code).toBe('concierge')
    expect(runs[0]?.input.classification.downgraded).toBe(false)

    // Haiku called once with classifier metadata
    expect(mockGenerateText).toHaveBeenCalledTimes(1)
    const [haikuArgs] = mockGenerateText.mock.calls[0] ?? []
    expect(haikuArgs).toMatchObject({
      metadata: {
        tenantId,
        agentCode: 'classifier',
      },
    })

    // agent.run.requested emitted with the new run_id + concierge
    expect(fakeStep.sendEvent).toHaveBeenCalledTimes(1)
    const [, sentPayload] = fakeStep.sendEvent.mock.calls[0] ?? []
    expect(sentPayload).toMatchObject({
      name: 'agent.run.requested',
      data: expect.objectContaining({
        tenant_id: tenantId,
        run_id: result.run_id,
        agent_code: 'concierge',
        thread_id: threadId,
        message_id: messageId,
      }),
    })
    // Dedup id present
    expect(sentPayload).toHaveProperty('id')
    expect(typeof (sentPayload as { id: string }).id).toBe('string')

    // Langfuse span wrapping: input + output update calls
    expect(mockSpanUpdate).toHaveBeenCalledTimes(2)
    expect(mockSpanUpdate).toHaveBeenNthCalledWith(1, {
      input: { thread_id: threadId, message_id: messageId },
      metadata: expect.objectContaining({ tenant_id: tenantId }),
    })
    expect(mockSpanUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        output: expect.objectContaining({ agent_code: 'concierge' }),
      }),
    )
  })

  test('out-of-whitelist: Haiku returns "sofia" → normalized to concierge + downgraded metadata', async () => {
    mockGenerateText.mockResolvedValueOnce(okHaikuResult('sofia'))

    const result = await handleOrchestratorRoute({
      event: makeEvent(),
      step: fakeStep,
      dbOverride: db,
    })

    expect(result.agent_code).toBe('concierge')
    expect(result.classifier_downgraded).toBe(true)

    // Langfuse metadata reflects downgrade for post-hoc analysis.
    const downgradeUpdate = mockSpanUpdate.mock.calls.find(
      (call) => (call[0] as { metadata?: Record<string, unknown> })?.metadata?.['classifier.downgraded'] === true,
    )
    expect(downgradeUpdate).toBeDefined()

    // agent_run still created, classification.downgraded=true
    const runs = await admin<
      { input: { classification: { downgraded: boolean; raw: string } } }[]
    >`
      SELECT input FROM agent_runs WHERE tenant_id = ${tenantId}
    `
    expect(runs).toHaveLength(1)
    expect(runs[0]?.input.classification.downgraded).toBe(true)
    expect(runs[0]?.input.classification.raw).toBe('sofia')
  })

  test('idempotent replay: same message_id twice → one agent_run, two emits (sendEvent is naive)', async () => {
    mockGenerateText.mockResolvedValue(okHaikuResult('concierge'))

    const ev = makeEvent()
    const first = await handleOrchestratorRoute({
      event: ev,
      step: fakeStep,
      dbOverride: db,
    })
    const second = await handleOrchestratorRoute({
      event: ev,
      step: fakeStep,
      dbOverride: db,
    })

    // Same run_id — handler dedups on (tenant, thread, trigger_kind, trigger_ref)
    expect(second.run_id).toBe(first.run_id)

    const runs = await admin<{ id: string }[]>`
      SELECT id FROM agent_runs WHERE tenant_id = ${tenantId}
    `
    expect(runs).toHaveLength(1)

    // sendEvent was called twice (Inngest dedups at event-id layer, not in
    // our fake step). Confirms the emit id uses the event's idempotency_key
    // so Inngest Cloud can collapse duplicates.
    expect(fakeStep.sendEvent).toHaveBeenCalledTimes(2)
    const [, firstPayload] = fakeStep.sendEvent.mock.calls[0] ?? []
    const [, secondPayload] = fakeStep.sendEvent.mock.calls[1] ?? []
    expect((firstPayload as { id: string }).id).toBe((secondPayload as { id: string }).id)
  })

  test('classifier failure: Haiku errors → handler throws (Inngest will retry)', async () => {
    mockGenerateText.mockResolvedValueOnce({
      ok: false as const,
      error: { kind: 'rate_limit' as const, message: '429 too many requests' },
    })

    await expect(
      handleOrchestratorRoute({
        event: makeEvent(),
        step: fakeStep,
        dbOverride: db,
      }),
    ).rejects.toThrow(/classifier call failed/)

    // No agent_run inserted — we throw before write-agent-run step.
    const runs = await admin<{ id: string }[]>`
      SELECT id FROM agent_runs WHERE tenant_id = ${tenantId}
    `
    expect(runs).toHaveLength(0)
  })
})
