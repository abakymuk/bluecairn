import { describe, it, expect } from 'vitest'
import {
  ActionRequestedDataSchema,
  AgentRunRequestedDataSchema,
  ApprovalDecisionRecordedDataSchema,
  DebugPingDataSchema,
  ThreadMessageReceivedDataSchema,
} from '../src/events.js'

const uuid = (suffix: string) =>
  `00000000-0000-4000-a000-${suffix.padStart(12, '0')}`

describe('event schemas', () => {
  it('thread.message.received accepts a valid payload', () => {
    const r = ThreadMessageReceivedDataSchema.safeParse({
      tenant_id: uuid('1'),
      correlation_id: uuid('2'),
      idempotency_key: 'tg:123:456',
      thread_id: uuid('3'),
      message_id: uuid('4'),
      channel_id: uuid('5'),
    })
    expect(r.success).toBe(true)
  })

  it('thread.message.received rejects non-uuid tenant_id', () => {
    const r = ThreadMessageReceivedDataSchema.safeParse({
      tenant_id: 'not-a-uuid',
      correlation_id: uuid('2'),
      idempotency_key: 'k',
      thread_id: uuid('3'),
      message_id: uuid('4'),
      channel_id: uuid('5'),
    })
    expect(r.success).toBe(false)
  })

  it('agent.run.requested rejects empty agent_code', () => {
    const r = AgentRunRequestedDataSchema.safeParse({
      tenant_id: uuid('1'),
      correlation_id: uuid('2'),
      idempotency_key: 'k',
      run_id: uuid('3'),
      agent_code: '',
      thread_id: uuid('4'),
      message_id: uuid('5'),
    })
    expect(r.success).toBe(false)
  })

  it('action.requested accepts all three policy_outcome values', () => {
    for (const outcome of ['auto', 'approval_required', 'notify_after'] as const) {
      const r = ActionRequestedDataSchema.safeParse({
        tenant_id: uuid('1'),
        correlation_id: uuid('2'),
        idempotency_key: 'k',
        action_id: uuid('3'),
        agent_run_id: uuid('4'),
        kind: 'send_message',
        payload: { text: 'hi' },
        policy_outcome: outcome,
      })
      expect(r.success).toBe(true)
    }
  })

  it('approval.decision.recorded rejects an unknown decision', () => {
    const r = ApprovalDecisionRecordedDataSchema.safeParse({
      tenant_id: uuid('1'),
      correlation_id: uuid('2'),
      idempotency_key: 'k',
      approval_request_id: uuid('3'),
      decision: 'maybe',
      user_telegram_id: 68866349,
    })
    expect(r.success).toBe(false)
  })

  it('debug.ping accepts a minimal payload', () => {
    const r = DebugPingDataSchema.safeParse({ ping_id: 'smoke' })
    expect(r.success).toBe(true)
  })
})
