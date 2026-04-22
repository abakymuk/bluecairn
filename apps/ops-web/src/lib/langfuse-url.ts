import { env } from '@/env'

/**
 * Build a deep-link URL to a Langfuse trace.
 *
 * Returns `null` when either `LANGFUSE_HOST` or `LANGFUSE_PROJECT_ID` is
 * missing from env (local dev without Doppler, or misconfigured staging).
 * Callers render the link conditionally so we don't ship broken hrefs.
 *
 * The shape follows Langfuse Cloud's canonical pattern:
 *   <host>/project/<project_id>/traces/<trace_id>
 */
export function langfuseTraceUrl(traceId: string | null | undefined): string | null {
  if (!traceId) return null
  if (!env.LANGFUSE_HOST || !env.LANGFUSE_PROJECT_ID) return null
  return `${env.LANGFUSE_HOST.replace(/\/+$/, '')}/project/${env.LANGFUSE_PROJECT_ID}/traces/${encodeURIComponent(traceId)}`
}
