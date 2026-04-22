'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function ThreadDetailError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string }
  readonly reset: () => void
}) {
  useEffect(() => {
    console.error('thread detail page error', error)
  }, [error])

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Couldn&apos;t load this thread</CardTitle>
          <CardDescription>
            Either the thread id is malformed or the DB returned an error. If the problem
            persists, check Neon, then the Railway deploy logs.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error.digest && (
            <p className="font-mono text-xs text-muted-foreground">error id: {error.digest}</p>
          )}
          <div className="flex gap-2">
            <Button onClick={reset} variant="outline">
              Try again
            </Button>
            <Link href="/threads">
              <Button variant="ghost">Back to all threads</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
