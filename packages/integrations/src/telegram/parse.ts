import type { Update } from 'grammy/types'
import { z } from 'zod'
import type { InboundTelegramMessage } from './types.js'

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
