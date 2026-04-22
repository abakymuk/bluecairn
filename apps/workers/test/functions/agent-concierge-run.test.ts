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

const { handleAgentConciergeRun, handleAgentConciergeRunFailure, toTaggedStepError, parseFailedStep } =
  await import('../../src/functions/agent-concierge-run.js')

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
  // audit_log has a BEFORE DELETE immutability trigger and its
  // `agent_run_id` FK doesn't cascade. BLU-34 started writing audit rows
  // in tests; tenant cleanup now needs to purge audit_log first. Disable
  // the trigger for the admin cleanup session only (admin owns the
  // table), then re-enable. No production impact — scoped to this tx.
  await admin`ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_delete`
  try {
    await admin`
      DELETE FROM audit_log
      WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE ${`${TEST_PREFIX}%`})
    `
    await admin`DELETE FROM tenants WHERE slug LIKE ${`${TEST_PREFIX}%`}`
  } finally {
    await admin`ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_delete`
  }
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
  // audit_log rows are append-only (immutability trigger) — BLU-34 tests
  // filter on a per-call correlation_id so rows from earlier tests don't
  // cross-contaminate assertions.
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

  test('LLM failure (BLU-34 v2): handler throws with [step=generate-ack] tag, run stays running', async () => {
    // Handler lets step errors bubble unchanged. `agent_runs` MUST stay
    // 'running' until Inngest exhausts retries and fires onFailure —
    // otherwise a transient `rate_limit` that would retry successfully
    // would still leave the run terminally failed on first attempt.
    mockGenerateText.mockResolvedValueOnce({
      ok: false as const,
      error: { kind: 'rate_limit' as const, message: '429 too many requests' },
    })

    const ev = makeEvent()
    await expect(
      handleAgentConciergeRun({ event: ev, step: fakeStep, dbOverride: db }),
    ).rejects.toThrow(/\[step=generate-ack\].*\[kind=rate_limit\].*concierge LLM failed/)

    // No actions row — handler threw before insert-action step.
    const actions = await admin<{ id: string }[]>`
      SELECT id FROM actions WHERE tenant_id = ${tenantId}
    `
    expect(actions).toHaveLength(0)

    // BLU-34 v2 critical invariant: on transient failure (pre-onFailure
    // state), agent_runs MUST stay 'running' so a successful Inngest
    // retry can complete it normally.
    const [run] = await admin<{ status: string }[]>`
      SELECT status FROM agent_runs WHERE id = ${runId}
    `
    expect(run?.status).toBe('running')

    // No audit_log row yet — the run-failed audit only lands when
    // Inngest fires onFailure (tested separately below).
    const audits = await admin<{ id: string }[]>`
      SELECT id FROM audit_log
      WHERE agent_run_id = ${runId}
      AND event_kind = 'agent.run_failed'
      AND event_payload->>'correlation_id' = ${ev.data.correlation_id}
    `
    expect(audits).toHaveLength(0)

    // No action.requested emitted on failure.
    expect(fakeStep.sendEvent).not.toHaveBeenCalled()
  })

  test('onFailure (BLU-34 v2): marks run failed + writes agent.run_failed audit row', async () => {
    // Simulates Inngest firing onFailure after exhausting the retry
    // budget. The failure handler is the only place that transitions
    // agent_runs.status to 'failed'.
    const correlationId = crypto.randomUUID()
    const originalEventData = {
      tenant_id: tenantId,
      correlation_id: correlationId,
      idempotency_key: `tg:${TEST_CHAT_ID}:onfail-${correlationId.slice(0, 4)}`,
      run_id: runId,
      agent_code: 'concierge',
      thread_id: threadId,
      message_id: messageId,
    }
    // Craft an error shaped like the handler's final thrown Error so the
    // `[step=...]` + `[kind=...]` tags are present.
    const finalError = new Error(
      '[step=generate-ack] [kind=rate_limit] concierge LLM failed: rate_limit: 429 too many requests',
    )

    await handleAgentConciergeRunFailure({
      event: { data: { event: { data: originalEventData } } },
      error: finalError,
      dbOverride: db,
    })

    const [run] = await admin<{
      status: string
      output: { error_kind: string; error_message: string; failed_step: string } | null
      completed_at: Date | null
    }[]>`
      SELECT status, output, completed_at FROM agent_runs WHERE id = ${runId}
    `
    expect(run?.status).toBe('failed')
    expect(run?.output?.error_kind).toBe('rate_limit')
    expect(run?.output?.failed_step).toBe('generate-ack')
    expect(run?.output?.error_message).toContain('concierge LLM failed')
    expect(run?.completed_at).not.toBeNull()

    const audits = await admin<{
      event_kind: string
      event_summary: string
      event_payload: {
        agent_code: string
        failed_step: string
        error_kind: string
        error_message: string
        correlation_id: string
      } | null
    }[]>`
      SELECT event_kind, event_summary, event_payload
      FROM audit_log
      WHERE agent_run_id = ${runId}
      AND event_kind = 'agent.run_failed'
      AND event_payload->>'correlation_id' = ${correlationId}
    `
    expect(audits).toHaveLength(1)
    expect(audits[0]?.event_summary).toBe('agent run failed: rate_limit')
    expect(audits[0]?.event_payload?.failed_step).toBe('generate-ack')
    expect(audits[0]?.event_payload?.error_kind).toBe('rate_limit')
  })

  test('onFailure idempotency (BLU-34 v2): two invocations for same run → one audit row', async () => {
    // Defensive: even though Inngest is supposed to fire onFailure once
    // per exhausted retry budget, the guarded UPDATE in markRunFailed
    // zero-rows on a terminal run and skips the second audit insert.
    const correlationId = crypto.randomUUID()
    const originalEventData = {
      tenant_id: tenantId,
      correlation_id: correlationId,
      idempotency_key: `tg:${TEST_CHAT_ID}:twice-${correlationId.slice(0, 4)}`,
      run_id: runId,
      agent_code: 'concierge',
      thread_id: threadId,
      message_id: messageId,
    }
    const finalError = new Error(
      '[step=load-run-context] agent_run missing during replay',
    )

    await handleAgentConciergeRunFailure({
      event: { data: { event: { data: originalEventData } } },
      error: finalError,
      dbOverride: db,
    })
    await handleAgentConciergeRunFailure({
      event: { data: { event: { data: originalEventData } } },
      error: finalError,
      dbOverride: db,
    })

    const [run] = await admin<{ status: string }[]>`
      SELECT status FROM agent_runs WHERE id = ${runId}
    `
    expect(run?.status).toBe('failed')

    const audits = await admin<{ id: string }[]>`
      SELECT id FROM audit_log
      WHERE agent_run_id = ${runId}
      AND event_kind = 'agent.run_failed'
      AND event_payload->>'correlation_id' = ${correlationId}
    `
    expect(audits).toHaveLength(1)
  })

  test('raw generateText throw (not Err) gets tagged with [step=generate-ack] (PR #37 P2)', async () => {
    // When generateText throws instead of returning Err(...), the step's
    // try/catch converts it into a [step=generate-ack]-tagged Error so
    // onFailure attributes correctly. Without the wrapper, the raw throw
    // would reach onFailure untagged → failed_step='unknown'.
    mockGenerateText.mockRejectedValueOnce(new Error('Anthropic SDK panic: socket hang up'))

    const ev = makeEvent()
    const err = await handleAgentConciergeRun({
      event: ev,
      step: fakeStep,
      dbOverride: db,
    }).catch((e: unknown) => e as Error)

    expect(err).toBeInstanceOf(Error)
    expect(err.message).toMatch(/^\[step=generate-ack\] /)
    expect(err.message).toContain('Anthropic SDK panic: socket hang up')

    // Run stays running until onFailure fires (no premature terminal state).
    const [run] = await admin<{ status: string }[]>`
      SELECT status FROM agent_runs WHERE id = ${runId}
    `
    expect(run?.status).toBe('running')
  })

  test('toTaggedStepError: tags every step consistently; unit coverage for PR #37 P2', () => {
    // Unit-level: the helper is what every step's catch delegates to, so
    // covering all four step names + preservation semantics here is
    // cheaper than spinning up four separate integration fixtures.
    for (const step of [
      'load-run-context',
      'generate-ack',
      'insert-action',
      'finalize-agent-run',
    ] as const) {
      const tagged = toTaggedStepError(
        step,
        new Error('ECONNRESET: postgres client disconnected'),
      )
      expect(tagged.message).toMatch(new RegExp(`^\\[step=${step}\\] ECONNRESET`))
      expect(parseFailedStep(tagged)).toBe(step)
    }

    // Already-tagged error passes through unchanged (idempotent under
    // nested try/catch — hand-authored wrapStepError inside a step body
    // must not get re-wrapped by the outer catch).
    const already = new Error('[step=generate-ack] [kind=rate_limit] original')
    expect(toTaggedStepError('finalize-agent-run', already)).toBe(already)

    // Non-Error input stringifies into the tag.
    expect(toTaggedStepError('insert-action', 'string error').message).toBe(
      '[step=insert-action] string error',
    )

    // Preserves stack + cause for debugging.
    const withCause = new Error('outer')
    ;(withCause as Error & { cause?: unknown }).cause = new Error('inner')
    const taggedWithCause = toTaggedStepError('generate-ack', withCause)
    expect((taggedWithCause as Error & { cause?: unknown }).cause).toBe(
      (withCause as Error & { cause?: unknown }).cause,
    )
    expect(taggedWithCause.stack).toBe(withCause.stack)
  })

  test('onFailure: unknown error (no [step=...] tag) → failed_step="unknown"', async () => {
    // An error thrown outside our wrapStepError conventions (e.g. a
    // framework-level failure) still transitions the run to failed.
    // failed_step defaults to 'unknown'.
    const correlationId = crypto.randomUUID()
    const originalEventData = {
      tenant_id: tenantId,
      correlation_id: correlationId,
      idempotency_key: `tg:${TEST_CHAT_ID}:unk-${correlationId.slice(0, 4)}`,
      run_id: runId,
      agent_code: 'concierge',
      thread_id: threadId,
      message_id: messageId,
    }
    const finalError = new Error('unexpected upstream connection reset')

    await handleAgentConciergeRunFailure({
      event: { data: { event: { data: originalEventData } } },
      error: finalError,
      dbOverride: db,
    })

    const [run] = await admin<{
      status: string
      output: { error_kind: string; failed_step: string } | null
    }[]>`
      SELECT status, output FROM agent_runs WHERE id = ${runId}
    `
    expect(run?.status).toBe('failed')
    expect(run?.output?.failed_step).toBe('unknown')
    expect(run?.output?.error_kind).toBe('unknown')
  })
})
