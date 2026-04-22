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

// Self-sync Inngest on boot in staging/prod. Replaces the CI-driven sync step
// (BLU-36 loop) which deadlocked with Railway's "Wait for CI" gate: any
// check_run on the merge commit — including the one created by a
// workflow_run-triggered sync — blocks Railway's deploy until the suite goes
// fully green. That check couldn't succeed until Railway deployed, which
// Railway wouldn't do until the check succeeded. Circular.
//
// Doing the sync from inside the container removes CI from the critical path.
// Idempotent: Inngest's PUT handler is safe to re-invoke. If the call fails
// transiently, Inngest Cloud will still discover functions lazily via its own
// next-event-triggered sync.
//
// Retry loop (not a fixed setTimeout): on a cold Railway container the Inngest
// `serve()` handler keeps returning 400 until Railway's public router begins
// forwarding to the new deployment — Inngest Cloud's PUT-time verification
// callback to our public URL fails otherwise. Observed window on staging
// (deploy dfb815a): >30s, <70s. 90s budget covers it with margin; if this
// ever isn't enough, escalate to polling the public /health before sync.
async function selfSyncInngest(): Promise<void> {
  const url = `http://localhost:${env.PORT}/api/inngest`
  const maxAttempts = 30
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await fetch(url, { method: 'PUT' })
      if (r.ok) {
        logger.info('inngest self-sync', { status: r.status, attempt })
        return
      }
      logger.warn('inngest self-sync retry', { status: r.status, attempt })
    } catch (e: unknown) {
      logger.warn('inngest self-sync error', {
        attempt,
        err: e instanceof Error ? e.message : String(e),
      })
    }
    await new Promise((res) => setTimeout(res, 3000))
  }
  logger.error('inngest self-sync gave up', { attempts: maxAttempts })
}

if (
  env.INNGEST_SIGNING_KEY !== undefined &&
  env.NODE_ENV !== 'development' &&
  env.NODE_ENV !== 'test'
) {
  void selfSyncInngest()
}

export default {
  port: env.PORT,
  fetch: app.fetch,
}
