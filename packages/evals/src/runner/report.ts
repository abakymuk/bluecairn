import type { SuiteResult, CaseResult } from './run.js'

/**
 * Console + Markdown formatting for a suite run (ADR-0011).
 *
 * The console output goes to stdout on every invocation. The Markdown
 * variant is written to `packages/evals/reports/<agent>-<suite>-<ISO>.md`
 * so CI can upload it as a workflow artifact and reviewers can read a
 * static report alongside Langfuse's live traces.
 */

const green = (s: string): string => `\u001b[32m${s}\u001b[0m`
const red = (s: string): string => `\u001b[31m${s}\u001b[0m`
const dim = (s: string): string => `\u001b[2m${s}\u001b[0m`

const statusSymbol = (passed: boolean): string => (passed ? green('✓') : red('✗'))

export const formatConsole = (suite: SuiteResult): string => {
  const lines: string[] = []
  lines.push('')
  lines.push(`eval ${suite.agentCode}/${suite.suite} — ${suite.cases.length} cases`)
  for (const c of suite.cases) {
    lines.push(`  ${statusSymbol(c.passed)} ${c.caseId} ${dim(`(${c.durationMs}ms)`)}`)
    if (!c.passed) {
      if (c.llmError !== undefined) {
        lines.push(`    ${red('llm:')} ${c.llmError}`)
      }
      for (const check of c.checks) {
        if (!check.passed) {
          lines.push(`    ${red(check.kind)}: ${check.detail}`)
        }
      }
      if (c.output !== '') {
        const preview = c.output.length > 120 ? `${c.output.slice(0, 120)}…` : c.output
        lines.push(`    ${dim('output:')} ${preview}`)
      }
    }
  }
  const passed = suite.cases.filter((c) => c.passed).length
  const failed = suite.cases.length - passed
  const totalTokens = suite.cases.reduce(
    (acc, c) => acc + (c.tokens?.total ?? 0),
    0,
  )
  const totalCost = suite.cases.reduce((acc, c) => acc + (c.costUsd ?? 0), 0)
  lines.push('')
  lines.push(
    `${suite.passed ? green('PASS') : red('FAIL')} ${passed}/${suite.cases.length} cases passed${failed > 0 ? ` (${failed} failed)` : ''}; ${totalTokens} tokens; $${totalCost.toFixed(4)}; ${suite.durationMs}ms`,
  )
  lines.push('')
  return lines.join('\n')
}

const mdRow = (c: CaseResult): string => {
  const status = c.passed ? '✅' : '❌'
  const details = c.passed
    ? '—'
    : c.checks
        .filter((chk) => !chk.passed)
        .map((chk) => `\`${chk.kind}\`: ${chk.detail}`)
        .join('<br>') || c.llmError || '(unknown failure)'
  const cost = c.costUsd !== undefined ? `$${c.costUsd.toFixed(4)}` : '—'
  const trace = c.langfuseTraceId !== '' ? `\`${c.langfuseTraceId.slice(0, 12)}…\`` : '—'
  return `| ${status} | \`${c.caseId}\` | ${c.durationMs}ms | ${cost} | ${trace} | ${details} |`
}

export const formatMarkdown = (suite: SuiteResult): string => {
  const passed = suite.cases.filter((c) => c.passed).length
  const failed = suite.cases.length - passed
  const totalTokens = suite.cases.reduce((acc, c) => acc + (c.tokens?.total ?? 0), 0)
  const totalCost = suite.cases.reduce((acc, c) => acc + (c.costUsd ?? 0), 0)
  const lines: string[] = []
  lines.push(`# eval ${suite.agentCode}/${suite.suite}`)
  lines.push('')
  lines.push(`- **Verdict:** ${suite.passed ? '✅ PASS' : '❌ FAIL'}`)
  lines.push(`- **Cases:** ${passed}/${suite.cases.length} passed${failed > 0 ? ` (${failed} failed)` : ''}`)
  lines.push(`- **Started:** ${suite.startedAt}`)
  lines.push(`- **Duration:** ${suite.durationMs}ms`)
  lines.push(`- **Total tokens:** ${totalTokens}`)
  lines.push(`- **Total cost:** $${totalCost.toFixed(4)}`)
  lines.push('')
  lines.push('## Per-case')
  lines.push('')
  lines.push('| | Case | Duration | Cost | Trace | Failures |')
  lines.push('|---|---|---|---|---|---|')
  for (const c of suite.cases) lines.push(mdRow(c))
  lines.push('')
  lines.push('*Langfuse traces filter: `metadata.eval = "' + `${suite.agentCode}/${suite.suite}` + '"`*')
  return lines.join('\n')
}

export const slugTimestamp = (iso: string): string =>
  iso.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
