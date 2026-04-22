import { randomUUID } from 'node:crypto'

import { runDeterministicChecks, type CheckResult } from './assertions.js'
import { loadCasesFromFile, type CaseFileRef, type EvalCase } from './case.js'
import { runJudgeChecks } from './judge.js'
import type { AgentRunner } from './registry.js'

/**
 * Per-case execution (ADR-0011).
 *
 * Execution shape:
 *   1. Call the agent's `evalCall` with the case input + tagged
 *      `LlmMetadata` (eval = `<code>/<suite>`, caseId = `<case.id>`).
 *   2. If the LLM call failed, record a single synthetic check result
 *      and skip assertions — no output to assert against.
 *   3. Run deterministic assertions over the output.
 *   4. Run LLM-judge assertions over the output (Haiku).
 *   5. Aggregate into `CaseResult`.
 *
 * The per-run tenant id is a fixed sentinel UUID — eval runs don't touch
 * the DB, but the metadata.tenantId slot must be populated for Langfuse.
 * Using the sentinel means eval traces are trivially filterable out of
 * real-tenant dashboards. `correlationId` rotates per-case so each case's
 * spans form their own trace tree.
 */

export const EVAL_TENANT_ID = '00000000-0000-0000-0000-00000000eeee'

export interface CaseResult {
  caseId: string
  suite: string
  agentCode: string
  durationMs: number
  llmOk: boolean
  /** Output text, or empty string when the LLM call failed. */
  output: string
  /** The error detail from the LLM wrapper, if any. */
  llmError?: string
  checks: CheckResult[]
  /** True only when the LLM call succeeded AND every check passed. */
  passed: boolean
  /** Langfuse trace id for the main agent call (empty if tracing disabled). */
  langfuseTraceId: string
  tokens?: { input: number; output: number; total: number }
  costUsd?: number
}

export interface RunCaseArgs {
  runner: AgentRunner
  suite: string
  case: EvalCase
}

export const runCase = async (args: RunCaseArgs): Promise<CaseResult> => {
  const { runner, suite, case: evalCase } = args
  const start = Date.now()
  const metadata = {
    tenantId: EVAL_TENANT_ID,
    correlationId: randomUUID(),
    agentCode: runner.code,
    eval: `${runner.code}/${suite}`,
    caseId: evalCase.id,
  }

  const llmResult = await runner.call({ input: evalCase.input, metadata })
  const durationMs = Date.now() - start

  if (!llmResult.ok) {
    return {
      caseId: evalCase.id,
      suite,
      agentCode: runner.code,
      durationMs,
      llmOk: false,
      output: '',
      llmError: `${llmResult.error.kind}: ${llmResult.error.message}`,
      checks: [
        {
          kind: 'llm_call',
          passed: false,
          detail: `LLM call failed: ${llmResult.error.kind}`,
        },
      ],
      passed: false,
      langfuseTraceId: '',
    }
  }

  const output = llmResult.value.text
  const deterministic = runDeterministicChecks(output, evalCase.expected, runner.signoffPersona)
  const judged = await runJudgeChecks(evalCase.input, output, evalCase.expected, {
    metadata,
  })
  const checks = [...deterministic, ...judged]
  const passed = checks.every((c) => c.passed)

  return {
    caseId: evalCase.id,
    suite,
    agentCode: runner.code,
    durationMs,
    llmOk: true,
    output,
    checks,
    passed,
    langfuseTraceId: llmResult.value.langfuseTraceId,
    tokens: llmResult.value.tokens,
    costUsd: llmResult.value.costUsd,
  }
}

export interface RunSuiteArgs {
  runner: AgentRunner
  suite: string
  file: CaseFileRef
}

export interface SuiteResult {
  agentCode: string
  suite: string
  cases: CaseResult[]
  startedAt: string
  durationMs: number
  passed: boolean
}

export const runSuite = async (args: RunSuiteArgs): Promise<SuiteResult> => {
  const cases = loadCasesFromFile(args.file)
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()

  const results: CaseResult[] = []
  for (const c of cases) {
    // Sequential — eval runs are diagnostic, not performance-bound, and
    // sequential execution keeps the console output readable.
    const r = await runCase({ runner: args.runner, suite: args.suite, case: c })
    results.push(r)
  }

  return {
    agentCode: args.runner.code,
    suite: args.suite,
    cases: results,
    startedAt,
    durationMs: Date.now() - startedAtMs,
    passed: results.every((r) => r.passed),
  }
}
