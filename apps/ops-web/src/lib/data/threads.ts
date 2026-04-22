import { schema } from '@bluecairn/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'

/**
 * Data layer for the ops-web thread viewer (BLU-27). Admin-role client
 * only — these queries are cross-tenant by design and we enforce
 * ops-pod authorization in-app (allow-list + audit trail), not via RLS.
 *
 * Two entry points:
 *   - `listThreadsAcrossTenants` — the list page. Single raw SQL with
 *     LATERAL joins so per-thread aggregates (latest message, pending
 *     approvals) land in one round-trip. Top-50 by last_message_at.
 *   - `getThreadWithTimeline` — the detail page. 4 parallel queries
 *     (messages, agent_runs, actions, approval_requests) merged into a
 *     single chronological timeline in-memory.
 *
 * Returns shapes are deliberately flat + serializable — no Drizzle row
 * objects leak into page props.
 */

export interface ThreadListRow {
  threadId: string
  tenantId: string
  tenantSlug: string
  tenantName: string
  threadKind: string
  channelKind: string | null
  channelExternalId: string | null
  lastContent: string | null
  lastDirection: 'inbound' | 'outbound' | null
  lastMessageAt: Date | null
  pendingApprovalCount: number
}

interface ThreadListRawRow {
  [key: string]: unknown
  thread_id: string
  tenant_id: string
  tenant_slug: string
  tenant_name: string
  thread_kind: string
  channel_kind: string | null
  channel_external_id: string | null
  last_content: string | null
  last_direction: string | null
  last_message_at: Date | null
  pending_approval_count: number
}

/**
 * Top-N threads across all tenants, sorted by activity. Returns one row
 * per thread with last message preview + pending approval count.
 */
export async function listThreadsAcrossTenants(limit = 50): Promise<ThreadListRow[]> {
  // Raw SQL for LATERAL joins — Drizzle's query builder doesn't express
  // lateral subqueries cleanly. `sql.raw(limit)` is safe because `limit`
  // is typed as `number` (no string concatenation from user input).
  // Drizzle's execute() return is adapter-dependent — on postgres.js it's
  // an array, on neon-serverless it's { rows }. Cast through unknown to
  // a broad shape and normalise.
  const raw = (await db.execute<ThreadListRawRow>(sql`
    SELECT
      t.id                    AS thread_id,
      t.tenant_id             AS tenant_id,
      te.slug                 AS tenant_slug,
      te.display_name         AS tenant_name,
      t.kind                  AS thread_kind,
      c.kind                  AS channel_kind,
      c.external_id           AS channel_external_id,
      lm.content              AS last_content,
      lm.direction            AS last_direction,
      t.last_message_at       AS last_message_at,
      COALESCE(pa.count, 0)::int AS pending_approval_count
    FROM threads t
    JOIN tenants te ON te.id = t.tenant_id
    LEFT JOIN channels c ON c.id = t.channel_id
    LEFT JOIN LATERAL (
      SELECT content, direction
      FROM messages
      WHERE thread_id = t.id
      ORDER BY created_at DESC
      LIMIT 1
    ) lm ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS count
      FROM approval_requests ar
      JOIN actions a    ON a.id   = ar.action_id
      JOIN agent_runs r ON r.id   = a.agent_run_id
      WHERE r.thread_id = t.id AND ar.resolved_status IS NULL
    ) pa ON true
    ORDER BY t.last_message_at DESC NULLS LAST, t.created_at DESC
    LIMIT ${sql.raw(String(limit))}
  `)) as unknown as ThreadListRawRow[] | { rows: ThreadListRawRow[] }

  const rows: ThreadListRawRow[] = Array.isArray(raw) ? raw : (raw.rows ?? [])
  return rows.map((r) => ({
    threadId: r.thread_id,
    tenantId: r.tenant_id,
    tenantSlug: r.tenant_slug,
    tenantName: r.tenant_name,
    threadKind: r.thread_kind,
    channelKind: r.channel_kind,
    channelExternalId: r.channel_external_id,
    lastContent: r.last_content,
    lastDirection: (r.last_direction === 'inbound' || r.last_direction === 'outbound')
      ? r.last_direction
      : null,
    lastMessageAt: r.last_message_at ? new Date(r.last_message_at) : null,
    pendingApprovalCount: Number(r.pending_approval_count ?? 0),
  }))
}

// ---------------------------------------------------------------------------
// Detail (timeline) query
// ---------------------------------------------------------------------------

