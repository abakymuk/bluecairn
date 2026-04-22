import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { TenantId, newTenantContext } from '@bluecairn/core'
import { createDatabase, withTenant, schema } from '@bluecairn/db'
import {
  answerTelegramCallbackQuery,
  extractCallbackQuery,
  extractInboundMessage,
  parseApprovalCallbackData,
  parseUpdate,
  type CallbackQueryPayload,
} from '@bluecairn/integrations/telegram'
import { env } from '../../env.js'
import { inngest } from '../../inngest.js'
import { bot } from '../../lib/telegram-bot.js'
import { logger } from '../../lib/logger.js'

/**
 * Telegram webhook endpoint — receive, parse, persist, emit.
 *
 * Flow:
 *   1. Verify the secret token header (rejects spoofed calls).
 *   2. Parse the JSON body as a Telegram Update.
 *   3. Extract an inbound text message (ignore unsupported update types).
 *   4. Look up the `channels` row by Telegram chat_id → tenant_id.
 *      Unknown chat_id → log + 200 (don't leak tenant existence, don't have
 *      Telegram retry).
 *   5. Within `withTenant(ctx)` (sets RLS session var), find-or-create a
 *      thread on this channel and insert the message (idempotent on
 *      `tenant_id + idempotency_key = tg:<chat_id>:<message_id>`).
 *   6. If the insert actually produced a new row AND `ORCHESTRATOR_ENABLED`
 *      is true (BLU-19), emit `thread.message.received` to Inngest so the
 *      orchestrator can route it. Bounded by a 2s timeout so we never push
 *      the webhook past Telegram's 5s budget. Emit failure is logged but
 *      does not fail the webhook — the message is persisted regardless.
 *   7. Return 200 within Telegram's 5s window.
 *
 * See BLU-13, BLU-19, ADR-0004, ADR-0009.
 */

const EMIT_TIMEOUT_MS = 2000
const ANSWER_CALLBACK_TIMEOUT_MS = 2000

/**
 * Admin pool: used at the webhook boundary for channel → tenant resolution
 * (the lookup that happens BEFORE tenant context is known). `bluecairn_admin`
 * is the table owner and bypasses RLS, which is the correct posture for
 * system-context work like webhook routing.
 */
const db = createDatabase(env.DATABASE_URL_ADMIN)

export const telegramWebhook = new Hono()

