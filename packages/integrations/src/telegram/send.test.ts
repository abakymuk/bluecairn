import { isErr, isOk } from '@bluecairn/core'
import type { Bot } from 'grammy'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTelegramBot } from './bot.js'
import { answerTelegramCallbackQuery, sendTelegramMessage } from './send.js'

const mockApiSendMessage = vi.fn()
const mockApiAnswerCallbackQuery = vi.fn()
const fakeBot = {
  api: {
    sendMessage: mockApiSendMessage,
    answerCallbackQuery: mockApiAnswerCallbackQuery,
  },
} as unknown as Bot

beforeEach(() => {
  mockApiSendMessage.mockReset()
  mockApiAnswerCallbackQuery.mockReset()
})

describe('sendTelegramMessage', () => {
  test('happy path: returns Ok with message id', async () => {
    mockApiSendMessage.mockResolvedValueOnce({ message_id: 42 })

    const result = await sendTelegramMessage(fakeBot, {
      chatId: 123,
      text: 'hi',
    })

    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.messageId).toBe(42)
    expect(mockApiSendMessage).toHaveBeenCalledWith(123, 'hi', {})
  })

  test('string chatId is coerced to number', async () => {
    mockApiSendMessage.mockResolvedValueOnce({ message_id: 7 })

    const result = await sendTelegramMessage(fakeBot, {
      chatId: '-1001234567890',
      text: 'hi',
    })

    expect(isOk(result)).toBe(true)
    expect(mockApiSendMessage).toHaveBeenCalledWith(-1001234567890, 'hi', {})
  })

  test('reply_markup + parse_mode forwarded as other options', async () => {
    mockApiSendMessage.mockResolvedValueOnce({ message_id: 1 })

    await sendTelegramMessage(fakeBot, {
      chatId: 1,
      text: 'approve?',
      replyMarkup: {
        inline_keyboard: [
          [
            { text: 'Approve', callback_data: 'approval:abc:approved' },
            { text: 'Reject', callback_data: 'approval:abc:rejected' },
          ],
        ],
      },
      parseMode: 'MarkdownV2',
    })

    expect(mockApiSendMessage).toHaveBeenCalledWith(1, 'approve?', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Approve', callback_data: 'approval:abc:approved' },
            { text: 'Reject', callback_data: 'approval:abc:rejected' },
          ],
        ],
      },
      parse_mode: 'MarkdownV2',
    })
  })

  test('invalid chat id (NaN) returns invalid_chat without calling grammY', async () => {
    const result = await sendTelegramMessage(fakeBot, {
      chatId: 'not-a-number',
      text: 'x',
    })

    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error.kind).toBe('invalid_chat')
    expect(mockApiSendMessage).not.toHaveBeenCalled()
  })

  test('429 rate_limit classified with retry_after', async () => {
    mockApiSendMessage.mockRejectedValueOnce({
      error_code: 429,
      description: 'Too Many Requests: retry after 30',
      parameters: { retry_after: 30 },
    })

    const result = await sendTelegramMessage(fakeBot, { chatId: 1, text: 'x' })

    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error.kind).toBe('rate_limit')
    expect(result.error.retryAfterSec).toBe(30)
  })

  test('403 classified as forbidden (bot blocked)', async () => {
    mockApiSendMessage.mockRejectedValueOnce({
      error_code: 403,
      description: 'Forbidden: bot was blocked by the user',
    })

    const result = await sendTelegramMessage(fakeBot, { chatId: 1, text: 'x' })

    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error.kind).toBe('forbidden')
  })

  test('400 "chat not found" classified as invalid_chat', async () => {
    mockApiSendMessage.mockRejectedValueOnce({
      error_code: 400,
      description: 'Bad Request: chat not found',
    })

    const result = await sendTelegramMessage(fakeBot, { chatId: 1, text: 'x' })

    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error.kind).toBe('invalid_chat')
  })

  test('400 other → invalid_payload', async () => {
    mockApiSendMessage.mockRejectedValueOnce({
      error_code: 400,
      description: 'Bad Request: message is empty',
    })

    const result = await sendTelegramMessage(fakeBot, { chatId: 1, text: 'x' })

    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error.kind).toBe('invalid_payload')
  })

  test('unknown error → upstream', async () => {
    mockApiSendMessage.mockRejectedValueOnce(new Error('boom'))

    const result = await sendTelegramMessage(fakeBot, { chatId: 1, text: 'x' })

    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error.kind).toBe('upstream')
  })
})

describe('answerTelegramCallbackQuery', () => {
  test('happy path: returns Ok(undefined)', async () => {
    mockApiAnswerCallbackQuery.mockResolvedValueOnce(true)

    const result = await answerTelegramCallbackQuery(fakeBot, 'cb-123')

    expect(isOk(result)).toBe(true)
    expect(mockApiAnswerCallbackQuery).toHaveBeenCalledWith('cb-123')
  })

  test('400 from Telegram classified as invalid_payload', async () => {
    mockApiAnswerCallbackQuery.mockRejectedValueOnce({
      error_code: 400,
      description: 'Bad Request: query is too old',
    })

    const result = await answerTelegramCallbackQuery(fakeBot, 'cb-stale')

    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error.kind).toBe('invalid_payload')
  })

  test('unknown error → upstream', async () => {
    mockApiAnswerCallbackQuery.mockRejectedValueOnce(new Error('boom'))

    const result = await answerTelegramCallbackQuery(fakeBot, 'cb')

    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error.kind).toBe('upstream')
  })
})

describe('createTelegramBot', () => {
  test('returns a grammY Bot instance with the expected api surface', () => {
    const botInstance = createTelegramBot('12345:fake-token-for-test')
    // grammY's Bot exposes `.api.sendMessage` / `.api.answerCallbackQuery`
    // without any network I/O until a call is actually made — enough for a
    // smoke assertion that the factory wires up grammY correctly.
    expect(typeof botInstance.api.sendMessage).toBe('function')
    expect(typeof botInstance.api.answerCallbackQuery).toBe('function')
  })
})
