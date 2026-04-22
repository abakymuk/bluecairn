/**
 * Tools Concierge is permitted to use.
 *
 * M1: only `comms.send_message` — Concierge replies in-thread to ack the
 * operator. Any outbound to Telegram goes through this one tool.
 *
 * The list is declarative — actual dispatch of tool calls happens via the
 * approval gate (BLU-25) consuming `action.requested` events that the
 * concierge run function emits.
 */

export const tools = [
  {
    mcpServer: 'comms' as const,
    toolName: 'send_message' as const,
  },
] as const

export type ConciergeToolRef = (typeof tools)[number]
