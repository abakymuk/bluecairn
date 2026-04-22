import { headers } from 'next/headers'
import { SignOutButton } from '@/components/sign-out-button'
import { AutoRefresh } from '@/components/threads/auto-refresh'
import { ThreadCard } from '@/components/threads/thread-card'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { auditOpsWebRead } from '@/lib/data/audit'
import { listThreadsAcrossTenants } from '@/lib/data/threads'
import { auth } from '@/lib/auth'

/**
 * `/threads` — ops-pod thread list. Server Component. Top-50 threads
 * across all tenants sorted by `last_message_at DESC`. Auto-refreshes
 * every 5 s via `AutoRefresh` so new messages appear without reload
 * (BLU-27 AC #6).
 *
 * Every render audits the fetch (`event_kind='ops_web_read'`, path
 * `/threads`) so the ops-pod compliance trail captures who looked at
 * what and when.
 */
export const dynamic = 'force-dynamic'

export default async function ThreadsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  // `(authed)/layout.tsx` already guarantees session + allow-list. If we
  // got here, session is truthy — the guard is defence in depth.
  const authUserId = session?.user.id ?? ''
  const authUserEmail = session?.user.email ?? '(unknown)'

  const threads = await listThreadsAcrossTenants(50)

  await auditOpsWebRead({
    authUserId,
    authUserEmail,
    path: '/threads',
    summary: `ops_web list threads (count=${threads.length})`,
    extra: { count: threads.length },
  })

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <AutoRefresh />

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Threads</h1>
          <p className="text-sm text-muted-foreground">
            ops-web online — {authUserEmail} ·{' '}
            <span className="font-mono text-xs">{threads.length} threads</span>
          </p>
        </div>
        <SignOutButton />
      </div>

      {threads.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No threads yet</CardTitle>
            <CardDescription>
              Once a tenant channel receives its first message, the thread will appear here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Shipping pipeline: Telegram webhook → <code>messages</code> →{' '}
              <code>orchestrator.route</code> → agent run → <code>actions</code> →{' '}
              <code>approval_requests</code>. All of this lands under the tenant&apos;s thread
              visible here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {threads.map((thread) => (
            <li key={thread.threadId}>
              <ThreadCard thread={thread} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
