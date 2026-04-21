import { EventSchemas } from 'inngest'
import { z } from 'zod'

/**
 * M1 event schemas for the durable execution layer (ADR-0004).
 *
 * Naming convention: `domain.action.subject` — see ADR-0004 "Rules this
 * decision creates". Every event payload carries `tenant_id`, `correlation_id`,
 * and `idempotency_key` so tenant context is never inferred and re-delivery
 * is a no-op.
 *
 * Raw Zod schemas are exported for direct parsing (e.g. in webhook handlers).
 * The composed `eventSchemas` object is what the Inngest client consumes to
 * produce typed `.send()` / trigger signatures.
 */

const BaseEventFields = {
  tenant_id: z.string().uuid(),
  correlation_id: z.string().uuid(),
  idempotency_key: z.string().min(1),
}

export const ThreadMessageReceivedDataSchema = z.object({
  ...BaseEventFields,
  thread_id: z.string().uuid(),
  message_id: z.string().uuid(),
  channel_id: z.string().uuid(),
})

export const AgentRunRequestedDataSchema = z.object({
  ...BaseEventFields,
  run_id: z.string().uuid(),
  agent_code: z.string().min(1),
  thread_id: z.string().uuid(),
  message_id: z.string().uuid(),
})

export const ActionRequestedDataSchema = z.object({
  ...BaseEventFields,
  action_id: z.string().uuid(),
  agent_run_id: z.string().uuid(),
  kind: z.enum(['send_message']),
  payload: z.record(z.unknown()),
  policy_outcome: z.enum(['auto', 'approval_required', 'notify_after']),
})

export const ApprovalDecisionRecordedDataSchema = z.object({
  ...BaseEventFields,
  approval_request_id: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  user_telegram_id: z.number().int(),
})

// Debug / health-check event — unscoped, used by the hello_world stub in
// M1-1 to prove Inngest registration end-to-end.
export const DebugPingDataSchema = z.object({
  ping_id: z.string().min(1),
  tenant_id: z.string().uuid().optional(),
})

export type ThreadMessageReceivedData = z.infer<typeof ThreadMessageReceivedDataSchema>
export type AgentRunRequestedData = z.infer<typeof AgentRunRequestedDataSchema>
export type ActionRequestedData = z.infer<typeof ActionRequestedDataSchema>
export type ApprovalDecisionRecordedData = z.infer<typeof ApprovalDecisionRecordedDataSchema>
export type DebugPingData = z.infer<typeof DebugPingDataSchema>

export const eventSchemas = new EventSchemas().fromZod({
  'thread.message.received': { data: ThreadMessageReceivedDataSchema },
  'agent.run.requested': { data: AgentRunRequestedDataSchema },
  'action.requested': { data: ActionRequestedDataSchema },
  'approval.decision.recorded': { data: ApprovalDecisionRecordedDataSchema },
  'debug.ping': { data: DebugPingDataSchema },
})
