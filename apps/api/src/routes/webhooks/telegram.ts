import { Hono } from 'hono'
import { env } from '../../env.js'
import { logger } from '../../lib/logger.js'

/**
 * Telegram webhook endpoint. Real implementation lands in BLU-13.
 *
 * For now this is a thin stub that:
 * - Verifies the secret token header (per Telegram docs)
 * - Logs the update body (without persisting)
 * - Returns 200 within Telegram's 5s budget
 *
 * Full impl (BLU-13):
 * - Parse via grammY adapter in `packages/integrations/telegram`
 * - Look up `channels` row by chat_id to find tenant
 * - Create/reuse `threads` row
 * - Insert `messages` row with tenant context
 *
 * See ADR-0009 Telegram-first, and Linear issue BLU-13.
 */

export const telegramWebhook = new Hono()

telegramWebhook.post('/', async (c) => {
  // 1. Verify webhook secret token (fail fast if spoofed)
  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token')
  if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    logger.warn('Telegram webhook rejected: bad secret token', {
      correlationId: crypto.randomUUID(),
    })
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  // 2. Parse body (cheap JSON parse; real validation in BLU-13)
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    logger.warn('Telegram webhook rejected: invalid JSON')
    return c.json({ ok: false, error: 'invalid json' }, 400)
  }

  // 3. Log receipt (structure of update is validated in BLU-13)
  logger.info('Telegram update received', { update: body })

  // 4. Acknowledge within Telegram's 5s window. Long work is offloaded
  //    to Inngest (not implemented yet; see ARCHITECTURE.md principle #3).
  return c.json({ ok: true })
})
