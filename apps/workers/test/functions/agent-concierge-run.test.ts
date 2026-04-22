import { createDatabase } from '@bluecairn/db'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Integration test for agent.concierge.run (BLU-23).
 *
 * - admin conn seeds tenant + channel + thread + agent_run + inbound msg.
 * - `@bluecairn/agents` `generateText` is mocked — no real Haiku calls.
 * - `@langfuse/tracing` is mocked — no real OTel traffic.
 * - Fake step runs `.run()` callbacks inline + records `.sendEvent` calls.
 *
 * Requires: DATABASE_URL_ADMIN + concierge seed (agent_definition + v2 prompt).
 * Run via: doppler run --config dev -- bun run --cwd apps/workers test
 */

const adminUrl = process.env.DATABASE_URL_ADMIN
if (adminUrl === undefined) {
  throw new Error('DATABASE_URL_ADMIN required for BLU-23 integration test')
}

const { mockGenerateText } = vi.hoisted(() => ({ mockGenerateText: vi.fn() }))
vi.mock('@bluecairn/agents', async () => {
  const actual = await vi.importActual<typeof import('@bluecairn/agents')>('@bluecairn/agents')
  return {
    ...actual,
    generateText: mockGenerateText,
    initTracing: vi.fn(),
    shutdownTracing: vi.fn(),
  }
})

const { mockSpanUpdate } = vi.hoisted(() => ({ mockSpanUpdate: vi.fn() }))
vi.mock('@langfuse/tracing', () => ({
  startActiveObservation: async (
    _name: string,
    callback: (span: { update: typeof mockSpanUpdate }) => Promise<unknown>,
  ) => callback({ update: mockSpanUpdate }),
  getActiveTraceId: vi.fn().mockReturnValue('test-trace-id'),
  getActiveSpanId: vi.fn().mockReturnValue('test-span-id'),
}))

const { handleAgentConciergeRun } = await import('../../src/functions/agent-concierge-run.js')

const admin = postgres(adminUrl, { max: 1, prepare: false })
const db = createDatabase(adminUrl)

const TEST_PREFIX = `blu23-test-${crypto.randomUUID().slice(0, 8)}`
const TEST_CHAT_ID = `-100${Math.floor(Math.random() * 1e10)}`

let tenantId: string
let threadId: string
let runId: string
let messageId: string

const fakeStep = {
  run: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
  sendEvent: vi.fn().mockResolvedValue({ ids: ['fake-event-id'] }),
}

const okLlmResult = (text: string) => ({
  ok: true as const,
  value: {
    text,
    tokens: { input: 60, output: 22, total: 82 },
    costUsd: 0.00017,
    modelId: 'claude-haiku-4-5-20251001',
    latencyMs: 430,
    langfuseTraceId: 'trace-concierge-run',
  },
})