export interface ThreadDetailHeader {
  threadId: string
  tenantId: string
  tenantSlug: string
  tenantName: string
  threadKind: string
  channelKind: string | null
  channelExternalId: string | null
  createdAt: Date
  lastMessageAt: Date | null
}

export interface TimelineMessage {
  kind: 'message'
  at: Date
  id: string
  direction: 'inbound' | 'outbound'
  authorKind: string
  content: string
  externalMessageId: string | null
  toolCallId: string | null
}

export interface TimelineAgentRun {
  kind: 'agent_run'
  at: Date
  id: string
  agentCode: string
  status: string
  model: string
  inputTokens: number | null
  outputTokens: number | null
  costCents: number | null
  latencyMs: number | null
  langfuseTraceId: string | null
  startedAt: Date
  completedAt: Date | null
}

export interface TimelineAction {
  kind: 'action'
  at: Date
  id: string
  actionKind: string
  status: string
  policyOutcome: string
  payloadSummary: string
  executedAt: Date | null
  failedAt: Date | null
  failureReason: string | null
}

export interface TimelineApprovalRequest {
  kind: 'approval_request'
  at: Date
  id: string
  summary: string
  resolvedStatus: string | null
  resolvedAt: Date | null
  expiresAt: Date | null
  stakesCents: bigint | null
  resolutionNote: string | null
}

export type TimelineItem =
  | TimelineMessage
  | TimelineAgentRun
  | TimelineAction
  | TimelineApprovalRequest

export interface ThreadDetail {
  header: ThreadDetailHeader
  timeline: TimelineItem[]
}

/**
 * Load a thread with its merged chronological timeline. Returns `null`
 * when the thread id is unknown (→ page renders 404).
 */
