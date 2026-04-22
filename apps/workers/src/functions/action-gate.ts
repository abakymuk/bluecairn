import {
  TenantId,
  newTenantContext,
  type ActionRequestedData,
  type ApprovalDecisionRecordedData,
} from '@bluecairn/core'
import { createDatabase, schema, withTenant, type Database } from '@bluecairn/db'
import {
  createTelegramBot,
  type TelegramInlineKeyboardMarkup,
} from '@bluecairn/integrations/telegram'
import { sendMessage, type SendMessageDeps, type SendMessageOutput } from '@bluecairn/mcp-servers'
import type { Result } from '@bluecairn/core'
import { startActiveObservation } from '@langfuse/tracing'
import { eq } from 'drizzle-orm'
import { env } from '../env.js'
import { inngest } from '../inngest.js'
import { logger } from '../lib/logger.js'

/**
 * action.gate — human approval state machine for agent-produced actions
 * (BLU-25, ARCHITECTURE.md principle #8).
 *
 * Triggered by `action.requested` filtered to `policy_outcome='approval_required'`.
 * For M1 this is every Concierge action; M2 Sofia will emit `auto_small` and
 * `auto_medium` too, which this function is filtered OUT of by Inngest's
 * server-side `if` clause.
 *
 * Flow (six step.run + one step.waitForEvent):
 *
 *   1. load-action        Verify action is still pending + pull thread_id from
 *                         payload. Idempotency-safe re-entry: if the row is
 *                         already `awaiting_approval`, continue with the
 *                         existing approval_request instead of inserting again.
 *
 *   2. create-approval    Insert `approval_requests` (resolvedStatus=null means
 *                         pending). Update `actions.status='awaiting_approval'`.
 *                         expiresAt = now + 24h. The request id becomes the
 *                         pivot key in the Telegram `callback_data`.
 *
 *   3. send-approval-prompt  Comms MCP `send_message` with inline-keyboard
 *                            buttons. Idempotent via
 *                            `approval-prompt:<action_id>` — replays on
 *                            Inngest retry return the cached telegram message
 *                            id without re-posting.
 *
 *   4. waitForEvent       `approval.decision.recorded` matching on
 *                         `async.data.approval_request_id`. Returns null on
 *                         timeout.
 *
 *   5. Branch:
 *      - null → expire-action
 *      - approved → mark-approved → dispatch-action
 *      - rejected → mark-rejected → ack-rejection
 *
 * Tenant scoping: every DB write uses `withTenant(db, ctx)` to set the RLS
 * session var; the function boundary loads via admin pool for the pre-context
 * action fetch, then switches into tenant context.
 *
 * Langfuse: whole body wrapped in `action.gate` span. `tool.comms.send_message`
 * spans (BLU-33) nest inside. Closes BLU-33 AC#5 and BLU-21 AC#8 once this
 * function lives on staging.
 */

const DEFAULT_APPROVAL_TIMEOUT = '24h'
const APPROVAL_EXPIRY_MS = 24 * 60 * 60 * 1000
const ACK_REJECTED_TEXT = 'Action cancelled by operator.'

const db: Database = createDatabase(env.DATABASE_URL_ADMIN)
const bot = createTelegramBot(env.TELEGRAM_BOT_TOKEN)
const sendDeps: SendMessageDeps = { db, bot }

export type ActionGateOutcome = 'executed' | 'rejected' | 'expired' | 'skipped'

export interface ActionGateOutput {
  action_id: string
  approval_request_id: string | null
  outcome: ActionGateOutcome
  latency_ms: number
}

/**
 * Minimal step surface this handler uses. Matches the subset of Inngest's
 * runtime used by the body; testing passes a plain object with these three
 * methods (see test/functions/action-gate.test.ts).
 */
export interface ActionGateStep {
  run: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  sendEvent: (name: string, payload: { name: string; id?: string; data: unknown }) => Promise<unknown>
  waitForEvent: (
    name: string,
    opts: {
      event: 'approval.decision.recorded'
      timeout: number | string
      if?: string
      match?: string
    },
  ) => Promise<{ data: ApprovalDecisionRecordedData } | null>
}

/**
 * Terminal `actions.status` values — if we see one of these in step 1, the
 * gate has already fully resolved on a prior invocation. We short-circuit
 * to avoid duplicating audit_log rows and Telegram sends on a replay
 * (e.g. manual Inngest re-run, or a second `action.requested` event for the
 * same action_id emitted by an over-enthusiastic upstream).
 */
