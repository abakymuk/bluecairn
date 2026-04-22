import type { Update } from 'grammy/types'
import { z } from 'zod'
import type {
  CallbackQueryPayload,
  InboundTelegramMessage,
  ParsedApprovalCallback,
} from './types.js'

/**
 * Zod schema validating the subset of a Telegram Update we consume for
 * inbound text messages. Rejecting unexpected shapes here means callers can
 * trust the data without defensive coding.
 */
const inboundMessageUpdateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      message_id: z.number().int(),
      date: z.number().int(),
      chat: z.object({
        id: z.number().int(),
      }),
      from: z
        .object({
          id: z.number().int(),
          first_name: z.string().optional(),
          last_name: z.string().optional(),
          username: z.string().optional(),
        })
        .optional(),
      text: z.string().optional(),
    })
    .optional(),
})

export type TelegramUpdate = Update

/**
 * Parse a raw webhook body (already JSON-decoded) into a typed Update.
 * Throws on malformed input so the caller can return 400.
 */
export const parseUpdate = (body: unknown): TelegramUpdate => {
  // The Zod schema above covers only what we care about. Accept the body as
  // long as it has a numeric update_id; grammy's Update type is a union so
  // we cast after minimum validation.
  const shape = z.object({ update_id: z.number().int() }).safeParse(body)
  if (!shape.success) {
    throw new Error(`Telegram webhook body is not a valid Update: ${shape.error.message}`)
  }
  return body as TelegramUpdate
}

/**
 * Zod schema for the subset of a `callback_query` update we handle (inline
 * button taps, BLU-24). Anything that doesn't shape-match returns `null`
 * from the extractor so the webhook can 200-ignore unknown update types
 * the same way it does for photos / edits / inline queries.
 */
const callbackQueryUpdateSchema = z.object({
  update_id: z.number().int(),
  callback_query: z.object({
    id: z.string().min(1),
    data: z.string().min(1),
    from: z.object({
      id: z.number().int(),
    }),
    message: z
      .object({
        message_id: z.number().int(),
        chat: z.object({
          id: z.number().int(),
        }),
      })
      .optional(),
    chat_instance: z.string().optional(),
  }),
})

/**
 * Approval callback_data shape: `approval:<uuid>:<decision>`.
 *
 * The UUID regex mirrors Postgres `uuid` canonical form (8-4-4-4-12 hex).
 * Case-insensitive because Telegram passes `callback_data` through verbatim
 * and we'd rather accept what we emitted.
 */
const APPROVAL_CALLBACK_RE =
  /^approval:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(approved|rejected)$/i

/**
 * Extract an inbound text message in our normalized shape.
 *
 * Returns `null` if the update is not something we want to persist yet — for
 * example edits, callback queries, inline queries, photos without text, etc.
 * Those unsupported shapes are fine to acknowledge with a 200 and ignore.
 */
export const extractInboundMessage = (
  update: TelegramUpdate,
): InboundTelegramMessage | null => {
  const parsed = inboundMessageUpdateSchema.safeParse(update)
  if (!parsed.success || !parsed.data.message) return null

  const { message } = parsed.data
  if (!message.text) return null // skip photos/stickers/etc. for BLU-13 scope

  const chatId = String(message.chat.id)
  const externalMessageId = String(message.message_id)
  const from = message.from

  const fromParts = [from?.first_name, from?.last_name].filter(Boolean).join(' ').trim()
  const fromDisplayName = fromParts || from?.username || null

  return {
    idempotencyKey: `tg:${chatId}:${externalMessageId}`,
    chatId,
    externalMessageId,
    fromTelegramUserId: from ? String(from.id) : '',
    fromDisplayName,
    text: message.text,
    sentAt: new Date(message.date * 1000),
  }
}

/**
 * Extract an inline-button tap (`callback_query`) in our normalized shape.
 *
 * Returns `null` if the update is not a callback_query or doesn't pass the
 * Zod shape check. The webhook is expected to treat that as an unsupported
 * update type and ack with 200.
 *
 * Semantic validation of `data` (e.g. `approval:<uuid>:<decision>`) is
 * intentionally separate — see `parseApprovalCallbackData`. The webhook
 * calls both and audits on data-shape failure.
 */
export const extractCallbackQuery = (update: TelegramUpdate): CallbackQueryPayload | null => {
  const parsed = callbackQueryUpdateSchema.safeParse(update)
  if (!parsed.success) return null

  const cq = parsed.data.callback_query
  const chatId = cq.message ? String(cq.message.chat.id) : ''
  if (chatId === '') return null // buttons must belong to a chat for channel lookup

  return {
    callbackQueryId: cq.id,
    data: cq.data,
    fromTelegramUserId: cq.from.id,
    chatId,
    originalMessageId: cq.message ? String(cq.message.message_id) : null,
  }
}

/**
 * Parse `approval:<uuid>:<decision>` callback_data into an approval request
 * reference. `null` signals a shape mismatch — the webhook writes an
 * `audit_log` row (`event_kind='callback.malformed'`) and 200s.
 *
 * Semantic existence of `approval_request_id` is NOT checked here; that is
 * BLU-25's `action.gate` responsibility. Webhook stays thin per ADR and per
 * Telegram's 5s budget.
 */
export const parseApprovalCallbackData = (data: string): ParsedApprovalCallback | null => {
  const match = APPROVAL_CALLBACK_RE.exec(data)
  if (!match) return null

  const approvalRequestId = match[1]?.toLowerCase()
  const decisionRaw = match[2]?.toLowerCase()
  if (approvalRequestId === undefined || decisionRaw === undefined) return null
  if (decisionRaw !== 'approved' && decisionRaw !== 'rejected') return null

  return {
    approvalRequestId,
    decision: decisionRaw,
  }
}
