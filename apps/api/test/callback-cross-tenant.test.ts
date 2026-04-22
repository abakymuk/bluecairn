import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import postgres from 'postgres'

/**
 * BLU-28 — Layer 1 (Telegram webhook) adversarial tests for the
 * `callback_query` branch.
 *
 * The BLU-24 webhook is deliberately thin: it parses the callback, resolves
 * the tenant from the chat_id, and emits `approval.decision.recorded`
 * without checking that the embedded `approval_request_id` actually
 * belongs to the resolving tenant. Semantic validation is BLU-25
 * (action.gate) territory. These tests lock in that contract:
 *
 *   - Smuggled approval_request_id (tenant A's UUID arriving in tenant B's
 *     chat): webhook still emits `approval.decision.recorded` but with
 *     `tenant_id = B` from the channel lookup. action.gate will then
 *     reject via the BLU-28 `rejected_mismatch` outcome (tested in
 *     apps/workers/test/functions/action-gate-cross-tenant.test.ts).
 *
 *   - callback.emitted audit rows carry the correct tenant so ops-web
 *     forensics can filter by tenant.
 *
 *   - Malformed / unknown-chat audit asymmetry: success now also writes an
 *     audit row per BLU-28, closing the observability gap.
 *
 * Run via: doppler run --config dev -- bun run --cwd apps/api test
 */

const { mockInngestSend, mockAnswerCallbackQuery, mockSendMessage } = vi.hoisted(() => ({
  mockInngestSend: vi.fn().mockResolvedValue(undefined),
  mockAnswerCallbackQuery: vi.fn().mockResolvedValue(true),
  mockSendMessage: vi.fn(),
}))

vi.mock('../src/inngest.js', () => ({
  inngest: { send: mockInngestSend },
}))

vi.mock('../src/lib/telegram-bot.js', () => ({
  bot: {
    api: {
      answerCallbackQuery: mockAnswerCallbackQuery,
      sendMessage: mockSendMessage,
    },
  },
}))

const { app } = await import('../src/index.js')

const adminUrl = process.env.DATABASE_URL_ADMIN
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
if (!adminUrl || !webhookSecret) {
  throw new Error('DATABASE_URL_ADMIN and TELEGRAM_WEBHOOK_SECRET required')
}

const admin = postgres(adminUrl, { max: 1, prepare: false })
const TEST_PREFIX = `blu28-cb-${crypto.randomUUID().slice(0, 8)}`
const CHAT_A = `-100${Math.floor(Math.random() * 1e10)}`
const CHAT_B = `-100${Math.floor(Math.random() * 1e10)}`

let tenantAId: string
let tenantBId: string

// Two tenants + two channels, one chat id per tenant. The "smuggle" attack
// crafts a callback_query from CHAT_B carrying TENANT_A's approval id.
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

  await admin`
    INSERT INTO channels (tenant_id, kind, external_id, is_primary, active)
    VALUES (${tenantAId}, 'telegram', ${CHAT_A}, true, true)
  `
  await admin`
    INSERT INTO channels (tenant_id, kind, external_id, is_primary, active)
    VALUES (${tenantBId}, 'telegram', ${CHAT_B}, true, true)
  `
})

afterAll(async () => {
  // audit_log is append-only (trigger) and the `action_id` FK has no
  // cascade, but for this suite we never inserted actions — all our
  // audit rows are orphan callback events. Tenant cascade can proceed
  // cleanly for channels. audit rows linger but are scoped by TEST_PREFIX
  // so they don't collide with subsequent runs.
  await admin`DELETE FROM tenants WHERE slug LIKE ${`${TEST_PREFIX}%`}`
  await admin.end()
})

beforeEach(() => {
  mockInngestSend.mockClear()
  mockAnswerCallbackQuery.mockClear()
  mockAnswerCallbackQuery.mockResolvedValue(true)
  mockSendMessage.mockClear()
})

const postWebhook = (body: unknown) => {
  return app.fetch(
    new Request('http://localhost/webhooks/telegram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': webhookSecret!,
      },
      body: JSON.stringify(body),
    }),
  )
}

const callbackUpdate = (args: {
  callbackQueryId: string
  chatId: string
  data: string
  fromId?: number
}) => ({
  update_id: Math.floor(Math.random() * 1e9),
  callback_query: {
    id: args.callbackQueryId,
    data: args.data,
    from: { id: args.fromId ?? 99_999, first_name: 'Attacker' },
    message: {
      message_id: Math.floor(Math.random() * 1e9),
      date: Math.floor(Date.now() / 1000),
      chat: { id: parseInt(args.chatId, 10) },
    },
    chat_instance: 'ci-smuggle',
  },
})

