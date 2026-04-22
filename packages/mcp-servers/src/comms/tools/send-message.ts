import { Err, Ok, TenantId, newTenantContext, type Result } from '@bluecairn/core'
import { schema, withTenant, type Database } from '@bluecairn/db'
import {
  sendTelegramMessage,
  type TelegramInlineKeyboardMarkup,
  type TelegramSendError,
} from '@bluecairn/integrations/telegram'
import { startActiveObservation } from '@langfuse/tracing'
import { and, eq } from 'drizzle-orm'
import type { Bot } from 'grammy'

/**
 * `comms.send_message` — BlueCairn's first MCP tool (BLU-21, ADR-0003).
 *
 * Agents call this to send an outbound Telegram message (optionally with
 * inline-keyboard buttons for approval prompts). The handler:
 *
 *   1. Resolves thread → channel under the admin client (RLS-bypass, system
 *      context). Verifies the requested `tenant_id` matches the channel's
 *      tenant — rejects cross-tenant calls with `tenant_mismatch`.
 *   2. Checks `tool_calls` for a prior successful call under the same
 *      idempotency key. If found: returns the cached result (no Telegram
 *      re-send). This is the at-most-once property Inngest retries depend
 *      on.
 *   3. Inserts a `tool_calls` row (status=running) claiming the idempotency
 *      key. A concurrent caller with the same key loses the race and gets
 *      `db_error` — the agent layer should treat that as retry later.
 *   4. Calls Telegram via the shared grammY wrapper.
 *   5. On success: inserts the outbound `messages` row and updates the
 *      `tool_calls` row with status=success + result JSON. Cost/latency
 *      land on tool_calls for ops-web display.
 *   6. On failure: updates the tool_calls row with status=error + the
 *      classified error.
 *
 * Exposed both as a plain handler (for in-process use from apps/workers
 * during M1) and as a stdio MCP server tool in `../index.ts` (standards
 * compliance per ADR-0003, usable from any MCP client later).
 */

export interface SendMessageInput {
  tenantId: string
  threadId: string
  text: string
  replyMarkup?: TelegramInlineKeyboardMarkup
  idempotencyKey: string
  agentRunId: string
  correlationId: string
}

export interface SendMessageOutput {
  toolCallId: string
  messageId: string
  telegramMessageId: number
  cached: boolean
}

export type SendMessageErrorKind =
  | 'tenant_mismatch'
  | 'thread_not_found'
  | 'unsupported_channel'
  | 'duplicate_pending'
  | 'telegram_error'
  | 'db_error'

export interface SendMessageError {
  kind: SendMessageErrorKind
  message: string
  telegramErrorKind?: TelegramSendError['kind']
  cause?: unknown
}

export interface SendMessageDeps {
  // Admin-role DB client — bypasses RLS for the pre-tenant-context channel
  // lookup. All tenant-scoped writes still go through `withTenant`.
  db: Database
  bot: Bot
}

const MCP_SERVER = 'comms'
const TOOL_NAME = 'send_message'
const OBSERVATION_NAME = 'tool.comms.send_message'

/**
 * BLU-33: every `send_message` call lands as a `tool.comms.send_message`
 * observation in Langfuse, parented to whatever trace the caller opened
 * (agent_run span from BLU-22+). Metadata carries tenant / thread / agent
 * run ids so ops-web can filter by any of them; output carries the tool
 * call id + telegram message id + cached flag (happy path) or error_kind
 * (failure path).
 */
export const sendMessage = async (
  deps: SendMessageDeps,
  input: SendMessageInput,
): Promise<Result<SendMessageOutput, SendMessageError>> => {
  return await startActiveObservation(
    OBSERVATION_NAME,
    async (span) => {
      span.update({
        input: { thread_id: input.threadId }, // text omitted — avoid PII bloat in traces; message content lives in DB + agent_run LLM spans already
        metadata: {
          tenant_id: input.tenantId,
          thread_id: input.threadId,
          agent_run_id: input.agentRunId,
          idempotency_key: input.idempotencyKey,
          correlation_id: input.correlationId,
        },
      })

      const result = await executeSendMessage(deps, input)

      if (result.ok) {
        span.update({
          output: {
            tool_call_id: result.value.toolCallId,
            message_id: result.value.messageId,
            telegram_message_id: result.value.telegramMessageId,
            cached: result.value.cached,
          },
        })
      } else {
        span.update({
          output: {
            error_kind: result.error.kind,
            ...(result.error.telegramErrorKind !== undefined && {
              telegram_error_kind: result.error.telegramErrorKind,
            }),
          },
        })
      }

      return result
    },
    { asType: 'tool' },
  )
}