const TERMINAL_ACTION_STATUSES = ['executed', 'rejected', 'expired', 'failed'] as const
type TerminalActionStatus = (typeof TERMINAL_ACTION_STATUSES)[number]

const terminalStatusToOutcome = (status: TerminalActionStatus): ActionGateOutcome => {
  if (status === 'executed') return 'executed'
  if (status === 'rejected') return 'rejected'
  if (status === 'expired') return 'expired'
  return 'executed' // 'failed' — prior run threw for Inngest retry; caller gets executed-intent + sees failure in DB
}

interface LoadedAction {
  currentStatus: string
  threadId: string
  text: string
  existingApprovalRequestId: string | null
}

/**
 * Pure handler — exported for unit testing. `actionGate` below wires it into
 * Inngest with the trigger + if filter. The `sendDepsOverride` knob lets
 * tests swap Comms MCP for a mocked `sendMessage`; `dbOverride` and
 * `timeoutOverride` follow the same pattern used by BLU-22/23 handlers.
 */
export const handleActionGate = async (args: {
  event: { data: ActionRequestedData }
  step: ActionGateStep
  dbOverride?: Database
  sendMessageImpl?: (
    deps: SendMessageDeps,
    input: Parameters<typeof sendMessage>[1],
  ) => Promise<Result<SendMessageOutput, unknown>>
  timeoutOverride?: number | string
}): Promise<ActionGateOutput> => {
  const { event, step } = args
  const dbToUse = args.dbOverride ?? db
  const sendImpl = args.sendMessageImpl ?? sendMessage
  const timeout = args.timeoutOverride ?? DEFAULT_APPROVAL_TIMEOUT

  const {
    tenant_id,
    correlation_id,
    idempotency_key,
    action_id,
    agent_run_id,
    kind,
    policy_outcome,
  } = event.data
  // Note: we deliberately ignore `event.data.payload` and re-load the action
  // row from Postgres inside step 1. The DB row is the source of truth —
  // events are informational, action_id is the pivot.

  return await startActiveObservation(
    'action.gate',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (span: any) => {
      const start = Date.now()
      span.update({
        input: { action_id, agent_run_id, kind },
        metadata: {
          tenant_id,
          action_id,
          agent_run_id,
          correlation_id,
          idempotency_key,
          policy_outcome,
        },
      })

      // Defensive — this function is filtered to approval_required at Inngest,
      // but a misconfigured sender could still reach us. Skip cleanly.
      if (policy_outcome !== 'approval_required') {
        const latency = Date.now() - start
        const out: ActionGateOutput = {
          action_id,
          approval_request_id: null,
          outcome: 'skipped',
          latency_ms: latency,
        }
        span.update({ output: out })
        return out
      }

      // --- Step 1: load action + verify status transitions -------------------
      const loaded = await step.run('load-action', async () => {
        const ctx = newTenantContext({
          tenantId: TenantId(tenant_id),
          correlationId: correlation_id,
        })
        return await withTenant(dbToUse, ctx, async (tx): Promise<LoadedAction> => {
          const [action] = await tx
            .select({
              id: schema.actions.id,
              status: schema.actions.status,
              kind: schema.actions.kind,
              payload: schema.actions.payload,
            })
            .from(schema.actions)
            .where(eq(schema.actions.id, action_id))
            .limit(1)
          if (action === undefined) {
            throw new Error(`action ${action_id} not found (gate + producer out of sync)`)
          }
          if (action.kind !== 'send_message') {
            throw new Error(
              `action.gate only handles kind='send_message' in M1, got '${action.kind}'`,
            )
          }

          const actionPayload = action.payload as { thread_id?: string; text?: string }
          const threadId = actionPayload.thread_id
          const text = actionPayload.text
          if (threadId === undefined || text === undefined) {
            throw new Error(`action ${action_id} payload missing thread_id/text`)
          }

          // Re-entry check: if we already created an approval_request on a
          // prior attempt, return its id so downstream steps skip duplication.
          const [existingReq] = await tx
            .select({ id: schema.approvalRequests.id })
            .from(schema.approvalRequests)
            .where(eq(schema.approvalRequests.actionId, action_id))
            .limit(1)

          return {
            currentStatus: action.status,
            threadId,
            text,
            existingApprovalRequestId: existingReq?.id ?? null,
          }
        })
      })

      // Replay short-circuit: if a prior invocation already drove the action
      // to a terminal status, return the same semantic outcome without
      // touching DB / Telegram / audit again. Primary defense against
      // manual Inngest re-runs + duplicate `action.requested` emission.
      if (
        (TERMINAL_ACTION_STATUSES as readonly string[]).includes(loaded.currentStatus)
      ) {
        const outcome = terminalStatusToOutcome(loaded.currentStatus as TerminalActionStatus)
        const latency = Date.now() - start
        const out: ActionGateOutput = {
          action_id,
          approval_request_id: loaded.existingApprovalRequestId,
          outcome,
          latency_ms: latency,
        }
        span.update({
          output: { ...out, replayed: true, terminal_status: loaded.currentStatus },
        })
        logger.info('action.gate replay short-circuit', {
          tenantId: tenant_id,
          actionId: action_id,
          approvalRequestId: loaded.existingApprovalRequestId,
          terminalStatus: loaded.currentStatus,
        })
        return out
      }

      // --- Step 2: create approval_request (idempotent on action_id) --------
      const approvalRequestId = await step.run('create-approval-request', async () => {
        if (loaded.existingApprovalRequestId !== null) {
          return loaded.existingApprovalRequestId
        }
        const ctx = newTenantContext({
          tenantId: TenantId(tenant_id),
          correlationId: correlation_id,
        })
        return await withTenant(dbToUse, ctx, async (tx) => {
          const expiresAt = new Date(Date.now() + APPROVAL_EXPIRY_MS)
          const [inserted] = await tx
            .insert(schema.approvalRequests)
            .values({
              tenantId: tenant_id,
              actionId: action_id,
              summary: summarize(loaded.text),
              expiresAt,
              // resolvedStatus stays null → pending
            })
            .returning({ id: schema.approvalRequests.id })
          if (inserted === undefined) {
            throw new Error('approval_requests insert returned no row')
          }
          await tx
            .update(schema.actions)
            .set({ status: 'awaiting_approval', updatedAt: new Date() })
            .where(eq(schema.actions.id, action_id))
          return inserted.id
        })
      })

      span.update({ metadata: { approval_request_id: approvalRequestId } })

      // --- Step 3: post the Telegram prompt with inline buttons -------------
      await step.run('send-approval-prompt', async () => {
        const replyMarkup: TelegramInlineKeyboardMarkup = {
          inline_keyboard: [
            [
              { text: 'Approve', callback_data: `approval:${approvalRequestId}:approved` },
              { text: 'Reject', callback_data: `approval:${approvalRequestId}:rejected` },
            ],
          ],
        }
        const result = await sendImpl(sendDeps, {
          tenantId: tenant_id,
          threadId: loaded.threadId,
          text: loaded.text,
          replyMarkup,
          idempotencyKey: `approval-prompt:${action_id}`,
          agentRunId: agent_run_id,
          correlationId: correlation_id,
        })
        if (!result.ok) {
          throw new Error(
            `approval-prompt send failed: ${JSON.stringify(result.error).slice(0, 240)}`,
          )
        }
      })

      // --- Step 4: wait for the decision ------------------------------------
      const decision = await step.waitForEvent('await-decision', {
        event: 'approval.decision.recorded',
        timeout,
        // CEL expression — the field `async.data.approval_request_id` on the
        // incoming event must equal the approval_request_id we just created.
        // Using `if` over the deprecated `match` (Inngest docs).
        if: `async.data.approval_request_id == "${approvalRequestId}"`,
      })

      // --- Step 5: branch on decision ---------------------------------------
      if (decision === null) {
        await expireApproval({
          dbToUse,
          step,
          tenantId: tenant_id,
          correlationId: correlation_id,
          actionId: action_id,
          approvalRequestId,
        })
        const out: ActionGateOutput = {
          action_id,
          approval_request_id: approvalRequestId,
          outcome: 'expired',
          latency_ms: Date.now() - start,
        }
        span.update({ output: out })
        logger.info('action.gate expired', {
          tenantId: tenant_id,
          actionId: action_id,
          approvalRequestId,
        })
        return out
      }

      if (decision.data.decision === 'approved') {
        await markApproved({
          dbToUse,
          step,
          tenantId: tenant_id,
          correlationId: correlation_id,
          actionId: action_id,
          approvalRequestId,
          userTelegramId: decision.data.user_telegram_id,
        })
        await dispatchApprovedAction({
          dbToUse,
          step,
          sendImpl,
          tenantId: tenant_id,
          correlationId: correlation_id,
          actionId: action_id,
          agentRunId: agent_run_id,
          threadId: loaded.threadId,
          text: loaded.text,
          approvalRequestId,
        })
        const out: ActionGateOutput = {
          action_id,
          approval_request_id: approvalRequestId,
          outcome: 'executed',
          latency_ms: Date.now() - start,
        }
        span.update({ output: out })
        logger.info('action.gate executed', {
          tenantId: tenant_id,
          actionId: action_id,
          approvalRequestId,
        })
        return out
      }

      // rejected
      await markRejected({
        dbToUse,
        step,
        tenantId: tenant_id,
        correlationId: correlation_id,
        actionId: action_id,
        approvalRequestId,
        userTelegramId: decision.data.user_telegram_id,
      })
      await ackRejection({
        step,
        sendImpl,
        tenantId: tenant_id,
        correlationId: correlation_id,
        actionId: action_id,
        agentRunId: agent_run_id,
        threadId: loaded.threadId,
      })
      const out: ActionGateOutput = {
        action_id,
        approval_request_id: approvalRequestId,
        outcome: 'rejected',
        latency_ms: Date.now() - start,
      }
      span.update({ output: out })
      logger.info('action.gate rejected', {
        tenantId: tenant_id,
        actionId: action_id,
        approvalRequestId,
      })
      return out
    },
    { asType: 'agent' },
  )
}

