/**
 * Narrow, stable types we expose to the rest of the codebase.
 *
 * Per ADR-0003, agents and app code NEVER import grammy directly — only the
 * shapes defined here. If Telegram's payload changes or we swap SDKs, the
 * blast radius stays inside this package.
 */

export interface InboundTelegramMessage {
  /** Stable idempotency key: `tg:<chat_id>:<message_id>`. */
  readonly idempotencyKey: string
  /** Telegram chat_id (stored in `channels.external_id`). */
  readonly chatId: string
  /** Telegram message_id (stored in `messages.external_message_id`). */
  readonly externalMessageId: string
  /** Sender's Telegram user_id (for audit/debug; not used for auth). */
  readonly fromTelegramUserId: string
  /** Sender's display name if available. */
  readonly fromDisplayName: string | null
  /** Message text content. Null for unsupported types (photo-only, etc.). */
  readonly text: string | null
  /** When Telegram server saw the message (UTC). */
  readonly sentAt: Date
}

/**
 * Normalized shape of a Telegram `callback_query` update — the payload sent
 * when a user taps an inline-keyboard button. The webhook handler branches
 * on `InboundTelegramMessage | CallbackQueryPayload | null` to decide what
 * to do with an update.
 */
export interface CallbackQueryPayload {
  /** Telegram's opaque callback_query id. Idempotency unit for this update. */
  readonly callbackQueryId: string
  /** Raw button `callback_data` string (app-defined; validated downstream). */
  readonly data: string
  /** Sender Telegram user id (carried in the emitted event for audit). */
  readonly fromTelegramUserId: number
  /** chat.id of the originating message (used for channel → tenant lookup). */
  readonly chatId: string
  /** `message.message_id` the buttons were attached to, when present. */
  readonly originalMessageId: string | null
}

/**
 * Parsed `approval:<uuid>:<decision>` callback data. Produced by
 * `parseApprovalCallbackData`; `null` means the string did not match the
 * expected shape (webhook writes an audit row and ignores).
 */
export interface ParsedApprovalCallback {
  readonly approvalRequestId: string
  readonly decision: 'approved' | 'rejected'
}
