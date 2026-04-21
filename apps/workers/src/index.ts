import { Hono } from 'hono'
import { serve } from 'inngest/hono'
import { env } from './env.js'
import { helloWorld } from './functions/hello-world.js'
import { inngest } from './inngest.js'
import { logger } from './lib/logger.js'

/**
 * BlueCairn workers — Inngest serve entry (ADR-0004).
 *
 * Routes:
 *   GET  /health                 — liveness/readiness probe (Railway, uptime)
 *   ANY  /api/inngest            — Inngest handshake + function invocations
 *
 * Functions registered here are the durable units. See
 * apps/workers/src/functions/ for the concrete implementations.
 */

export const app = new Hono()

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'workers',
    env: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  }),
)

app.on(
  ['GET', 'POST', 'PUT'],
  '/api/inngest',
  serve({
    client: inngest,
    functions: [helloWorld],
  }),
)

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

logger.info('workers starting', { port: env.PORT, env: env.NODE_ENV })

export default {
  port: env.PORT,
  fetch: app.fetch,
}
