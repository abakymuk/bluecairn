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
