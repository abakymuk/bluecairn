import { NextResponse } from 'next/server'
import { env } from '@/env'

/**
 * Unauthenticated liveness probe for Railway's healthcheck + BLU-36's
 * `sync-inngest-staging` CI job (the latter polls `/api/health` until
 * `deployedSha` matches `github.sha` before triggering Inngest sync).
 *
 * Intentionally minimal — no DB check, no auth — so Railway's
 * start-up swap succeeds even if Neon blips.
 */
export function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'ops-web',
    env: env.NODE_ENV,
    timestamp: new Date().toISOString(),
    deployedSha: env.RAILWAY_GIT_COMMIT_SHA ?? 'unknown',
    deploymentId: env.RAILWAY_DEPLOYMENT_ID ?? 'unknown',
  })
}

// Keep the route edge-compatible eventually, but stay on Node for now
// (env.ts depends on process.env and throws on missing vars, which the
// edge runtime won't surface cleanly).
export const runtime = 'nodejs'