telegramWebhook.post('/', async (c) => {
  const correlationId = crypto.randomUUID()

  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token')
  if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    logger.warn('Telegram webhook rejected: bad secret token', { correlationId })
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    logger.warn('Telegram webhook rejected: invalid JSON', { correlationId })
    return c.json({ ok: false, error: 'invalid json' }, 400)
  }

  let update
  try {
    update = parseUpdate(body)
  } catch (err) {
    logger.warn('Telegram webhook rejected: malformed update', {
      correlationId,
      error: err instanceof Error ? err.message : String(err),
    })
    return c.json({ ok: false, error: 'invalid update' }, 400)
  }

  const msg = extractInboundMessage(update)
  if (!msg) {
    const callback = extractCallbackQuery(update)
    if (callback) {
      await handleCallbackQuery(callback, correlationId)
      return c.json({ ok: true })
    }

    logger.info('Telegram update ignored (unsupported type)', {
      correlationId,
      updateId: update.update_id,
    })
    return c.json({ ok: true })
  }

  const [channel] = await db
    .select({ id: schema.channels.id, tenantId: schema.channels.tenantId })
    .from(schema.channels)
    .where(and(eq(schema.channels.externalId, msg.chatId), eq(schema.channels.kind, 'telegram')))
    .limit(1)

  if (!channel) {
    logger.warn('Telegram webhook: unknown chat_id, no tenant match', {
      correlationId,
      chatId: msg.chatId,
      externalMessageId: msg.externalMessageId,
    })
    return c.json({ ok: true })
  }

  const ctx = newTenantContext({
    tenantId: TenantId(channel.tenantId),
    correlationId,
  })

  try {
    const { threadId, messageId } = await withTenant(db, ctx, async (tx) => {
      let [thread] = await tx
        .select({ id: schema.threads.id })
        .from(schema.threads)
        .where(eq(schema.threads.channelId, channel.id))
        .limit(1)

      if (!thread) {
        ;[thread] = await tx
          .insert(schema.threads)
          .values({
            tenantId: channel.tenantId,
            channelId: channel.id,
            kind: 'owner_primary',
          })
          .returning({ id: schema.threads.id })
      }

      if (!thread) {
        throw new Error('failed to obtain thread id after upsert')
      }

      // `idx_messages_idempotency` is a partial unique index
      // (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL — the
      // targetless form of ON CONFLICT lets Postgres pick any applicable
      // unique constraint at runtime. Specifying the target explicitly is
      // incompatible with partial indexes.
      //
      // `.returning({ id })` combined with `.onConflictDoNothing()` returns
      // an empty array on conflict, letting us skip the Inngest emit for
      // duplicate deliveries (BLU-19 idempotency acceptance criterion).
      const inserted = await tx
        .insert(schema.messages)
        .values({
          tenantId: channel.tenantId,
          threadId: thread.id,
          authorKind: 'user',
          direction: 'inbound',
          content: msg.text ?? '',
          externalMessageId: msg.externalMessageId,
          idempotencyKey: msg.idempotencyKey,
        })
        .onConflictDoNothing()
        .returning({ id: schema.messages.id })

      await tx
        .update(schema.threads)
        .set({ lastMessageAt: msg.sentAt })
        .where(eq(schema.threads.id, thread.id))

      return { threadId: thread.id, messageId: inserted[0]?.id ?? null }
    })

    logger.info('Telegram message persisted', {
      correlationId,
      tenantId: channel.tenantId,
      chatId: msg.chatId,
      idempotencyKey: msg.idempotencyKey,
      duplicate: messageId === null,
    })

    if (env.ORCHESTRATOR_ENABLED && messageId !== null) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          inngest.send({
            name: 'thread.message.received',
            // Inngest dedupes at ingestion when `id` repeats — re-delivery
            // of the same Telegram update produces one orchestrator run,
            // belt-and-suspenders with our messages.idempotency_key check
            // on the persist side (BLU-22 AC).
            id: `event:${msg.idempotencyKey}`,
            data: {
              tenant_id: channel.tenantId,
              correlation_id: correlationId,
              idempotency_key: msg.idempotencyKey,
              thread_id: threadId,
              message_id: messageId,
              channel_id: channel.id,
            },
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`inngest emit timeout after ${EMIT_TIMEOUT_MS}ms`)),
              EMIT_TIMEOUT_MS,
            )
          }),
        ])
        logger.info('thread.message.received emitted', {
          correlationId,
          tenantId: channel.tenantId,
          messageId,
        })
      } catch (err) {
        // Persist already succeeded; the event can be replayed manually from
        // Inngest dashboard or a dead-letter handler. Never fail the webhook.
        logger.error('Inngest emit failed', {
          correlationId,
          tenantId: channel.tenantId,
          messageId,
          error: err instanceof Error ? err.message : String(err),
        })
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }
  } catch (err) {
    logger.error('Telegram message persistence failed', {
      correlationId,
      tenantId: channel.tenantId,
      chatId: msg.chatId,
      error: err instanceof Error ? err.message : String(err),
    })
    // Still 200 so Telegram doesn't spin-retry; error is in our logs.
    return c.json({ ok: true })
  }

  return c.json({ ok: true })
})

/**
 * BLU-24 — handle an inline-button `callback_query` update.
 *
 * Flow:
 *   1. Fire `answerCallbackQuery` first so the spinner dismisses regardless
 *      of downstream outcome (2s race; error logged, never thrown).
 *   2. Resolve the originating chat → channel → tenant. Unknown chat_id
 *      writes a platform-global `audit_log` row (tenant_id=null) for later
 *      spam-detection in ops-web, no event emit.
 *   3. Validate `callback_data` shape via `parseApprovalCallbackData`.
 *      Malformed data writes a tenant-scoped `audit_log` row
 *      (event_kind='callback.malformed'), no event emit.
 *   4. Valid data → emit `approval.decision.recorded` into Inngest with
 *      `id: callback:<callback_query_id>` so re-delivery of the same tap
 *      dedups at ingestion (belt-and-suspenders with Telegram's own
 *      at-least-once semantics).
 *
 * We intentionally do NOT check `approval_requests.id` existence here.
 * Semantic validation belongs to BLU-25's `action.gate`; the webhook stays
 * thin so we never blow Telegram's 5s budget on extra DB round-trips.
 */
