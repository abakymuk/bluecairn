import type { Bot } from 'grammy'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { createDatabase } from '@bluecairn/db'
import { sendMessage, type SendMessageDeps } from '../../src/comms/tools/send-message.js'

/**
 * Integration test for Comms MCP send_message (BLU-21).
 *
 * - admin conn seeds a test tenant + channel + thread + prompt + agent_run.
 * - grammY Bot is mocked so tests don't hit Telegram.
 * - each test verifies DB rows written / not written.
 *
 * Requires env: DATABASE_URL_ADMIN. Run via:
 *   doppler run --config dev -- bun run --cwd packages/mcp-servers test
 */

const adminUrl = process.env.DATABASE_URL_ADMIN
if (adminUrl === undefined) {
  throw new Error('DATABASE_URL_ADMIN required for BLU-21 integration test')
}

const admin = postgres(adminUrl, { max: 1, prepare: false })
const db = createDatabase(adminUrl)

const TEST_PREFIX = `blu21-test-${crypto.randomUUID().slice(0, 8)}`
const TEST_CHAT_ID = `-100${Math.floor(Math.random() * 1e10)}`
// Unique per run — avoid collision on `prompts.(agent_definition_id, version)`
// unique index when re-running against a shared dev DB.
const TEST_PROMPT_VERSION = 900_000 + Math.floor(Math.random() * 1_000_000)

let tenantId: string
let threadId: string
let agentRunId: string
let promptId: string

const mockSendMessage = vi.fn()
const fakeBot = { api: { sendMessage: mockSendMessage } } as unknown as Bot
const deps: SendMessageDeps = { db, bot: fakeBot }

