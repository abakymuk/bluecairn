import { Err, Ok, type Result } from '@bluecairn/core'
import type { Bot } from 'grammy'

/**
 * Thin grammY wrapper for outbound Telegram messages. Zero business
 * logic — just Bot.api.sendMessage with typed args and a normalized
 * `Result<TelegramSendOutput, TelegramSendError>` return so callers
 * (Comms MCP, BLU-21) don't have to pattern-match grammY exceptions.
 */

export interface TelegramInlineKeyboardButton {
  text: string
  // `| undefined` is intentional (not just `?:`) so Zod-parsed optionals,
  // which are `string | undefined`, remain assignable under
  // `exactOptionalPropertyTypes: true`.
  callback_data?: string | undefined
  url?: string | undefined
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][]
}

export interface TelegramSendArgs {
  chatId: number | string
  text: string
  replyMarkup?: TelegramInlineKeyboardMarkup
  parseMode?: 'MarkdownV2' | 'HTML'
}

export interface TelegramSendOutput {
  messageId: number
}

export type TelegramErrorKind =
  | 'rate_limit'
  | 'forbidden'
  | 'invalid_chat'
  | 'invalid_payload'
  | 'timeout'
  | 'upstream'

export interface TelegramSendError {
  kind: TelegramErrorKind
  message: string
  retryAfterSec?: number
  cause?: unknown
}

interface GrammyErrorShape {
  error_code?: number
  description?: string
  parameters?: { retry_after?: number }
}

const classifyTelegramError = (err: unknown): TelegramSendError => {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'description' in err
        ? String((err as GrammyErrorShape).description)
        : String(err)
  const code = (err as GrammyErrorShape | undefined)?.error_code
  const retryAfter = (err as GrammyErrorShape | undefined)?.parameters?.retry_after

  if (code === 429) {
    const base: TelegramSendError = { kind: 'rate_limit', message, cause: err }
    return retryAfter !== undefined ? { ...base, retryAfterSec: retryAfter } : base
  }
  if (code === 403) return { kind: 'forbidden', message, cause: err }
  if (code === 400) {
    const lower = message.toLowerCase()
    if (lower.includes('chat not found')) return { kind: 'invalid_chat', message, cause: err }
    return { kind: 'invalid_payload', message, cause: err }
  }
  if (message.toLowerCase().includes('timeout')) {
    return { kind: 'timeout', message, cause: err }
  }
  return { kind: 'upstream', message, cause: err }
}

/**
 * Dismiss the "loading" spinner on an inline-button tap by replying to
 * Telegram's `callback_query` with `answerCallbackQuery`. BLU-24 invokes
 * this fire-and-forget from the webhook (bounded by a 2s race so we stay
 * inside Telegram's 5s webhook budget). Text is intentionally empty — the
 * user-facing feedback comes from the follow-up message that BLU-25's
 * `action.gate` posts after the decision is recorded.
 *
 * `answerCallbackQuery` is idempotent on Telegram's side: replaying with
 * the same `callbackQueryId` returns a benign error that we classify the
 * same way as send-message failures.
 */
export const answerTelegramCallbackQuery = async (
  bot: Bot,
  callbackQueryId: string,
): Promise<Result<void, TelegramSendError>> => {
  try {
    await bot.api.answerCallbackQuery(callbackQueryId)
    return Ok(undefined)
  } catch (err) {
    return Err(classifyTelegramError(err))
  }
}

export const sendTelegramMessage = async (
  bot: Bot,
  args: TelegramSendArgs,
): Promise<Result<TelegramSendOutput, TelegramSendError>> => {
  const chatId = typeof args.chatId === 'string' ? Number.parseInt(args.chatId, 10) : args.chatId
  if (!Number.isFinite(chatId)) {
    return Err({ kind: 'invalid_chat', message: `invalid chat id: ${args.chatId}` })
  }

  // grammY types `InlineKeyboardButton` as a strict discriminated union that
  // requires exactly one of url/callback_data/etc. Our surface type is more
  // permissive because agents produce either url-buttons or callback-buttons
  // at runtime — cast at the boundary; grammY forwards the payload to
  // Telegram verbatim, which validates structurally on its side.
  const other = {
    ...(args.replyMarkup !== undefined && { reply_markup: args.replyMarkup }),
    ...(args.parseMode !== undefined && { parse_mode: args.parseMode }),
  } as Parameters<Bot['api']['sendMessage']>[2]

  try {
    const msg = await bot.api.sendMessage(chatId, args.text, other)
    return Ok({ messageId: msg.message_id })
  } catch (err) {
    return Err(classifyTelegramError(err))
  }
}
