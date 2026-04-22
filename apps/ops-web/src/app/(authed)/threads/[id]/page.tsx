import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SignOutButton } from '@/components/sign-out-button'
import { AutoRefresh } from '@/components/threads/auto-refresh'
import { Badge } from '@/components/threads/badges'
import { TimelineItem } from '@/components/threads/timeline-item'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { auditOpsWebRead } from '@/lib/data/audit'
import { getThreadWithTimeline } from '@/lib/data/threads'
import { formatRelativeTime } from '@/lib/format'
import { auth } from '@/lib/auth'

/**
 * `/threads/[id]` — thread detail with chronological timeline of
 * messages, agent runs, actions, and approval requests. Server
 * Component. Auto-refreshes every 5 s.
 *
 * Writes an `ops_web_read` audit entry per render, scoped to the
 * tenant of the viewed thread so compliance queries can filter by
 * tenant.
 */
export const dynamic = 'force-dynamic'

export default async function ThreadDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth.api.getSession({ headers: await headers() })
  const authUserId = session?.user.id ?? ''
  const authUserEmail = session?.user.email ?? '(unknown)'

  const detail = await getThreadWithTimeline(id)
  if (!detail) {
    notFound()
  }

  await auditOpsWebRead({
    authUserId,
    authUserEmail,
    path: `/threads/${id}`,
    tenantId: detail.header.tenantId,
    threadId: id,
    summary: `ops_web view thread ${id}`,
    extra: { timeline_count: detail.timeline.length },
  })

  const { header, timeline } = detail

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <AutoRefresh />

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link
            href="/threads"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            ← all threads
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Thread</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{header.tenantName}</span>
            <span>·</span>
            <Badge tone="neutral">{header.channelKind ?? 'no channel'}</Badge>
            <span className="font-mono text-xs">{header.channelExternalId ?? '—'}</span>
            <span>·</span>
            <span className="font-mono text-xs">{id}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            created {formatRelativeTime(header.createdAt)} · last activity{' '}
            {formatRelativeTime(header.lastMessageAt)} ·{' '}
            <span className="font-mono">{timeline.length} events</span>
          </p>
        </div>
        <SignOutButton />
      </div>

      {timeline.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No events yet</CardTitle>
            <CardDescription>Thread exists but has no messages or runs.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This usually means a channel was provisioned but never received a message. When
              the first message arrives, it will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {timeline.map((item) => (
            <TimelineItem key={`${item.kind}:${item.id}`} item={item} />
          ))}
        </ul>
      )}
    </main>
  )
}
