import { initTracing } from '@bluecairn/agents'
import { Hono } from 'hono'
import { serve } from 'inngest/hono'
import { env } from './env.js'
import { actionGate } from './functions/action-gate.js'
import { agentConciergeRun } from './functions/agent-concierge-run.js'
import { helloWorld } from './functions/hello-world.js'
import { orchestratorRoute } from './functions/orchestrator-route.js'
import { inngest } from './inngest.js'
import { logger } from './lib/logger.js'

// BLU-22: wire Langfuse tracing at workers boot so every step.run + LLM
// call + MCP tool invocation lands in Langfuse with proper span nesting.
// Safe no-op if keys are missing (dev without Doppler).
if (env.LANGFUSE_PUBLIC_KEY !== undefined && env.LANGFUSE_SECRET_KEY !== undefined) {
  initTracing({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    host: env.LANGFUSE_HOST ?? 'https://us.cloud.langfuse.com',
    environment: env.NODE_ENV,
    exportMode: 'batched',
  })
  logger.info('langfuse tracing initialized', { host: env.LANGFUSE_HOST, env: env.NODE_ENV })
}

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
    // BLU-36: expose the live commit SHA so CI can wait for Railway to
    // actually rotate to the new deployment before triggering Inngest sync.
    // Prefer `DEPLOY_COMMIT_SHA` (set explicitly by CI — always present) over
    // `RAILWAY_GIT_COMMIT_SHA` (only set on Git-triggered deploys; absent when
    // Doppler live-sync or manual redeploy fires the build). Falls back to
    // 'unknown' in local dev where neither is set.
    deployedSha: env.DEPLOY_COMMIT_SHA ?? env.RAILWAY_GIT_COMMIT_SHA ?? 'unknown',
    deploymentId: env.RAILWAY_DEPLOYMENT_ID ?? 'unknown',
  }),
)

app.on(
  ['GET', 'POST', 'PUT'],
  '/api/inngest',
  serve({
    client: inngest,
    functions: [helloWorld, orchestratorRoute, agentConciergeRun, actionGate],
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
