import { Hono } from 'hono'
import { env } from './env.js'
import { logger } from './lib/logger.js'
import { telegramWebhook } from './routes/webhooks/telegram.js'

/**
 * BlueCairn API — entry point.
 *
 * Routes mounted:
 *   GET  /health                  — liveness/readiness probe
 *   POST /webhooks/telegram       — Telegram Bot API webhook (ADR-0009)
 *
 * Future (per ROADMAP):
 *   POST /webhooks/twilio         — Month 11+ (WhatsApp + SMS via Twilio)
 *   POST /webhooks/square         — Month 3+ (POS integration)
 *   POST /webhooks/inngest        — Month 1+ (durable execution callbacks)
 *
 * See ENGINEERING.md § Running locally.
 */

export const app = new Hono()

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'api',
    env: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  }),
)

app.route('/webhooks/telegram', telegramWebhook)

// Global error handler — fail soft in prod, never leak stack traces to callers.
app.onError((err, c) => {
  const correlationId = crypto.randomUUID()
  logger.error('unhandled error', {
    correlationId,
    error: err.message,
    stack: env.NODE_ENV === 'development' ? err.stack : undefined,
  })
  return c.json({ ok: false, error: 'internal error', correlationId }, 500)
})

app.notFound((c) => c.json({ ok: false, error: 'not found' }, 404))

logger.info('api starting', { port: env.PORT, env: env.NODE_ENV })

export default {
  port: env.PORT,
  fetch: app.fetch,
}