// ---------------------------------------------------------------------------
// Helpers — each wraps one step.run + writes an audit_log row.
// ---------------------------------------------------------------------------

interface BranchArgs {
  dbToUse: Database
  step: ActionGateStep
  tenantId: string
  correlationId: string
  actionId: string
  approvalRequestId: string
}

const markApproved = async (args: BranchArgs & { userTelegramId: number }): Promise<void> => {
  await args.step.run('mark-approved', async () => {
    const ctx = newTenantContext({
      tenantId: TenantId(args.tenantId),
      correlationId: args.correlationId,
    })
    await withTenant(args.dbToUse, ctx, async (tx) => {
      await tx
        .update(schema.approvalRequests)
        .set({
          resolvedStatus: 'approved',
          resolvedAt: new Date(),
          resolutionNote: `telegram:${args.userTelegramId}`,
        })
        .where(eq(schema.approvalRequests.id, args.approvalRequestId))
      await tx
        .update(schema.actions)
        .set({ status: 'executing', updatedAt: new Date() })
        .where(eq(schema.actions.id, args.actionId))
      await tx.insert(schema.auditLog).values({
        tenantId: args.tenantId,
        actionId: args.actionId,
        eventKind: 'approval.granted',
        eventSummary: `approval ${args.approvalRequestId} granted`,
        eventPayload: {
          approval_request_id: args.approvalRequestId,
          user_telegram_id: args.userTelegramId,
          correlation_id: args.correlationId,
        },
      })
    })
  })
}

