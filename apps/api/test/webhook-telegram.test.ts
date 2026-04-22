import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import postgres from 'postgres'

/**
 * Integration test for the Telegram webhook handler (BLU-13, extended for
 * BLU-19 orchestrator event emit).
 *
 * Flow:
 *   - admin conn (DATABASE_URL_ADMIN, bypasses RLS as table owner) seeds a
 *     test tenant + Telegram channel with a unique chat_id.
 *   - test posts mock Telegram Update payloads into the Hono app via
 *     `app.fetch(new Request(...))` — no HTTP server boot needed.
 *   - admin conn verifies the resulting DB state; mocked `inngest.send`
 *     verifies event emission semantics (BLU-19).
 *
 * Requires env: DATABASE_URL, DATABASE_URL_ADMIN, TELEGRAM_WEBHOOK_SECRET.
 * Run via: doppler run --config dev -- bun run --cwd apps/api test
 */

// Stub the Inngest client so we can assert on emits without hitting the wire.
const { mockInngestSend, mockAnswerCallbackQuery, mockSendMessage } = vi.hoisted(() => ({
  mockInngestSend: vi.fn().mockResolvedValue(undefined),
  mockAnswerCallbackQuery: vi.fn().mockResolvedValue(true),
  mockSendMessage: vi.fn(),
}))

vi.mock('../src/inngest.js', () => ({
  inngest: { send: mockInngestSend },
}))

// BLU-24: stub the singleton grammY Bot so `answerCallbackQuery` never hits
// Telegram. The webhook only uses `bot.api.answerCallbackQuery`; the
// `sendMessage` stub is defensive in case a future refactor starts routing
// outbound sends through this singleton.
vi.mock('../src/lib/telegram-bot.js', () => ({
  bot: {
    api: {
      answerCallbackQuery: mockAnswerCallbackQuery,
      sendMessage: mockSendMessage,
    },
  },
}))

// Import after vi.mock so the webhook's `inngest` + `bot` resolve to the stubs.
const { app } = await import('../src/index.js')

const adminUrl = process.env.DATABASE_URL_ADMIN
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
if (!adminUrl || !webhookSecret) {
  throw new Error('DATABASE_URL_ADMIN and TELEGRAM_WEBHOOK_SECRET required')
}

const admin = postgres(adminUrl, { max: 1, prepare: false })
const TEST_PREFIX = `blu13-test-${crypto.randomUUID().slice(0, 8)}`
const TEST_CHAT_ID = `-100${Math.floor(Math.random() * 1e10)}`

let tenantId: string
let channelId: string

beforeAll(async () => {
  const [t] = await admin<{ id: string }[]>`
    INSERT INTO tenants (slug, legal_name, display_name)
    VALUES (${`${TEST_PREFIX}-a`}, 'BLU-13 Test LLC', 'BLU-13 Test')
    RETURNING id
  `
  if (!t) throw new Error('fixture: tenant insert returned no rows')
  tenantId = t.id

  const [c] = await admin<{ id: string }[]>`
    INSERT INTO channels (tenant_id, kind, external_id, is_primary, active)
    VALUES (${tenantId}, 'telegram', ${TEST_CHAT_ID}, true, true)
    RETURNING id
  `
  if (!c) throw new Error('fixture: channel insert returned no rows')
  channelId = c.id
})

afterAll(async () => {
  // audit_log is append-only by trigger (ARCHITECTURE.md principle #9,
  // migrations-manual/0003_audit_triggers.sql) — we cannot DELETE the BLU-24
  // callback.* rows this run produced. Tests scope assertions by per-run
  // unique callback_query_id so leaked rows do not collide across runs. Dev
  // DBs grow these rows slowly; a Neon branch reset is the periodic cleanup.
  await admin`DELETE FROM tenants WHERE slug LIKE ${`${TEST_PREFIX}%`}`
  await admin.end()
})

beforeEach(() => {
  mockInngestSend.mockClear()
  mockAnswerCallbackQuery.mockClear()
  mockAnswerCallbackQuery.mockResolvedValue(true)
  mockSendMessage.mockClear()
})