describe('BLU-28: callback_query cross-tenant adversarial', () => {
  test('smuggled approval_request_id from tenant-A lands in tenant-B chat → emit carries tenant_B (webhook is thin)', async () => {
    // Tenant-A's approval_request_id (fake UUID — we don't need the row to
    // exist; webhook doesn't validate existence by design). Sent through
    // tenant-B's chat. Webhook resolves tenant from chat_id, so tenant_id
    // in the emitted event MUST be B. action.gate is then responsible for
    // refusing the cross-tenant decision (covered by
    // apps/workers/test/functions/action-gate-cross-tenant.test.ts).
    const aApprovalId = '11111111-2222-3333-4444-000000000AAA'.toLowerCase()
    const callbackQueryId = `cb-smuggle-${crypto.randomUUID().slice(0, 8)}`
    const res = await postWebhook(
      callbackUpdate({
        callbackQueryId,
        chatId: CHAT_B,
        data: `approval:${aApprovalId}:approved`,
        fromId: 77_777,
      }),
    )
    expect(res.status).toBe(200)

    // Exactly one emit; tenant is B (from channel), approval_request_id is A's
    expect(mockInngestSend).toHaveBeenCalledTimes(1)
    expect(mockInngestSend).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'approval.decision.recorded',
        data: expect.objectContaining({
          tenant_id: tenantBId,
          approval_request_id: aApprovalId,
          decision: 'approved',
          user_telegram_id: 77_777,
        }),
      }),
    )

    // BLU-28: a callback.emitted audit row exists under tenant B so ops-web
    // can spot cross-tenant smuggling attempts later (action.gate would
    // also write approval.decision.tenant_mismatch when it actually
    // attempts to resolve).
    const audits = await admin<
      { tenant_id: string | null; event_kind: string; event_payload: unknown }[]
    >`
      SELECT tenant_id, event_kind, event_payload
      FROM   audit_log
      WHERE  event_payload->>'callback_query_id' = ${callbackQueryId}
    `
    expect(audits).toHaveLength(1)
    expect(audits[0]?.tenant_id).toBe(tenantBId)
    expect(audits[0]?.event_kind).toBe('callback.emitted')
    expect(audits[0]?.event_payload).toMatchObject({
      approval_request_id: aApprovalId,
      decision: 'approved',
    })
  })

  test('malformed callback_data from tenant A → audit under tenant A, no emit', async () => {
    const callbackQueryId = `cb-bad-a-${crypto.randomUUID().slice(0, 8)}`
    const res = await postWebhook(
      callbackUpdate({
        callbackQueryId,
        chatId: CHAT_A,
        data: 'definitely-not-an-approval-string',
      }),
    )
    expect(res.status).toBe(200)
    expect(mockInngestSend).not.toHaveBeenCalled()

    const [audit] = await admin<
      { tenant_id: string | null; event_kind: string }[]
    >`
      SELECT tenant_id, event_kind FROM audit_log
      WHERE event_payload->>'callback_query_id' = ${callbackQueryId}
    `
    expect(audit?.tenant_id).toBe(tenantAId)
    expect(audit?.event_kind).toBe('callback.malformed')
  })

  test('unknown chat_id (tenant not provisioned) with valid-looking data → audit with tenant_id=NULL, no emit', async () => {
    const strangerChat = `-100${Math.floor(Math.random() * 1e10)}`
    const callbackQueryId = `cb-stranger-${crypto.randomUUID().slice(0, 8)}`
    const res = await postWebhook(
      callbackUpdate({
        callbackQueryId,
        chatId: strangerChat,
        data: 'approval:11111111-2222-3333-4444-555555555555:approved',
      }),
    )
    expect(res.status).toBe(200)
    expect(mockInngestSend).not.toHaveBeenCalled()

    const [audit] = await admin<
      { tenant_id: string | null; event_kind: string }[]
    >`
      SELECT tenant_id, event_kind FROM audit_log
      WHERE event_payload->>'callback_query_id' = ${callbackQueryId}
    `
    expect(audit?.tenant_id).toBeNull()
    expect(audit?.event_kind).toBe('callback.unknown_chat')
  })
})