const markRejected = async (args: BranchArgs & { userTelegramId: number }): Promise<void> => {
  await args.step.run('mark-rejected', async () => {
    const ctx = newTenantContext({
      tenantId: TenantId(args.tenantId),
      correlationId: args.correlationId,
    })
    await withTenant(args.dbToUse, ctx, async (tx) => {
      await tx
        .update(schema.approvalRequests)
        .set({
          resolvedStatus: 'rejected',
          resolvedAt: new Date(),
          resolutionNote: `telegram:${args.userTelegramId}`,
        })
        .where(eq(schema.approvalRequests.id, args.approvalRequestId))
      await tx
        .update(schema.actions)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(eq(schema.actions.id, args.actionId))
      await tx.insert(schema.auditLog).values({
        tenantId: args.tenantId,
        actionId: args.actionId,
        eventKind: 'approval.rejected',
        eventSummary: `approval ${args.approvalRequestId} rejected`,
        eventPayload: {
          approval_request_id: args.approvalRequestId,
          user_telegram_id: args.userTelegramId,
          correlation_id: args.correlationId,
        },
      })
    })
  })
}

const expireApproval = async (args: BranchArgs): Promise<void> => {
  await args.step.run('expire-action', async () => {
    const ctx = newTenantContext({
      tenantId: TenantId(args.tenantId),
      correlationId: args.correlationId,
    })
    await withTenant(args.dbToUse, ctx, async (tx) => {
      await tx
        .update(schema.approvalRequests)
        .set({ resolvedStatus: 'expired', resolvedAt: new Date() })
        .where(eq(schema.approvalRequests.id, args.approvalRequestId))
      await tx
        .update(schema.actions)
        .set({
          status: 'expired',
          updatedAt: new Date(),
          failedAt: new Date(),
          failureReason: 'approval_expired',
        })
        .where(eq(schema.actions.id, args.actionId))
      await tx.insert(schema.auditLog).values({
        tenantId: args.tenantId,
        actionId: args.actionId,
        eventKind: 'approval.expired',
        eventSummary: `approval ${args.approvalRequestId} expired (24h timeout)`,
        eventPayload: {
          approval_request_id: args.approvalRequestId,
          correlation_id: args.correlationId,
        },
      })
    })
  })
}