/**
 * Build a minimal Telegram Update with a text message.
 * message_id must be unique per test to exercise idempotency key handling.
 */
const mockMessageUpdate = (opts: { messageId: number; text: string; chatId?: string }) => ({
  update_id: Math.floor(Math.random() * 1e9),
  message: {
    message_id: opts.messageId,
    date: Math.floor(Date.now() / 1000),
    chat: { id: parseInt(opts.chatId ?? TEST_CHAT_ID, 10) },
    from: { id: 99999, first_name: 'Vlad', username: 'vlad_test' },
    text: opts.text,
  },
})

const postWebhook = (body: unknown, secret: string | null = webhookSecret) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (secret !== null) headers['X-Telegram-Bot-Api-Secret-Token'] = secret
  return app.fetch(
    new Request('http://localhost/webhooks/telegram', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

/**
 * Build a minimal Telegram `callback_query` update. Unique `callback_query_id`
 * per test to exercise Inngest event.id dedup (BLU-24).
 */
const mockCallbackUpdate = (opts: {
  callbackQueryId: string
  data: string
  chatId?: string
  fromId?: number
  messageId?: number
}) => ({
  update_id: Math.floor(Math.random() * 1e9),
  callback_query: {
    id: opts.callbackQueryId,
    data: opts.data,
    from: { id: opts.fromId ?? 99_999, first_name: 'Vlad' },
    message: {
      message_id: opts.messageId ?? 1001,
      date: Math.floor(Date.now() / 1000),
      chat: { id: parseInt(opts.chatId ?? TEST_CHAT_ID, 10) },
    },
    chat_instance: 'ci-test',
  },
})

describe('Telegram webhook', () => {
  test('persists inbound text message for a known channel + emits event (BLU-19)', async () => {
    const messageId = Math.floor(Math.random() * 1e9)
    const res = await postWebhook(
      mockMessageUpdate({ messageId, text: 'hello from integration test' }),
    )
    expect(res.status).toBe(200)

    const rows = await admin<
      {
        id: string
        content: string
        idempotency_key: string
        external_message_id: string
        direction: string
        tool_call_id: string | null
      }[]
    >`
      SELECT id, content, idempotency_key, external_message_id, direction, tool_call_id
      FROM   messages
      WHERE  tenant_id = ${tenantId}
        AND  external_message_id = ${String(messageId)}
    `
    expect(rows).toHaveLength(1)
    expect(rows[0]?.content).toBe('hello from integration test')
    expect(rows[0]?.idempotency_key).toBe(`tg:${TEST_CHAT_ID}:${messageId}`)
    // BLU-32: explicit direction + tool_call_id null for inbound user messages
    expect(rows[0]?.direction).toBe('inbound')
    expect(rows[0]?.tool_call_id).toBeNull()

    // Thread was created and linked to the channel
    const threads = await admin<{ id: string }[]>`
      SELECT id FROM threads WHERE channel_id = ${channelId}
    `
    expect(threads).toHaveLength(1)

    // BLU-19: exactly one thread.message.received event emitted, carrying
    // the canonical payload the orchestrator expects.
    // BLU-22: event now has explicit `id` for Inngest-side dedup.
    expect(mockInngestSend).toHaveBeenCalledTimes(1)
    expect(mockInngestSend).toHaveBeenCalledWith({
      name: 'thread.message.received',
      id: `event:tg:${TEST_CHAT_ID}:${messageId}`,
      data: expect.objectContaining({
        tenant_id: tenantId,
        thread_id: threads[0]?.id,
        message_id: rows[0]?.id,
        channel_id: channelId,
        idempotency_key: `tg:${TEST_CHAT_ID}:${messageId}`,
        correlation_id: expect.any(String),
      }),
    })
  })

  test('duplicate update with same message_id is idempotent + zero extra emits (BLU-19)', async () => {
    const messageId = Math.floor(Math.random() * 1e9)
    const payload = mockMessageUpdate({ messageId, text: 'duplicate attempt' })

    const res1 = await postWebhook(payload)
    expect(res1.status).toBe(200)
    const res2 = await postWebhook(payload)
    expect(res2.status).toBe(200)

    const rows = await admin<{ id: string }[]>`
      SELECT id FROM messages
      WHERE  tenant_id = ${tenantId} AND external_message_id = ${String(messageId)}
    `
    expect(rows).toHaveLength(1)

    // First delivery emits; second (conflict) must NOT re-emit. So exactly 1
    // send across the two requests. BLU-19 idempotency acceptance criterion.
    expect(mockInngestSend).toHaveBeenCalledTimes(1)
  })

  test('unknown chat_id: 200 + no persistence + no emit', async () => {
    const strangerChatId = '-999888777'
    const messageId = Math.floor(Math.random() * 1e9)
    const res = await postWebhook(
      mockMessageUpdate({ messageId, text: 'stranger', chatId: strangerChatId }),
    )
    expect(res.status).toBe(200)

    const rows = await admin<{ id: string }[]>`
      SELECT m.id FROM messages m
      JOIN   channels c ON c.id = (
        SELECT id FROM channels WHERE external_id = ${strangerChatId}
      )
      WHERE  m.external_message_id = ${String(messageId)}
    `
    expect(rows).toHaveLength(0)
    expect(mockInngestSend).not.toHaveBeenCalled()
  })

  test('missing secret header → 401', async () => {
    const res = await postWebhook(mockMessageUpdate({ messageId: 1, text: 'no auth' }), null)
    expect(res.status).toBe(401)
  })

  test('wrong secret header → 401', async () => {
    const res = await postWebhook(
      mockMessageUpdate({ messageId: 2, text: 'bad auth' }),
      'wrong-secret',
    )
    expect(res.status).toBe(401)
  })

  test('unsupported update type (callback_query without message) → 200, no emit, no audit', async () => {
    const res = await postWebhook({
      update_id: Math.floor(Math.random() * 1e9),
      callback_query: {
        id: 'cb-no-msg',
        from: { id: 1, first_name: 'X' },
        data: 'click',
        chat_instance: 'x',
      },
    })
    expect(res.status).toBe(200)
    expect(mockInngestSend).not.toHaveBeenCalled()
    expect(mockAnswerCallbackQuery).not.toHaveBeenCalled()

    const audits = await admin<{ id: string }[]>`
      SELECT id FROM audit_log WHERE event_payload->>'callback_query_id' = 'cb-no-msg'
    `
    expect(audits).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // BLU-24: callback_query webhook branch
  // ---------------------------------------------------------------------------

  test('valid approval callback → answerCallbackQuery + emit approval.decision.recorded + callback.emitted audit (BLU-28)', async () => {
    const approvalRequestId = '11111111-2222-3333-4444-555555555555'
    const callbackQueryId = `cb-${crypto.randomUUID().slice(0, 8)}`
    const update = mockCallbackUpdate({
      callbackQueryId,
      data: `approval:${approvalRequestId}:approved`,
    })

    const res = await postWebhook(update)
    expect(res.status).toBe(200)

    expect(mockAnswerCallbackQuery).toHaveBeenCalledTimes(1)
    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith(callbackQueryId)

    expect(mockInngestSend).toHaveBeenCalledTimes(1)
    expect(mockInngestSend).toHaveBeenCalledWith({
      name: 'approval.decision.recorded',
      id: `event:tg:callback:${callbackQueryId}`,
      data: expect.objectContaining({
        tenant_id: tenantId,
        approval_request_id: approvalRequestId,
        decision: 'approved',
        user_telegram_id: 99_999,
        idempotency_key: `tg:callback:${callbackQueryId}`,
        correlation_id: expect.any(String),
      }),
    })

    // BLU-28: successful callback now also writes a callback.emitted audit
    // row under the channel's tenant. Closes the observability asymmetry
    // where only failures (malformed, unknown_chat) were audited.
    const audits = await admin<
      { id: string; tenant_id: string | null; event_kind: string; event_payload: unknown }[]
    >`
      SELECT id, tenant_id, event_kind, event_payload
      FROM   audit_log
      WHERE  event_payload->>'callback_query_id' = ${callbackQueryId}
    `
    expect(audits).toHaveLength(1)
    expect(audits[0]?.tenant_id).toBe(tenantId)
    expect(audits[0]?.event_kind).toBe('callback.emitted')
    expect(audits[0]?.event_payload).toMatchObject({
      callback_query_id: callbackQueryId,
      approval_request_id: approvalRequestId,
      decision: 'approved',
      user_telegram_id: 99_999,
    })
  })

  test('malformed callback data → audit (tenant-scoped), no emit, spinner still dismissed', async () => {
    const callbackQueryId = `cb-bad-${crypto.randomUUID().slice(0, 8)}`
    const update = mockCallbackUpdate({
      callbackQueryId,
      data: 'approval:not-a-uuid:maybe',
    })

    const res = await postWebhook(update)
    expect(res.status).toBe(200)

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith(callbackQueryId)
    expect(mockInngestSend).not.toHaveBeenCalled()

    const audits = await admin<
      { id: string; tenant_id: string | null; event_kind: string; event_payload: unknown }[]
    >`
      SELECT id, tenant_id, event_kind, event_payload
      FROM   audit_log
      WHERE  event_payload->>'callback_query_id' = ${callbackQueryId}
    `
    expect(audits).toHaveLength(1)
    expect(audits[0]?.tenant_id).toBe(tenantId)
    expect(audits[0]?.event_kind).toBe('callback.malformed')
    expect(audits[0]?.event_payload).toMatchObject({
      callback_query_id: callbackQueryId,
      data: 'approval:not-a-uuid:maybe',
      chat_id: TEST_CHAT_ID,
    })
  })

  test('unknown chat_id callback → audit (tenant_id=null), no emit', async () => {
    const strangerChatId = '-777111333'
    const callbackQueryId = `cb-stranger-${crypto.randomUUID().slice(0, 8)}`
    const update = mockCallbackUpdate({
      callbackQueryId,
      data: `approval:11111111-2222-3333-4444-555555555555:rejected`,
      chatId: strangerChatId,
    })

    const res = await postWebhook(update)
    expect(res.status).toBe(200)

    // Spinner still gets dismissed — we answer before resolving the channel.
    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith(callbackQueryId)
    expect(mockInngestSend).not.toHaveBeenCalled()

    const audits = await admin<
      { id: string; tenant_id: string | null; event_kind: string }[]
    >`
      SELECT id, tenant_id, event_kind
      FROM   audit_log
      WHERE  event_payload->>'callback_query_id' = ${callbackQueryId}
    `
    expect(audits).toHaveLength(1)
    expect(audits[0]?.tenant_id).toBeNull()
    expect(audits[0]?.event_kind).toBe('callback.unknown_chat')
  })

  test('duplicate callback delivery: app emits both times with same id (Inngest dedups at ingestion)', async () => {
    const approvalRequestId = '11111111-2222-3333-4444-555555555555'
    const callbackQueryId = `cb-dup-${crypto.randomUUID().slice(0, 8)}`
    const payload = mockCallbackUpdate({
      callbackQueryId,
      data: `approval:${approvalRequestId}:approved`,
    })

    const res1 = await postWebhook(payload)
    const res2 = await postWebhook(payload)
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)

    // Both requests emit — we rely on Inngest `event.id` ingestion dedup
    // rather than an app-layer cache. This mirrors the BLU-19 posture of
    // trusting the durability layer to collapse retries.
    expect(mockInngestSend).toHaveBeenCalledTimes(2)
    const calls = mockInngestSend.mock.calls
    expect(calls[0]?.[0]?.id).toBe(`event:tg:callback:${callbackQueryId}`)
    expect(calls[1]?.[0]?.id).toBe(`event:tg:callback:${callbackQueryId}`)
  })

  test('invalid JSON body → 400', async () => {
    const res = await app.fetch(
      new Request('http://localhost/webhooks/telegram', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': webhookSecret!,
        },
        body: 'not-json-{',
      }),
    )
    expect(res.status).toBe(400)
  })
})