export async function getThreadWithTimeline(threadId: string): Promise<ThreadDetail | null> {
  const [header] = await db
    .select({
      threadId: schema.threads.id,
      tenantId: schema.threads.tenantId,
      tenantSlug: schema.tenants.slug,
      tenantName: schema.tenants.displayName,
      threadKind: schema.threads.kind,
      channelKind: schema.channels.kind,
      channelExternalId: schema.channels.externalId,
      createdAt: schema.threads.createdAt,
      lastMessageAt: schema.threads.lastMessageAt,
    })
    .from(schema.threads)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.threads.tenantId))
    .leftJoin(schema.channels, eq(schema.channels.id, schema.threads.channelId))
    .where(eq(schema.threads.id, threadId))
    .limit(1)

  if (!header) return null

  const [messages, agentRuns, actions, approvalReqs] = await Promise.all([
    db
      .select({
        id: schema.messages.id,
        direction: schema.messages.direction,
        authorKind: schema.messages.authorKind,
        content: schema.messages.content,
        externalMessageId: schema.messages.externalMessageId,
        toolCallId: schema.messages.toolCallId,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(eq(schema.messages.threadId, threadId)),
    db
      .select({
        id: schema.agentRuns.id,
        agentCode: schema.agentDefinitions.code,
        status: schema.agentRuns.status,
        model: schema.agentRuns.model,
        inputTokens: schema.agentRuns.inputTokens,
        outputTokens: schema.agentRuns.outputTokens,
        costCents: schema.agentRuns.costCents,
        latencyMs: schema.agentRuns.latencyMs,
        langfuseTraceId: schema.agentRuns.langfuseTraceId,
        startedAt: schema.agentRuns.startedAt,
        completedAt: schema.agentRuns.completedAt,
      })
      .from(schema.agentRuns)
      .innerJoin(
        schema.agentDefinitions,
        eq(schema.agentDefinitions.id, schema.agentRuns.agentDefinitionId),
      )
      .where(eq(schema.agentRuns.threadId, threadId)),
    db
      .select({
        id: schema.actions.id,
        actionKind: schema.actions.kind,
        status: schema.actions.status,
        policyOutcome: schema.actions.policyOutcome,
        payload: schema.actions.payload,
        executedAt: schema.actions.executedAt,
        failedAt: schema.actions.failedAt,
        failureReason: schema.actions.failureReason,
        createdAt: schema.actions.createdAt,
      })
      .from(schema.actions)
      .innerJoin(schema.agentRuns, eq(schema.agentRuns.id, schema.actions.agentRunId))
      .where(eq(schema.agentRuns.threadId, threadId)),
    db
      .select({
        id: schema.approvalRequests.id,
        summary: schema.approvalRequests.summary,
        resolvedStatus: schema.approvalRequests.resolvedStatus,
        resolvedAt: schema.approvalRequests.resolvedAt,
        expiresAt: schema.approvalRequests.expiresAt,
        stakesCents: schema.approvalRequests.stakesCents,
        resolutionNote: schema.approvalRequests.resolutionNote,
        createdAt: schema.approvalRequests.createdAt,
      })
      .from(schema.approvalRequests)
      .innerJoin(schema.actions, eq(schema.actions.id, schema.approvalRequests.actionId))
      .innerJoin(schema.agentRuns, eq(schema.agentRuns.id, schema.actions.agentRunId))
      .where(
        and(eq(schema.agentRuns.threadId, threadId), isNull(schema.approvalRequests.resolvedStatus)),
      ),
  ])

  // Also load resolved approval requests (the filter above only gets
  // pending ones because we want the count on the list page to be fast;
  // for the detail view we want the FULL history, so fetch again
  // unfiltered. Two queries — acceptable, the filter avoids a second
  // trip to postgres for the list page).
  const resolvedApprovals = await db
    .select({
      id: schema.approvalRequests.id,
      summary: schema.approvalRequests.summary,
      resolvedStatus: schema.approvalRequests.resolvedStatus,
      resolvedAt: schema.approvalRequests.resolvedAt,
      expiresAt: schema.approvalRequests.expiresAt,
      stakesCents: schema.approvalRequests.stakesCents,
      resolutionNote: schema.approvalRequests.resolutionNote,
      createdAt: schema.approvalRequests.createdAt,
    })
    .from(schema.approvalRequests)
    .innerJoin(schema.actions, eq(schema.actions.id, schema.approvalRequests.actionId))
    .innerJoin(schema.agentRuns, eq(schema.agentRuns.id, schema.actions.agentRunId))
    .where(
      and(eq(schema.agentRuns.threadId, threadId), sql`${schema.approvalRequests.resolvedStatus} IS NOT NULL`),
    )

  const allApprovalReqs = [...approvalReqs, ...resolvedApprovals]

  const timeline: TimelineItem[] = [
    ...messages.map(
      (m): TimelineMessage => ({
        kind: 'message',
        at: m.createdAt,
        id: m.id,
        direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
        authorKind: m.authorKind,
        content: m.content,
        externalMessageId: m.externalMessageId,
        toolCallId: m.toolCallId,
      }),
    ),
    ...agentRuns.map(
      (r): TimelineAgentRun => ({
        kind: 'agent_run',
        at: r.startedAt,
        id: r.id,
        agentCode: r.agentCode,
        status: r.status,
        model: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costCents: r.costCents,
        latencyMs: r.latencyMs,
        langfuseTraceId: r.langfuseTraceId,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      }),
    ),
    ...actions.map(
      (a): TimelineAction => ({
        kind: 'action',
        at: a.createdAt,
        id: a.id,
        actionKind: a.actionKind,
        status: a.status,
        policyOutcome: a.policyOutcome,
        payloadSummary: summarizePayload(a.payload),
        executedAt: a.executedAt,
        failedAt: a.failedAt,
        failureReason: a.failureReason,
      }),
    ),
    ...allApprovalReqs.map(
      (ar): TimelineApprovalRequest => ({
        kind: 'approval_request',
        at: ar.createdAt,
        id: ar.id,
        summary: ar.summary,
        resolvedStatus: ar.resolvedStatus,
        resolvedAt: ar.resolvedAt,
        expiresAt: ar.expiresAt,
        stakesCents: ar.stakesCents,
        resolutionNote: ar.resolutionNote,
      }),
    ),
  ].sort((a, b) => a.at.getTime() - b.at.getTime())

  return {
    header: {
      threadId: header.threadId,
      tenantId: header.tenantId,
      tenantSlug: header.tenantSlug,
      tenantName: header.tenantName,
      threadKind: header.threadKind,
      channelKind: header.channelKind,
      channelExternalId: header.channelExternalId,
      createdAt: header.createdAt,
      lastMessageAt: header.lastMessageAt,
    },
    timeline,
  }
}

function summarizePayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '(empty)'
  const obj = payload as Record<string, unknown>
  if (typeof obj.text === 'string') {
    const text = obj.text.trim()
    return text.length > 100 ? `${text.slice(0, 97)}…` : text
  }
  const keys = Object.keys(obj)
  if (keys.length === 0) return '(empty)'
  return keys.slice(0, 4).join(', ')
}

export { summarizePayload as _summarizePayloadForTests }