beforeAll(async () => {
  const [tenant] = await admin<{ id: string }[]>`
    INSERT INTO tenants (slug, legal_name, display_name)
    VALUES (${`${TEST_PREFIX}-a`}, 'BLU-23 Test LLC', 'BLU-23 Test')
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

  const [msg] = await admin<{ id: string }[]>`
    INSERT INTO messages (tenant_id, thread_id, author_kind, direction, content, external_message_id, idempotency_key)
    VALUES (${tenantId}, ${threadId}, 'user', 'inbound', 'Our flour delivery is late again.', '1', ${`${TEST_PREFIX}:1`})
    RETURNING id
  `
  if (msg === undefined) throw new Error('fixture: message')
  messageId = msg.id

  // Use the real concierge agent + its latest (v2) prompt from the global seed.
  const [concierge] = await admin<{ id: string }[]>`
    SELECT id FROM agent_definitions WHERE code = 'concierge' LIMIT 1
  `
  if (concierge === undefined) {
    throw new Error('concierge agent_definition not seeded — run seed-agent-definitions.sql')
  }
  const [prompt] = await admin<{ id: string }[]>`
    SELECT id FROM prompts
    WHERE  agent_definition_id = ${concierge.id}
    ORDER  BY version DESC
    LIMIT  1
  `
  if (prompt === undefined) {
    throw new Error('concierge prompt not seeded — run seed-concierge-prompt*.sql')
  }

  const [run] = await admin<{ id: string }[]>`
    INSERT INTO agent_runs (
      tenant_id, thread_id, agent_definition_id, prompt_id,
      trigger_kind, trigger_ref, input, model, status
    ) VALUES (
      ${tenantId}, ${threadId}, ${concierge.id}, ${prompt.id},
      'user_message', ${messageId}, '{"test":true}'::jsonb,
      'claude-haiku-4-5-20251001', 'running'
    )
    RETURNING id
  `
  if (run === undefined) throw new Error('fixture: agent_run')
  runId = run.id
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
  await admin`DELETE FROM actions WHERE tenant_id = ${tenantId}`
  // Reset agent_run so each test starts with status='running'.
  await admin`
    UPDATE agent_runs
    SET    status = 'running',
           output = NULL,
           input_tokens = NULL,
           output_tokens = NULL,
           cost_cents = NULL,
           latency_ms = NULL,
           completed_at = NULL
    WHERE  id = ${runId}
  `
})

const makeEvent = () => ({
  data: {
    tenant_id: tenantId,
    thread_id: threadId,
    message_id: messageId,
    correlation_id: crypto.randomUUID(),
    idempotency_key: `tg:${TEST_CHAT_ID}:1`,
    run_id: runId,
    agent_code: 'concierge',
  },
})

describe('handleAgentConciergeRun', () => {
  test('happy path: LLM ack → actions row + agent_run completed + action.requested emitted', async () => {
    mockGenerateText.mockResolvedValueOnce(
      okLlmResult("Got it — we'll take a look at the flour delivery. — Concierge"),
    )

    const result = await handleAgentConciergeRun({
      event: makeEvent(),
      step: fakeStep,
      dbOverride: db,
    })

    expect(result.run_id).toBe(runId)
    expect(result.action_id).toBeTruthy()
    expect(result.reply_text).toContain('Concierge')
    expect(result.tokens.input).toBe(60)
    expect(result.tokens.output).toBe(22)
    expect(result.langfuse_trace_id).toBe('trace-concierge-run')
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)

    // agent_run updated to completed
    const runs = await admin<
      {
        status: string
        input_tokens: number | null
        output_tokens: number | null
        cost_cents: number | null
        latency_ms: number | null
        completed_at: Date | null
        output: { reply_text: string; action_id: string } | null
      }[]
    >`
      SELECT status, input_tokens, output_tokens, cost_cents, latency_ms, completed_at, output
      FROM   agent_runs WHERE id = ${runId}
    `
    expect(runs[0]?.status).toBe('completed')
    expect(runs[0]?.input_tokens).toBe(60)
    expect(runs[0]?.output_tokens).toBe(22)
    expect(runs[0]?.cost_cents).toBe(0) // 0.00017 USD → round(0.017 cents) = 0
    expect(runs[0]?.latency_ms).toBeGreaterThanOrEqual(0)
    expect(runs[0]?.completed_at).toBeTruthy()
    expect(runs[0]?.output?.action_id).toBe(result.action_id)

    // actions row inserted with kind=send_message + policy_outcome=approval_required
    const actions = await admin<
      { id: string; kind: string; status: string; policy_outcome: string; payload: { thread_id: string; text: string } }[]
    >`
      SELECT id, kind, status, policy_outcome, payload
      FROM   actions WHERE tenant_id = ${tenantId}
    `
    expect(actions).toHaveLength(1)
    expect(actions[0]?.id).toBe(result.action_id)
    expect(actions[0]?.kind).toBe('send_message')
    expect(actions[0]?.status).toBe('pending')
    expect(actions[0]?.policy_outcome).toBe('approval_required')
    expect(actions[0]?.payload.thread_id).toBe(threadId)
    expect(actions[0]?.payload.text).toContain('Concierge')

    // action.requested emitted with canonical shape
    expect(fakeStep.sendEvent).toHaveBeenCalledTimes(1)
    const [, sentPayload] = fakeStep.sendEvent.mock.calls[0] ?? []
    expect(sentPayload).toMatchObject({
      name: 'action.requested',
      data: expect.objectContaining({
        tenant_id: tenantId,
        action_id: result.action_id,
        agent_run_id: runId,
        kind: 'send_message',
        policy_outcome: 'approval_required',
        payload: expect.objectContaining({ thread_id: threadId }),
      }),
    })

    // LLM invoked with concierge metadata (→ llm.concierge span name)
    expect(mockGenerateText).toHaveBeenCalledTimes(1)
    const [llmArgs] = mockGenerateText.mock.calls[0] ?? []
    expect(llmArgs).toMatchObject({
      system: expect.stringContaining('Concierge'),
      prompt: 'Our flour delivery is late again.',
      maxTokens: 500, // from conciergeGuardrails
      metadata: expect.objectContaining({
        agentRunId: runId,
        agentCode: 'concierge',
      }),
    })

    // Langfuse span wrap: input + output update calls
    expect(mockSpanUpdate).toHaveBeenCalledTimes(2)
    expect(mockSpanUpdate).toHaveBeenNthCalledWith(1, {
      input: expect.objectContaining({ run_id: runId }),
      metadata: expect.objectContaining({ agent_code: 'concierge' }),
    })
    expect(mockSpanUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        output: expect.objectContaining({ action_id: result.action_id }),
      }),
    )
  })

  test('idempotent replay: 2nd call → same action_id, one actions row', async () => {
    mockGenerateText.mockResolvedValue(okLlmResult('ack — Concierge'))

    const event = makeEvent()
    const first = await handleAgentConciergeRun({ event, step: fakeStep, dbOverride: db })
    const second = await handleAgentConciergeRun({ event, step: fakeStep, dbOverride: db })

    expect(second.action_id).toBe(first.action_id)

    const actions = await admin<{ id: string }[]>`
      SELECT id FROM actions WHERE tenant_id = ${tenantId}
    `
    expect(actions).toHaveLength(1)

    // Two emits (our fake step is naive), both with the same Inngest-side
    // dedup id so Inngest Cloud collapses them on ingestion.
    expect(fakeStep.sendEvent).toHaveBeenCalledTimes(2)
    const [, firstPayload] = fakeStep.sendEvent.mock.calls[0] ?? []
    const [, secondPayload] = fakeStep.sendEvent.mock.calls[1] ?? []
    expect((firstPayload as { id: string }).id).toBe((secondPayload as { id: string }).id)
  })

  test('LLM failure: handler throws, no actions row, agent_run stays running (Inngest will retry)', async () => {
    mockGenerateText.mockResolvedValueOnce({
      ok: false as const,
      error: { kind: 'rate_limit' as const, message: '429 too many requests' },
    })

    await expect(
      handleAgentConciergeRun({ event: makeEvent(), step: fakeStep, dbOverride: db }),
    ).rejects.toThrow(/concierge LLM failed/)

    // No actions row — handler threw before insert-action step
    const actions = await admin<{ id: string }[]>`
      SELECT id FROM actions WHERE tenant_id = ${tenantId}
    `
    expect(actions).toHaveLength(0)

    // agent_run still 'running' — Inngest retries handle state transition.
    // (finalize-agent-run never ran because insert-action was upstream.)
    const [run] = await admin<{ status: string }[]>`
      SELECT status FROM agent_runs WHERE id = ${runId}
    `
    expect(run?.status).toBe('running')

    // No action.requested emitted on failure
    expect(fakeStep.sendEvent).not.toHaveBeenCalled()
  })
})
