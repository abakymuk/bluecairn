import Link from 'next/link'
import type { ThreadListRow } from '@/lib/data/threads'
import { formatRelativeTime } from '@/lib/format'
import { Badge } from './badges'

/**
 * One row in the /threads list. Card-style so the target area is large
 * and the ops-pod can triage on mobile without hunting for links.
 */
export function ThreadCard({ thread }: { readonly thread: ThreadListRow }) {
  return (
    <Link
      href={`/threads/${thread.threadId}`}
      className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/60"
      aria-label={`Thread ${thread.tenantName} on ${thread.channelKind ?? 'unknown channel'}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{thread.tenantName}</span>
            <Badge tone="neutral">{thread.channelKind ?? 'no channel'}</Badge>
            {thread.pendingApprovalCount > 0 && (
              <Badge tone="warning">
                {thread.pendingApprovalCount} pending approval
                {thread.pendingApprovalCount === 1 ? '' : 's'}
              </Badge>
            )}
          </div>
          <p className="mt-2 truncate text-sm text-muted-foreground">
            {thread.lastContent ? (
              <>
                <span className="mr-1 font-medium">
                  {thread.lastDirection === 'inbound' ? '→' : '←'}
                </span>
                {thread.lastContent.slice(0, 120)}
                {thread.lastContent.length > 120 && '…'}
              </>
            ) : (
              <em>no messages yet</em>
            )}
          </p>
        </div>
        <time className="shrink-0 text-xs text-muted-foreground">
          {formatRelativeTime(thread.lastMessageAt)}
        </time>
      </div>
    </Link>
  )
}
