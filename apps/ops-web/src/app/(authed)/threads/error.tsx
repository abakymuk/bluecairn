'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Error boundary for /threads. Next.js routes automatically render this
 * when a Server Component throws during render / data-fetch.
 *
 * We log to the browser console (surfaces in Railway's log stream via
 * client telemetry eventually) and offer a one-click retry. Stack traces
 * are intentionally NOT shown to operators — the ops pod escalates via
 * Slack / Linear, not by reading tracebacks.
 */
export default function ThreadsError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string }
  readonly reset: () => void
}) {
  useEffect(() => {
    console.error('threads page error', error)
  }, [error])

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>
            We couldn&apos;t load the threads list. This is usually a transient DB connectivity
            blip — retry, and if it persists, check Railway and Neon status.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error.digest && (
            <p className="font-mono text-xs text-muted-foreground">error id: {error.digest}</p>
          )}
          <Button onClick={reset} variant="outline">
            Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
