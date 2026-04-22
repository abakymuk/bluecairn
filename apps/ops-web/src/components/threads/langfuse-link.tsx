import { ExternalLink } from 'lucide-react'
import { langfuseTraceUrl } from '@/lib/langfuse-url'

/**
 * Renders a "Langfuse" link for an agent_run's trace. Graceful when
 * the trace id is missing OR env lacks LANGFUSE_HOST / LANGFUSE_PROJECT_ID
 * (local dev) — the link simply isn't emitted in those cases.
 */
export function LangfuseLink({ traceId }: { readonly traceId: string | null | undefined }) {
  const url = langfuseTraceUrl(traceId)
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      Langfuse <ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  )
}
