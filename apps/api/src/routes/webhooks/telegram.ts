import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { TenantId, newTenantContext } from '@bluecairn/core'
import { createDatabase, withTenant, schema } from '@bluecairn/db'
import { extractInboundMessage, parseUpdate } from '@bluecairn/integrations/telegram'
import { env } from '../../env.js'
import { inngest } from '../../inngest.js'
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
