#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { initTracing, shutdownTracing } from '@bluecairn/agents'

import type { CaseFileRef } from './case.js'
import { getAgentRunner, listAgentCodes } from './registry.js'
import { runSuite } from './run.js'
import { formatConsole, formatMarkdown, slugTimestamp } from './report.js'

/**
 * `bun run eval <agent-code> [--suite=<name>]` entry (ADR-0011).
 *
 * Default suite is `unit`. The runner resolves the suite file at
 * `packages/agents/src/<code>/evals/<suite>.jsonl`, loads + validates
 * cases, calls each one through the agent's registered `call` function,
 * and prints pass/fail summary. Exit code 1 on any failure so local
 * developers see a clear signal; the CI workflow layer decides whether
 * that exit code blocks merge (see `.github/workflows/eval.yml` — it
 * doesn't, per ADR-0011).
 *
 * Required env: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`,
 * `ANTHROPIC_API_KEY`. Typical invocation:
 *
 *   doppler run --config dev -- bun run --cwd packages/evals eval concierge
 *
 * or, from anywhere: `bun run eval concierge`.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../../..')

interface Args {
  agentCode: string
  suite: string
}

const usage = (): string => {
  const known = listAgentCodes()
  return [
    'usage: bun run eval <agent-code> [--suite=<name>]',
    `agents: ${known.join(', ') || '(none)'}`,
    'suite defaults to `unit`',
  ].join('\n')
}

const parseArgs = (argv: readonly string[]): Args | { error: string } => {
  const positional: string[] = []
  let suite = 'unit'
  for (const a of argv) {
    if (a.startsWith('--suite=')) {
      suite = a.slice('--suite='.length)
      continue
    }
    if (a === '--help' || a === '-h') return { error: usage() }
    positional.push(a)
  }
  const agentCode = positional[0]
  if (agentCode === undefined) return { error: `missing <agent-code>\n${usage()}` }
  if (suite === '') return { error: '--suite= may not be empty' }
  return { agentCode, suite }
}

const main = async (): Promise<number> => {
  const parsed = parseArgs(process.argv.slice(2))
  if ('error' in parsed) {
    console.error(parsed.error)
    return 2
  }

  const runner = getAgentRunner(parsed.agentCode)
  if (runner === undefined) {
    console.error(`unknown agent code: ${parsed.agentCode}`)
    console.error(usage())
    return 2
  }

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY
  const langfuseHost = process.env.LANGFUSE_HOST ?? 'https://us.cloud.langfuse.com'
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (publicKey === undefined || secretKey === undefined) {
    console.error('✖ LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are required.')
    return 2
  }
  if (anthropicKey === undefined) {
    console.error('✖ ANTHROPIC_API_KEY is required.')
    return 2
  }

  initTracing({
    publicKey,
    secretKey,
    host: langfuseHost,
    environment: process.env.NODE_ENV ?? 'eval',
    exportMode: 'immediate',
  })

  const suiteFile: CaseFileRef = {
    agentCode: runner.code,
    suite: parsed.suite,
    absPath: join(
      REPO_ROOT,
      'packages',
      'agents',
      'src',
      runner.code,
      'evals',
      `${parsed.suite}.jsonl`,
    ),
  }

  const suite = await runSuite({ runner, suite: parsed.suite, file: suiteFile })

  process.stdout.write(formatConsole(suite))

  // Persist a Markdown report for CI artifact upload + local history.
  const reportsDir = join(REPO_ROOT, 'packages', 'evals', 'reports')
  mkdirSync(reportsDir, { recursive: true })
  const reportPath = join(
    reportsDir,
    `${runner.code}-${parsed.suite}-${slugTimestamp(suite.startedAt)}.md`,
  )
  writeFileSync(reportPath, formatMarkdown(suite))
  console.info(`report: ${reportPath}`)

  await shutdownTracing()
  return suite.passed ? 0 : 1
}

main()
  .then((code) => {
    process.exit(code)
  })
  .catch((err) => {
    console.error('fatal:', err)
    process.exit(1)
  })
