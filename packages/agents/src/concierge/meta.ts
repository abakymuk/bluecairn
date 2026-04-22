/**
 * Concierge agent metadata (BLU-23).
 *
 * The catchall M1 agent — acknowledges every message, defers domain work
 * to future specialists (Sofia, Marco, Dana, Iris). This module exports
 * the declarative bits (code, model, tools list, policies, guardrails);
 * the actual run function lives in `apps/workers/src/functions/agent-concierge-run.ts`.
 */

import { policies } from './policies.js'
import { guardrails } from './guardrails.js'
import { tools } from './tools.js'

export const conciergeMeta = {
  code: 'concierge' as const,
  personaName: 'Concierge',
  displayScope: 'Catchall',
  model: 'claude-haiku-4-5-20251001' as const,
  tools,
  policies,
  guardrails,
} as const

export type ConciergeMeta = typeof conciergeMeta