beforeAll(async () => {
  const [tenant] = await admin<{ id: string }[]>`
    INSERT INTO tenants (slug, legal_name, display_name)
    VALUES (${`${TEST_PREFIX}-a`}, 'BLU-21 Test LLC', 'BLU-21 Test')
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

  // Fetch an existing seeded agent_definition; fall back to creating one if
  // the dev DB hasn't run seed-agent-definitions.sql yet.
  const [agentDef] = await admin<{ id: string }[]>`
    SELECT id FROM agent_definitions WHERE code = 'vendor_ops' LIMIT 1
  `
  let agentDefId = agentDef?.id
  if (agentDefId === undefined) {
    const [inserted] = await admin<{ id: string }[]>`
      INSERT INTO agent_definitions (code, persona_name, display_scope, priority)
      VALUES (${`${TEST_PREFIX}-agent`}, 'TestAgent', 'Test', 'P2')
      RETURNING id
    `
    if (inserted === undefined) throw new Error('fixture: agent_definition')
    agentDefId = inserted.id
  }

  const [prompt] = await admin<{ id: string }[]>`
    INSERT INTO prompts (agent_definition_id, version, content, content_hash, activated_at)
    VALUES (${agentDefId}, ${TEST_PROMPT_VERSION}, 'test prompt', ${TEST_PREFIX}, now())
    RETURNING id
  `
  if (prompt === undefined) throw new Error('fixture: prompt')
  promptId = prompt.id

  const [run] = await admin<{ id: string }[]>`
    INSERT INTO agent_runs (
      tenant_id, thread_id, agent_definition_id, prompt_id,
      trigger_kind, input, model, status
    ) VALUES (
      ${tenantId}, ${threadId}, ${agentDefId}, ${promptId},
      'user_message', '{"test":true}'::jsonb, 'claude-haiku-4-5-20251001', 'running'
    )
    RETURNING id
  `
  if (run === undefined) throw new Error('fixture: agent_run')
  agentRunId = run.id
})

afterAll(async () => {
  // Cascades: tenant → channels, threads, messages, tool_calls, agent_runs.
  // Prompt + agent_definition (if we created one) stay; we clean them via
  // the TEST_PREFIX hash column on prompts and the code column on agent_definitions.
  await admin`DELETE FROM tenants WHERE slug LIKE ${`${TEST_PREFIX}%`}`
  await admin`DELETE FROM prompts WHERE content_hash = ${TEST_PREFIX}`
  await admin`DELETE FROM agent_definitions WHERE code LIKE ${`${TEST_PREFIX}%`}`
  await admin.end()
})

beforeEach(() => {
  mockSendMessage.mockReset()
})

afterEach(async () => {
  // Clean rows each test creates so idempotency keys don't collide.
  await admin`DELETE FROM messages WHERE tenant_id = ${tenantId}`
  await admin`DELETE FROM tool_calls WHERE tenant_id = ${tenantId}`
})

describe('comms.send_message', () => {
  test('happy path: Telegram send + tool_calls row (success) + outbound messages row', async () => {
    mockSendMessage.mockResolvedValueOnce({ message_id: 4242 })

    const result = await sendMessage(deps, {
      tenantId,
      threadId,
      text: 'hello from BLU-21',
      idempotencyKey: `${TEST_PREFIX}:hello`,
      agentRunId,
      correlationId: crypto.randomUUID(),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.cached).toBe(false)
    expect(result.value.telegramMessageId).toBe(4242)
    expect(result.value.toolCallId).toBeTruthy()
    expect(result.value.messageId).toBeTruthy()

    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(mockSendMessage).toHaveBeenCalledWith(
      Number.parseInt(TEST_CHAT_ID, 10),
      'hello from BLU-21',
      {},
    )

    const toolCalls = await admin<
      { id: string; status: string; latency_ms: number | null; result: unknown }[]
    >`
      SELECT id, status, latency_ms, result FROM tool_calls
      WHERE tenant_id = ${tenantId} AND mcp_server = 'comms'
    `
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]?.status).toBe('success')
    expect(toolCalls[0]?.latency_ms).toBeGreaterThanOrEqual(0)

    const messages = await admin<
      {
        author_kind: string
        external_message_id: string
        direction: string
        tool_call_id: string | null
      }[]
    >`
      SELECT author_kind, external_message_id, direction, tool_call_id
      FROM   messages WHERE tenant_id = ${tenantId}
    `
    expect(messages).toHaveLength(1)
    expect(messages[0]?.author_kind).toBe('agent')
    expect(messages[0]?.external_message_id).toBe('4242')
    // BLU-32: explicit outbound direction + tool_call_id linkage to the
    // tool_calls row that produced this message.
    expect(messages[0]?.direction).toBe('outbound')
    expect(messages[0]?.tool_call_id).toBe(result.value.toolCallId)
  })

  test('idempotent replay: second call returns cached, no Telegram re-send, no duplicate rows', async () => {
    mockSendMessage.mockResolvedValueOnce({ message_id: 5555 })

    const input = {
      tenantId,
      threadId,
      text: 'replay test',
      idempotencyKey: `${TEST_PREFIX}:replay`,
      agentRunId,
      correlationId: crypto.randomUUID(),
    }

    const first = await sendMessage(deps, input)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.cached).toBe(false)

    const second = await sendMessage(deps, input)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.cached).toBe(true)
    expect(second.value.toolCallId).toBe(first.value.toolCallId)
    expect(second.value.messageId).toBe(first.value.messageId)
    expect(second.value.telegramMessageId).toBe(5555)

    expect(mockSendMessage).toHaveBeenCalledTimes(1)

    const toolCalls = await admin<{ id: string }[]>`
      SELECT id FROM tool_calls WHERE tenant_id = ${tenantId} AND mcp_server = 'comms'
    `
    expect(toolCalls).toHaveLength(1)

    const messages = await admin<{ id: string }[]>`
      SELECT id FROM messages WHERE tenant_id = ${tenantId}
    `
    expect(messages).toHaveLength(1)
  })

  test('tenant mismatch: bogus tenantId for real thread → error, no rows, no Telegram call', async () => {
    const bogusTenant = crypto.randomUUID()

    const result = await sendMessage(deps, {
      tenantId: bogusTenant,
      threadId,
      text: 'attack',
      idempotencyKey: `${TEST_PREFIX}:attack`,
      agentRunId,
      correlationId: crypto.randomUUID(),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('tenant_mismatch')

    expect(mockSendMessage).not.toHaveBeenCalled()

    const toolCalls = await admin<{ id: string }[]>`
      SELECT id FROM tool_calls WHERE tenant_id = ${tenantId} OR tenant_id = ${bogusTenant}
    `
    expect(toolCalls).toHaveLength(0)
  })

  test('thread not found: error, no Telegram call', async () => {
    const result = await sendMessage(deps, {
      tenantId,
      threadId: crypto.randomUUID(),
      text: 'whoops',
      idempotencyKey: `${TEST_PREFIX}:404`,
      agentRunId,
      correlationId: crypto.randomUUID(),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('thread_not_found')
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  test('Telegram 429: tool_call row persisted with status=error, no messages row', async () => {
    mockSendMessage.mockRejectedValueOnce({
      error_code: 429,
      description: 'Too Many Requests',
      parameters: { retry_after: 15 },
    })

    const result = await sendMessage(deps, {
      tenantId,
      threadId,
      text: 'rate limited',
      idempotencyKey: `${TEST_PREFIX}:429`,
      agentRunId,
      correlationId: crypto.randomUUID(),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('telegram_error')
    expect(result.error.telegramErrorKind).toBe('rate_limit')

    const toolCalls = await admin<{ status: string; error: string | null }[]>`
      SELECT status, error FROM tool_calls WHERE tenant_id = ${tenantId}
    `
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]?.status).toBe('error')
    expect(toolCalls[0]?.error).toContain('rate_limit')

    const messages = await admin<{ id: string }[]>`
      SELECT id FROM messages WHERE tenant_id = ${tenantId}
    `
    expect(messages).toHaveLength(0)
  })

  test('inline keyboard forwarded correctly to grammY', async () => {
    mockSendMessage.mockResolvedValueOnce({ message_id: 9999 })

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: 'Approve', callback_data: 'approval:x:approved' },
          { text: 'Reject', callback_data: 'approval:x:rejected' },
        ],
      ],
    }

    await sendMessage(deps, {
      tenantId,
      threadId,
      text: 'ready to proceed?',
      replyMarkup,
      idempotencyKey: `${TEST_PREFIX}:approval`,
      agentRunId,
      correlationId: crypto.randomUUID(),
    })

    expect(mockSendMessage).toHaveBeenCalledWith(
      Number.parseInt(TEST_CHAT_ID, 10),
      'ready to proceed?',
      { reply_markup: replyMarkup },
    )
  })
})
