import { runConciergeEval } from '@bluecairn/agents'
import type { Result } from '@bluecairn/core'
import type { LlmCallOutput, LlmError, LlmMetadata } from '@bluecairn/agents'

/**
 * Agent registry for the eval runner (ADR-0011).
 *
 * Each entry is a self-contained descriptor for one agent: the code used
 * in `bun run eval <agent-code>`, the signoff persona used by the
 * `ends_with_signoff` + `max_sentences` assertions, and a `call` function
 * that accepts an operator input + metadata and returns the same
 * `Result<LlmCallOutput, LlmError>` the production wrapper returns.
 *
 * Adding a new agent (Sofia in M2) = add a new entry. One-way dependency
 * is preserved: this file imports FROM `@bluecairn/agents`; `agents` never
 * imports from `@bluecairn/evals`.
 */

export interface AgentRunner {
  code: string
  signoffPersona: string
  call: (args: {
    input: string
    metadata: LlmMetadata
  }) => Promise<Result<LlmCallOutput, LlmError>>
}

const REGISTRY: Record<string, AgentRunner> = {
  concierge: {
    code: 'concierge',
    signoffPersona: 'Concierge',
    call: async ({ input, metadata }) => runConciergeEval({ input, metadata }),
  },
}

export const getAgentRunner = (code: string): AgentRunner | undefined => REGISTRY[code]

export const listAgentCodes = (): string[] => Object.keys(REGISTRY).sort()
