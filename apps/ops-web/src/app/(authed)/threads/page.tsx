import { headers } from 'next/headers'
import { SignOutButton } from '@/components/sign-out-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { auth } from '@/lib/auth'

/**
 * Threads placeholder — BLU-27 builds the real read-only thread viewer
 * (tenant list, thread list per tenant, message timeline, agent runs,
 * approval requests, action statuses). For BLU-26 scaffolding we just
 * prove the authed layout is wired correctly: show the user email and
 * a sign-out button.
 */
export default async function ThreadsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const email = session?.user.email ?? '(unknown)'
  const name = session?.user.name ?? email

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Threads</h1>
          <p className="text-sm text-muted-foreground">
            ops-web online — you are signed in as <span className="font-mono">{email}</span>
          </p>
        </div>
        <SignOutButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hello, {name}</CardTitle>
          <CardDescription>
            This page is a placeholder. BLU-27 ships the real thread viewer: list of tenants, their
            threads, the message timeline, agent runs, and approval statuses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc pl-6 text-sm text-muted-foreground">
            <li>Scaffold: Next.js 15 + App Router + Better Auth + Google OAuth + allow-list</li>
            <li>Next: tenant/thread/message read path against the shared Neon DB</li>
            <li>Then: approval review, action execution history, agent_runs telemetry</li>
          </ul>
        </CardContent>
      </Card>
    </main>
  )
}
