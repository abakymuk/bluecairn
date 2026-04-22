/**
 * Concierge default policies.
 *
 * For M1, every action Concierge proposes goes through the approval gate
 * (BLU-25). The operator (Vlad/Nick via Telegram inline buttons) explicitly
 * approves each outbound before it's sent. Autonomy is earned per-tenant
 * per-action later (ROADMAP Month 4+).
 */

export const policies = {
  send_message: 'approval_required' as const,
} as const

export type CongiergePolicy = typeof policies
