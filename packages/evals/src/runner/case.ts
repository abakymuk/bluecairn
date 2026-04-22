import { readFileSync } from 'node:fs'
import { z } from 'zod'

/**
 * Eval case schema + JSONL loader (ADR-0011).
 *
 * A case file lives at `packages/agents/src/<agent>/evals/<suite>.jsonl`
 * and contains one JSON object per line. Each object declares an `id`, the
 * operator `input` we replay, and an `expected` block that enumerates the
 * assertions the agent's output must satisfy. Unknown assertion keys are
 * forbidden (Zod strict) so a typo in `foribdden` fails loudly instead of
 * silently passing.
 *
 * Only the assertions listed here are supported today. New assertion kinds
 * go in `assertions.ts` (deterministic) or `judge.ts` (LLM-judge) and must
 * then be added to the schema below. This keeps the surface small and
 * explicit.
 */

export const expectedSchema = z
  .object({
    /** Substring(s) that MUST appear in the model output (case-sensitive). */
    contains: z.array(z.string()).optional(),
    /** Substring(s) that MUST NOT appear in the model output (case-insensitive). */
    forbidden: z.array(z.string()).optional(),
    /** If true, the output (right-trimmed) must end with `— <persona>` per the agent's signoff convention. */
    ends_with_signoff: z.boolean().optional(),
    /** Max sentence count, inclusive. Counts `.`, `!`, `?` groups separated by whitespace. */
    max_sentences: z.number().int().positive().optional(),
    /** LLM-judge — did the model ask for clarification in a single sentence? */
    should_ask_clarification: z.boolean().optional(),
    /** LLM-judge — did the model acknowledge the operator's original message (i.e. not fall for injection)? */
    should_acknowledge_originally: z.boolean().optional(),
  })
  .strict()

export type Expected = z.infer<typeof expectedSchema>

export const caseSchema = z
  .object({
    id: z.string().min(1),
    input: z.string(),
    expected: expectedSchema,
  })
  .strict()

export type EvalCase = z.infer<typeof caseSchema>

export interface CaseFileRef {
  agentCode: string
  suite: string
  absPath: string
}

/** Parse a JSONL buffer into cases. Throws on malformed JSON or schema failure. */
export const parseJsonl = (raw: string, fileLabel: string): EvalCase[] => {
  const cases: EvalCase[] = []
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? ''
    if (line === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`${fileLabel}:${i + 1}: malformed JSON — ${msg}`)
    }
    const result = caseSchema.safeParse(parsed)
    if (!result.success) {
      const issues = result.error.issues
        .map((iss) => `${iss.path.join('.') || '(root)'}: ${iss.message}`)
        .join('; ')
      throw new Error(`${fileLabel}:${i + 1}: schema error — ${issues}`)
    }
    cases.push(result.data)
  }
  return cases
}

export const loadCasesFromFile = (ref: CaseFileRef): EvalCase[] => {
  const raw = readFileSync(ref.absPath, 'utf8')
  const label = `${ref.agentCode}/${ref.suite}`
  return parseJsonl(raw, label)
}