const executeSendMessage = async (
  deps: SendMessageDeps,
  input: SendMessageInput,
): Promise<Result<SendMessageOutput, SendMessageError>> => {
  const start = Date.now()

  // 1. Resolve thread → channel (admin, pre-tenant-context).
  let threadRow: {
    channelTenantId: string
    threadTenantId: string
    channelExternalId: string
    channelKind: string
  }
  try {
    const [row] = await deps.db
      .select({
        threadTenantId: schema.threads.tenantId,
        channelTenantId: schema.channels.tenantId,
        channelExternalId: schema.channels.externalId,
        channelKind: schema.channels.kind,
      })
      .from(schema.threads)
      .innerJoin(schema.channels, eq(schema.threads.channelId, schema.channels.id))
      .where(eq(schema.threads.id, input.threadId))
      .limit(1)

    if (!row) {
      return Err({
        kind: 'thread_not_found',
        message: `thread ${input.threadId} not found or has no channel`,
      })
    }
    threadRow = row
  } catch (err) {
    return Err(toDbError(err))
  }

  // 2. Tenant + channel-kind validation.
  if (
    threadRow.channelTenantId !== input.tenantId ||
    threadRow.threadTenantId !== input.tenantId
  ) {
    return Err({
      kind: 'tenant_mismatch',
      message: `tenant ${input.tenantId} does not own thread ${input.threadId}`,
    })
  }
  if (threadRow.channelKind !== 'telegram') {
    return Err({
      kind: 'unsupported_channel',
      message: `channel kind '${threadRow.channelKind}' not supported by comms.send_message`,
    })
  }

  const ctx = newTenantContext({
    tenantId: TenantId(input.tenantId),
    correlationId: input.correlationId,
  })

  // 3. Idempotency lookup + pending insert, all under one transaction so
  // a concurrent caller with the same key loses the INSERT race.
  let toolCallId: string
  let cachedResult: { messageId: string; telegramMessageId: number } | null = null
  try {
    const outcome = await withTenant(deps.db, ctx, async (tx) => {
      const [existing] = await tx
        .select({
          id: schema.toolCalls.id,
          status: schema.toolCalls.status,
          result: schema.toolCalls.result,
        })
        .from(schema.toolCalls)
        .where(
          and(
            eq(schema.toolCalls.tenantId, input.tenantId),
            eq(schema.toolCalls.mcpServer, MCP_SERVER),
            eq(schema.toolCalls.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1)

      if (existing !== undefined) {
        return { kind: 'existing' as const, row: existing }
      }

      const [inserted] = await tx
        .insert(schema.toolCalls)
        .values({
          tenantId: input.tenantId,
          agentRunId: input.agentRunId,
          mcpServer: MCP_SERVER,
          toolName: TOOL_NAME,
          arguments: {
            thread_id: input.threadId,
            text: input.text,
            reply_markup: input.replyMarkup ?? null,
          },
          status: 'running',
          idempotencyKey: input.idempotencyKey,
        })
        .onConflictDoNothing()
        .returning({ id: schema.toolCalls.id })

      if (inserted === undefined) {
        return { kind: 'race' as const }
      }
      return { kind: 'inserted' as const, id: inserted.id }
    })

    if (outcome.kind === 'existing') {
      if (outcome.row.status === 'success' && outcome.row.result !== null) {
        const r = outcome.row.result as { messageId: string; telegramMessageId: number }
        cachedResult = r
        toolCallId = outcome.row.id
      } else {
        return Err({
          kind: 'duplicate_pending',
          message: `tool_call idempotency_key ${input.idempotencyKey} already exists (status=${outcome.row.status})`,
        })
      }
    } else if (outcome.kind === 'race') {
      return Err({
        kind: 'duplicate_pending',
        message: `concurrent caller claimed idempotency_key ${input.idempotencyKey}`,
      })
    } else {
      toolCallId = outcome.id
    }
  } catch (err) {
    return Err(toDbError(err))
  }

  if (cachedResult !== null) {
    return Ok({
      toolCallId,
      messageId: cachedResult.messageId,
      telegramMessageId: cachedResult.telegramMessageId,
      cached: true,
    })
  }

  // 4. Call Telegram (outside the transaction — no DB locks held).
  const sendResult = await sendTelegramMessage(deps.bot, {
    chatId: threadRow.channelExternalId,
    text: input.text,
    ...(input.replyMarkup !== undefined && { replyMarkup: input.replyMarkup }),
  })
  const latencyMs = Date.now() - start

  if (!sendResult.ok) {
    try {
      await withTenant(deps.db, ctx, async (tx) => {
        await tx
          .update(schema.toolCalls)
          .set({
            status: 'error',
            error: `${sendResult.error.kind}: ${sendResult.error.message}`,
            latencyMs,
            completedAt: new Date(),
          })
          .where(eq(schema.toolCalls.id, toolCallId))
      })
    } catch {
      // Best-effort — if this update fails the row stays in 'running' which
      // ops will flag via a stuck-tool-calls query. Still return the
      // telegram error to the caller.
    }
    return Err({
      kind: 'telegram_error',
      message: sendResult.error.message,
      telegramErrorKind: sendResult.error.kind,
      cause: sendResult.error,
    })
  }

  // 5. Persist outbound message + mark tool_call success.
  const telegramMessageId = sendResult.value.messageId
  const messageIdempotencyKey = `tg:out:${threadRow.channelExternalId}:${telegramMessageId}`

  try {
    const messageId = await withTenant(deps.db, ctx, async (tx) => {
      const [messageRow] = await tx
        .insert(schema.messages)
        .values({
          tenantId: input.tenantId,
          threadId: input.threadId,
          authorKind: 'agent',
          direction: 'outbound',
          content: input.text,
          agentRunId: input.agentRunId,
          toolCallId,
          externalMessageId: String(telegramMessageId),
          idempotencyKey: messageIdempotencyKey,
        })
        .onConflictDoNothing()
        .returning({ id: schema.messages.id })

      if (messageRow === undefined) {
        throw new Error('outbound message insert returned no row (idempotency conflict)')
      }

      await tx
        .update(schema.threads)
        .set({ lastMessageAt: new Date() })
        .where(eq(schema.threads.id, input.threadId))

      await tx
        .update(schema.toolCalls)
        .set({
          status: 'success',
          result: { messageId: messageRow.id, telegramMessageId },
          latencyMs,
          completedAt: new Date(),
        })
        .where(eq(schema.toolCalls.id, toolCallId))

      return messageRow.id
    })

    return Ok({
      toolCallId,
      messageId,
      telegramMessageId,
      cached: false,
    })
  } catch (err) {
    return Err(toDbError(err))
  }
}

const toDbError = (err: unknown): SendMessageError => ({
  kind: 'db_error',
  message: err instanceof Error ? err.message : String(err),
  cause: err,
})
