import { beforeEach, describe, expect, test, vi } from 'vitest'
import { isErr, isOk } from '@bluecairn/core'

// Stub the AI SDK + Langfuse tracing so the unit test is pure (no network).
// vi.hoisted runs before the vi.mock factory registrations.
const { mockAiGenerate, mockGetTraceId } = vi.hoisted(() => ({
  mockAiGenerate: vi.fn(),
  mockGetTraceId: vi.fn().mockReturnValue('trace-test-123'),
}))

vi.mock('ai', () => ({
  generateText: mockAiGenerate,
}))

vi.mock('@langfuse/tracing', () => ({
  startActiveObservation: async <T>(
    _name: string,
    callback: () => Promise<T>,
  ): Promise<T> => callback(),
  getActiveTraceId: mockGetTraceId,
}))

// Import AFTER mocks so llm.ts binds to the stubs.
const { generateText } = await import('./llm.js')

const fakeModel = { modelId: 'claude-haiku-4-5-20251001' } as const

beforeEach(() => {
  mockAiGenerate.mockReset()
  mockGetTraceId.mockReturnValue('trace-test-123')
})

describe('generateText wrapper', () => {
  test('Ok path: returns text + tokens + cost + trace id + latency', async () => {
    mockAiGenerate.mockResolvedValueOnce({
      text: 'ok',
      usage: { promptTokens: 1_000, completionTokens: 500, totalTokens: 1_500 },
    })

    const result = await generateText({
      model: fakeModel as unknown as Parameters<typeof generateText>[0]['model'],
      prompt: 'hi',
      metadata: {
        tenantId: '00000000-0000-0000-0000-000000000001',
        correlationId: '00000000-0000-0000-0000-000000000002',
        agentCode: 'concierge',
        agentRunId: '00000000-0000-0000-0000-000000000003',
      },
    })

    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return

    expect(result.value.text).toBe('ok')
    expect(result.value.tokens).toEqual({ input: 1_000, output: 500, total: 1_500 })
    // claude-haiku-4-5: $1/MTok input, $5/MTok output → 1000 * 1/1M + 500 * 5/1M = 0.001 + 0.0025 = 0.0035
    expect(result.value.costUsd).toBeCloseTo(0.0035, 6)
    expect(result.value.modelId).toBe('claude-haiku-4-5-20251001')
    expect(result.value.langfuseTraceId).toBe('trace-test-123')
    expect(result.value.latencyMs).toBeGreaterThanOrEqual(0)
  })

  test('metadata propagates to AI SDK experimental_telemetry', async () => {
    mockAiGenerate.mockResolvedValueOnce({
      text: 'x',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })

    await generateText({
      model: fakeModel as unknown as Parameters<typeof generateText>[0]['model'],
      prompt: 'p',
      metadata: {
        tenantId: 'tenant-a',
        correlationId: 'corr-b',
        agentCode: 'concierge',
      },
    })

    expect(mockAiGenerate).toHaveBeenCalledTimes(1)
    const [args] = mockAiGenerate.mock.calls[0] ?? []
    expect(args).toMatchObject({
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'concierge',
        metadata: {
          tenant_id: 'tenant-a',
          correlation_id: 'corr-b',
        },
      },
    })
  })

  test('eval + case_id metadata propagates when set (ADR-0011)', async () => {
    mockAiGenerate.mockResolvedValueOnce({
      text: 'x',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })

    await generateText({
      model: fakeModel as unknown as Parameters<typeof generateText>[0]['model'],
      prompt: 'p',
      metadata: {
        tenantId: 't',
        correlationId: 'c',
        eval: 'concierge/unit',
        caseId: 'ack-vendor-complaint',
      },
    })

    const [args] = mockAiGenerate.mock.calls[0] ?? []
    expect(args).toMatchObject({
      experimental_telemetry: {
        metadata: {
          eval: 'concierge/unit',
          case_id: 'ack-vendor-complaint',
        },
      },
    })
  })

  test('eval + case_id absent when metadata omits them', async () => {
    mockAiGenerate.mockResolvedValueOnce({
      text: 'x',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })

    await generateText({
      model: fakeModel as unknown as Parameters<typeof generateText>[0]['model'],
      prompt: 'p',
      metadata: { tenantId: 't', correlationId: 'c' },
    })

    const [args] = mockAiGenerate.mock.calls[0] ?? []
    const metadata = (args as { experimental_telemetry: { metadata: Record<string, unknown> } })
      .experimental_telemetry.metadata
    expect(metadata).not.toHaveProperty('eval')
    expect(metadata).not.toHaveProperty('case_id')
  })

  test('rate limit error classified as rate_limit', async () => {
    mockAiGenerate.mockRejectedValueOnce(new Error('429 Too Many Requests — rate limit exceeded'))

    const result = await generateText({
      model: fakeModel as unknown as Parameters<typeof generateText>[0]['model'],
      prompt: 'p',
      metadata: { tenantId: 't', correlationId: 'c' },
    })

    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error.kind).toBe('rate_limit')
  })

  test('context overflow error classified as context_overflow', async () => {
    mockAiGenerate.mockRejectedValueOnce(
      new Error('prompt is too long for this model, context length exceeded'),
    )

    const result = await generateText({
      model: fakeModel as unknown as Parameters<typeof generateText>[0]['model'],
      prompt: 'p',
      metadata: { tenantId: 't', correlationId: 'c' },
    })

    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error.kind).toBe('context_overflow')
  })

  test('unknown model → costUsd=0 (no confident-wrong pricing)', async () => {
    mockAiGenerate.mockResolvedValueOnce({
      text: 'x',
      usage: { promptTokens: 10_000, completionTokens: 5_000, totalTokens: 15_000 },
    })

    const result = await generateText({
      model: { modelId: 'claude-unknown-future' } as unknown as Parameters<
        typeof generateText
      >[0]['model'],
      prompt: 'p',
      metadata: { tenantId: 't', correlationId: 'c' },
    })

    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.costUsd).toBe(0)
    expect(result.value.tokens.total).toBe(15_000)
  })
})