async function handleCallbackQuery(
  callback: CallbackQueryPayload,
  correlationId: string,
): Promise<void> {
  // 1. Dismiss the button spinner regardless of downstream outcome. If the
  // Telegram call fails or exceeds the budget we still continue — spinner
  // state is cosmetic and our own decision path must not block on it.
  let answerTimer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      answerTelegramCallbackQuery(bot, callback.callbackQueryId),
      new Promise<never>((_, reject) => {
        answerTimer = setTimeout(
          () =>
            reject(new Error(`answerCallbackQuery timeout after ${ANSWER_CALLBACK_TIMEOUT_MS}ms`)),
          ANSWER_CALLBACK_TIMEOUT_MS,
        )
      }),
    ])
  } catch (err) {
    logger.error('answerCallbackQuery failed', {
      correlationId,
      callbackQueryId: callback.callbackQueryId,
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    if (answerTimer !== undefined) clearTimeout(answerTimer)
  }

  // 2. Channel → tenant.
  const [channel] = await db
    .select({ id: schema.channels.id, tenantId: schema.channels.tenantId })
    .from(schema.channels)
    .where(and(eq(schema.channels.externalId, callback.chatId), eq(schema.channels.kind, 'telegram')))
    .limit(1)

  if (!channel) {
    logger.warn('Telegram callback_query: unknown chat_id', {
      correlationId,
      chatId: callback.chatId,
      callbackQueryId: callback.callbackQueryId,
    })
    await writeCallbackAudit({
      tenantId: null,
      eventKind: 'callback.unknown_chat',
      eventSummary: `unknown chat_id ${callback.chatId}`,
      payload: {
        callback_query_id: callback.callbackQueryId,
        chat_id: callback.chatId,
        data: callback.data,
        correlation_id: correlationId,
      },
    })
    return
  }

  // 3. Data-shape validation.
  const parsed = parseApprovalCallbackData(callback.data)
  if (!parsed) {
    logger.warn('Telegram callback_query: malformed data', {
      correlationId,
      tenantId: channel.tenantId,
      callbackQueryId: callback.callbackQueryId,
      data: callback.data,
    })
    await writeCallbackAudit({
      tenantId: channel.tenantId,
      eventKind: 'callback.malformed',
      eventSummary: `malformed callback_data: ${callback.data.slice(0, 64)}`,
      payload: {
        callback_query_id: callback.callbackQueryId,
        chat_id: callback.chatId,
        data: callback.data,
        correlation_id: correlationId,
      },
    })
    return
  }

  // 4. Emit the decision event.
  const idempotencyKey = `tg:callback:${callback.callbackQueryId}`
  let emitTimer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      inngest.send({
        name: 'approval.decision.recorded',
        // Inngest dedupes at ingestion when `id` repeats — duplicate Telegram
        // re-delivery of the same tap collapses to one `action.gate` resume.
        id: `event:${idempotencyKey}`,
        data: {
          tenant_id: channel.tenantId,
          correlation_id: correlationId,
          idempotency_key: idempotencyKey,
          approval_request_id: parsed.approvalRequestId,
          decision: parsed.decision,
          user_telegram_id: callback.fromTelegramUserId,
        },
      }),
      new Promise<never>((_, reject) => {
        emitTimer = setTimeout(
          () => reject(new Error(`inngest emit timeout after ${EMIT_TIMEOUT_MS}ms`)),
          EMIT_TIMEOUT_MS,
        )
      }),
    ])
    logger.info('approval.decision.recorded emitted', {
      correlationId,
      tenantId: channel.tenantId,
      approvalRequestId: parsed.approvalRequestId,
      decision: parsed.decision,
    })
  } catch (err) {
    // Log only — the user already sees the button dismissed; re-delivery by
    // Telegram or manual replay from Inngest dashboard is the recovery path.
    logger.error('Inngest emit failed (approval.decision.recorded)', {
      correlationId,
      tenantId: channel.tenantId,
      approvalRequestId: parsed.approvalRequestId,
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    if (emitTimer !== undefined) clearTimeout(emitTimer)
  }
}

/**
 * Best-effort audit write for callback handling failures. Never throws —
 * audit is an observability surface, not a correctness requirement, and we
 * must still 200 Telegram regardless of its success.
 */
async function writeCallbackAudit(args: {
  tenantId: string | null
  eventKind: 'callback.malformed' | 'callback.unknown_chat'
  eventSummary: string
  payload: Record<string, unknown>
}): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      tenantId: args.tenantId,
      eventKind: args.eventKind,
      eventSummary: args.eventSummary,
      eventPayload: args.payload,
    })
  } catch (err) {
    logger.error('audit_log insert failed', {
      eventKind: args.eventKind,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
