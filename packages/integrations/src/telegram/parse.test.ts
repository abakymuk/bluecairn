import { describe, expect, test } from 'vitest'
import {
  extractCallbackQuery,
  extractInboundMessage,
  parseApprovalCallbackData,
  parseUpdate,
} from './parse.js'

/**
 * Unit tests for the BLU-24 callback-query parsers. The inbound-message
 * path is already covered by the integration tests in apps/api; here we
 * cover the units that ship new to BLU-24 plus a regression on the text
 * path through `parseUpdate` so the shared Zod changes don't surprise us.
 */

const validApprovalData = (decision: 'approved' | 'rejected') =>
  `approval:11111111-2222-3333-4444-555555555555:${decision}`

const makeCallbackUpdate = (overrides: {
  id?: string
  data?: string
  fromId?: number
  chatId?: number | null
  messageId?: number | null
}) => {
  const message =
    overrides.chatId === null
      ? undefined
      : {
          message_id: overrides.messageId ?? 42,
          chat: { id: overrides.chatId ?? -100777 },
        }
  return {
    update_id: 1,
    callback_query: {
      id: overrides.id ?? 'cb-xyz',
      data: overrides.data ?? validApprovalData('approved'),
      from: { id: overrides.fromId ?? 99_999 },
      ...(message !== undefined && { message }),
      chat_instance: 'ci-1',
    },
  }
}

describe('extractCallbackQuery', () => {
  test('happy path — returns normalized payload', () => {
    const update = parseUpdate(makeCallbackUpdate({}))
    const result = extractCallbackQuery(update)

    expect(result).not.toBeNull()
    if (!result) return
    expect(result.callbackQueryId).toBe('cb-xyz')
    expect(result.data).toBe(validApprovalData('approved'))
    expect(result.fromTelegramUserId).toBe(99_999)
    expect(result.chatId).toBe('-100777')
    expect(result.originalMessageId).toBe('42')
  })

  test('returns null for a non-callback update', () => {
    const update = parseUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -100111 },
        from: { id: 1 },
        text: 'hello',
      },
    })
    expect(extractCallbackQuery(update)).toBeNull()
  })

  test('returns null when callback_query lacks an originating message', () => {
    const update = parseUpdate(makeCallbackUpdate({ chatId: null }))
    expect(extractCallbackQuery(update)).toBeNull()
  })

  test('returns null when from.id is missing (webhook can 200-ignore)', () => {
    // We construct the malformed shape by hand — bypasses the typed helper.
    const update = parseUpdate({
      update_id: 1,
      callback_query: {
        id: 'cb1',
        data: 'approval:x',
        chat_instance: 'ci',
      },
    })
    expect(extractCallbackQuery(update)).toBeNull()
  })
})

describe('parseApprovalCallbackData', () => {
  test('happy path — approved', () => {
    const parsed = parseApprovalCallbackData(validApprovalData('approved'))
    expect(parsed).toEqual({
      approvalRequestId: '11111111-2222-3333-4444-555555555555',
      decision: 'approved',
    })
  })

  test('happy path — rejected', () => {
    const parsed = parseApprovalCallbackData(validApprovalData('rejected'))
    expect(parsed?.decision).toBe('rejected')
  })

  test('uppercase decision + uppercase uuid normalizes to lowercase', () => {
    const data = 'approval:AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE:APPROVED'
    const parsed = parseApprovalCallbackData(data)
    expect(parsed).toEqual({
      approvalRequestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      decision: 'approved',
    })
  })

  test('wrong prefix returns null', () => {
    expect(
      parseApprovalCallbackData('something:11111111-2222-3333-4444-555555555555:approved'),
    ).toBeNull()
  })

  test('malformed uuid returns null', () => {
    expect(parseApprovalCallbackData('approval:not-a-uuid:approved')).toBeNull()
  })

  test('unknown decision returns null', () => {
    expect(
      parseApprovalCallbackData('approval:11111111-2222-3333-4444-555555555555:maybe'),
    ).toBeNull()
  })

  test('trailing junk returns null (strict anchor)', () => {
    expect(
      parseApprovalCallbackData('approval:11111111-2222-3333-4444-555555555555:approved:extra'),
    ).toBeNull()
  })

  test('empty string returns null', () => {
    expect(parseApprovalCallbackData('')).toBeNull()
  })
})

describe('extractInboundMessage — regression on shared schema', () => {
  test('unchanged happy path still returns a message', () => {
    const update = parseUpdate({
      update_id: 9,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 5 },
        from: { id: 7, first_name: 'Vlad' },
        text: 'yo',
      },
    })
    const msg = extractInboundMessage(update)
    expect(msg?.text).toBe('yo')
  })
})
