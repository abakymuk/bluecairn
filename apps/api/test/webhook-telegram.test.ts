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
const { mockInngestSend } = vi.hoisted(() => ({
  mockInngestSend: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../src/inngest.js', () => ({
  inngest: { send: mockInngestSend },
}))

// Import after vi.mock so the webhook's `inngest` resolves to the stub.
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
  await admin`DELETE FROM tenants WHERE slug LIKE ${`${TEST_PREFIX}%`}`
  await admin.end()
})

beforeEach(() => {
  mockInngestSend.mockClear()
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

  test('unsupported update type (no message) → 200, no persistence', async () => {
    const res = await postWebhook({
      update_id: Math.floor(Math.random() * 1e9),
      callback_query: {
        id: 'cb1',
        from: { id: 1, first_name: 'X' },
        data: 'click',
        chat_instance: 'x',
      },
    })
    expect(res.status).toBe(200)
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