const dispatchApprovedAction = async (args: {
  dbToUse: Database
  step: ActionGateStep
  sendImpl: (
    deps: SendMessageDeps,
    input: Parameters<typeof sendMessage>[1],
  ) => Promise<Result<SendMessageOutput, unknown>>
  tenantId: string
  correlationId: string
  actionId: string
  agentRunId: string
  threadId: string
  text: string
  approvalRequestId: string
}): Promise<void> => {
  await args.step.run('dispatch-action', async () => {
    const result = await args.sendImpl(sendDeps, {
      tenantId: args.tenantId,
      threadId: args.threadId,
      text: args.text,
      idempotencyKey: `action-dispatch:${args.actionId}`,
      agentRunId: args.agentRunId,
      correlationId: args.correlationId,
    })
    const ctx = newTenantContext({
      tenantId: TenantId(args.tenantId),
      correlationId: args.correlationId,
    })
    if (!result.ok) {
      // Record the failure + throw so Inngest retries the step. The
      // `action-dispatch:<id>` idempotency_key on Comms MCP prevents a
      // duplicate Telegram send when the retry eventually succeeds.
      await withTenant(args.dbToUse, ctx, async (tx) => {
        await tx
          .update(schema.actions)
          .set({
            status: 'failed',
            failedAt: new Date(),
            failureReason: JSON.stringify(result.error).slice(0, 240),
            updatedAt: new Date(),
          })
          .where(eq(schema.actions.id, args.actionId))
        await tx.insert(schema.auditLog).values({
          tenantId: args.tenantId,
          actionId: args.actionId,
          eventKind: 'action.failed',
          eventSummary: `action ${args.actionId} dispatch failed`,
          eventPayload: {
            approval_request_id: args.approvalRequestId,
            error: result.error,
            correlation_id: args.correlationId,
          },
        })
      })
      throw new Error(
        `action dispatch failed: ${JSON.stringify(result.error).slice(0, 240)}`,
      )
    }
    await withTenant(args.dbToUse, ctx, async (tx) => {
      await tx
        .update(schema.actions)
        .set({ status: 'executed', executedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.actions.id, args.actionId))
      await tx.insert(schema.auditLog).values({
        tenantId: args.tenantId,
        actionId: args.actionId,
        eventKind: 'action.executed',
        eventSummary: `action ${args.actionId} dispatched via comms.send_message`,
        eventPayload: {
          approval_request_id: args.approvalRequestId,
          correlation_id: args.correlationId,
        },
      })
    })
  })
}

const ackRejection = async (args: {
  step: ActionGateStep
  sendImpl: (
    deps: SendMessageDeps,
    input: Parameters<typeof sendMessage>[1],
  ) => Promise<Result<SendMessageOutput, unknown>>
  tenantId: string
  correlationId: string
  actionId: string
  agentRunId: string
  threadId: string
}): Promise<void> => {
  await args.step.run('ack-rejection', async () => {
    const result = await args.sendImpl(sendDeps, {
      tenantId: args.tenantId,
      threadId: args.threadId,
      text: ACK_REJECTED_TEXT,
      idempotencyKey: `action-ack-rejected:${args.actionId}`,
      agentRunId: args.agentRunId,
      correlationId: args.correlationId,
    })
    if (!result.ok) {
      // Best-effort — the operator already tapped Reject, the action row is
      // already `rejected`. Log and let Inngest retry the ack independently.
      throw new Error(
        `ack-rejection send failed: ${JSON.stringify(result.error).slice(0, 240)}`,
      )
    }
  })
}

// Short, diagnostic summary used for approval_requests.summary. Keeps the row
// readable in ops-web without storing the full action payload twice.
const summarize = (text: string): string => {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed
}


// ---------------------------------------------------------------------------
// Inngest wiring — subscribes to `action.requested` filtered to
// `policy_outcome == 'approval_required'`. When Sofia M2 emits `auto_small`
// actions, the filter skips them and the orchestrator dispatches directly.
// ---------------------------------------------------------------------------
export const actionGate = inngest.createFunction(
  {
    id: 'action-gate',
    name: 'Action: approval gate',
  },
  {
    event: 'action.requested',
    if: "event.data.policy_outcome == 'approval_required'",
  },
  async ({ event, step }) =>
    handleActionGate({
      event,
      step: step as unknown as ActionGateStep,
    }),
)
