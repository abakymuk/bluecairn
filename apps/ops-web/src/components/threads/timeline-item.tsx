import type {
  TimelineAction,
  TimelineAgentRun,
  TimelineApprovalRequest,
  TimelineItem,
  TimelineMessage,
} from '@/lib/data/threads'
import {
  formatCostCents,
  formatLatencyMs,
  formatRelativeTime,
  formatStakesCents,
  formatTokens,
} from '@/lib/format'
import { actionTone, agentRunTone, approvalTone, Badge } from './badges'
import { LangfuseLink } from './langfuse-link'

/**
 * Discriminated-union renderer for every row on the thread detail
 * timeline. Kept as a single component (not one-per-kind) so the
 * visual language stays consistent and the switch is exhaustive —
 * TS will flag a new `TimelineItem.kind` variant immediately.
 */
export function TimelineItem({
  item,
  now,
}: {
  readonly item: TimelineItem
  readonly now?: Date | undefined
}) {
  switch (item.kind) {
    case 'message':
      return <MessageItem item={item} now={now} />
    case 'agent_run':
      return <AgentRunItem item={item} now={now} />
    case 'action':
      return <ActionItem item={item} now={now} />
    case 'approval_request':
      return <ApprovalRequestItem item={item} now={now} />
    default: {
      // Exhaustive check — if a new `kind` is added without a branch
      // here, TypeScript fails at build time.
      const _exhaustive: never = item
      return _exhaustive
    }
  }
}

function Timestamp({ at, now }: { readonly at: Date; readonly now?: Date | undefined }) {
  return (
    <time
      className="shrink-0 text-xs text-muted-foreground"
      dateTime={at.toISOString()}
      title={at.toISOString()}
    >
      {formatRelativeTime(at, now)}
    </time>
  )
}

function Row({
  kind,
  tone,
  header,
  children,
  at,
  now,
}: {
  readonly kind: string
  readonly tone: React.ComponentProps<typeof Badge>['tone']
  readonly header: React.ReactNode
  readonly children?: React.ReactNode
  readonly at: Date
  readonly now?: Date | undefined
}) {
  return (
    <li
      data-kind={kind}
      className="flex gap-3 rounded-md border bg-card px-4 py-3 text-sm shadow-sm"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tone}>{kind}</Badge>
          {header}
        </div>
        {children && <div className="mt-2 space-y-1 text-muted-foreground">{children}</div>}
      </div>
      <Timestamp at={at} now={now} />
    </li>
  )
}

function MessageItem({ item, now }: { readonly item: TimelineMessage; readonly now?: Date | undefined }) {
  const tone = item.direction === 'inbound' ? 'neutral' : 'info'
  return (
    <Row
      kind={item.direction === 'inbound' ? 'inbound' : 'outbound'}
      tone={tone}
      header={<span className="font-medium">{item.authorKind}</span>}
      at={item.at}
      now={now}
    >
      <p className="whitespace-pre-wrap text-foreground">{item.content}</p>
    </Row>
  )
}

function AgentRunItem({
  item,
  now,
}: {
  readonly item: TimelineAgentRun
  readonly now?: Date | undefined
}) {
  return (
    <Row
      kind={`agent.${item.agentCode}`}
      tone={agentRunTone(item.status)}
      header={
        <>
          <Badge tone={agentRunTone(item.status)}>{item.status}</Badge>
          <span className="text-xs text-muted-foreground">{item.model}</span>
          <LangfuseLink traceId={item.langfuseTraceId} />
        </>
      }
      at={item.at}
      now={now}
    >
      <p className="text-xs">
        <span className="font-medium">tokens:</span>{' '}
        {formatTokens(item.inputTokens, item.outputTokens)}
      </p>
      <p className="text-xs">
        <span className="font-medium">cost:</span> {formatCostCents(item.costCents)}{' '}
        {item.costCents === 0 && (
          <span className="ml-1 text-[10px] italic">
            (sub-cent — see Langfuse for fractional)
          </span>
        )}
      </p>
      <p className="text-xs">
        <span className="font-medium">latency:</span> {formatLatencyMs(item.latencyMs)}
      </p>
      {item.completedAt && (
        <p className="text-xs">
          <span className="font-medium">completed:</span>{' '}
          {formatRelativeTime(item.completedAt, now)}
        </p>
      )}
    </Row>
  )
}

function ActionItem({ item, now }: { readonly item: TimelineAction; readonly now?: Date | undefined }) {
  return (
    <Row
      kind={`action.${item.actionKind}`}
      tone={actionTone(item.status)}
      header={
        <>
          <Badge tone={actionTone(item.status)}>{item.status}</Badge>
          <Badge tone="neutral">{item.policyOutcome}</Badge>
        </>
      }
      at={item.at}
      now={now}
    >
      <p className="truncate text-xs">
        <span className="font-medium">payload:</span> {item.payloadSummary}
      </p>
      {item.failureReason && (
        <p className="text-xs text-destructive">
          <span className="font-medium">failure:</span> {item.failureReason}
        </p>
      )}
    </Row>
  )
}

function ApprovalRequestItem({
  item,
  now,
}: {
  readonly item: TimelineApprovalRequest
  readonly now?: Date | undefined
}) {
  const statusLabel = item.resolvedStatus ?? 'pending'
  return (
    <Row
      kind="approval"
      tone={approvalTone(item.resolvedStatus)}
      header={
        <>
          <Badge tone={approvalTone(item.resolvedStatus)}>{statusLabel}</Badge>
          {item.stakesCents != null && (
            <span className="text-xs text-muted-foreground">
              stakes {formatStakesCents(item.stakesCents)}
            </span>
          )}
        </>
      }
      at={item.at}
      now={now}
    >
      <p className="text-xs">{item.summary}</p>
      {item.resolvedAt && (
        <p className="text-xs">
          <span className="font-medium">resolved:</span> {formatRelativeTime(item.resolvedAt, now)}
          {item.resolutionNote && <span className="ml-2">({item.resolutionNote})</span>}
        </p>
      )}
      {item.resolvedAt === null && item.expiresAt && (
        <p className="text-xs">
          <span className="font-medium">expires:</span> {formatRelativeTime(item.expiresAt, now)}
        </p>
      )}
    </Row>
  )
}
