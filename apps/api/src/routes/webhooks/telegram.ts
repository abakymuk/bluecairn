import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { TenantId, newTenantContext } from '@bluecairn/core'
import { createDatabase, withTenant, schema } from '@bluecairn/db'
import { extractInboundMessage, parseUpdate } from '@bluecairn/integrations/telegram'
import { env } from '../../env.js'
import { logger } from '../../lib/logger.js'

/**
 * Telegram webhook endpoint — receive, parse, persist.
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
 *   6. Return 200 within Telegram's 5s window. Outbound replies are out of
 *      scope for BLU-13 (Comms MCP, Month 1).
 *
 * See BLU-13, BLU-4, BLU-9, ADR-0009.
 */

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
    await withTenant(db, ctx, async (tx) => {
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
      await tx
        .insert(schema.messages)
        .values({
          tenantId: channel.tenantId,
          threadId: thread.id,
          authorKind: 'user',
          content: msg.text ?? '',
          externalMessageId: msg.externalMessageId,
          idempotencyKey: msg.idempotencyKey,
        })
        .onConflictDoNothing()

      await tx
        .update(schema.threads)
        .set({ lastMessageAt: msg.sentAt })
        .where(eq(schema.threads.id, thread.id))
    })

    logger.info('Telegram message persisted', {
      correlationId,
      tenantId: channel.tenantId,
      chatId: msg.chatId,
      idempotencyKey: msg.idempotencyKey,
    })
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
