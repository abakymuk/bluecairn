import { anthropic } from '@ai-sdk/anthropic'
import { generateText } from '../src/llm.js'
import { initTracing, shutdownTracing } from '../src/tracing.js'

/**
 * BLU-20 smoke: drive a real Haiku call through the wrapper + Langfuse
 * Cloud. Requires LANGFUSE_* + ANTHROPIC_API_KEY in the current env (run
 * under Doppler: `doppler run --config dev -- bun run --cwd packages/agents
 * scripts/smoke-langfuse.ts`).
 *
 * Prints the LLM output plus telemetry fields (trace id / tokens / cost /
 * latency). A green run means the trace should be visible in Langfuse at
 * us.cloud.langfuse.com → project bluecairn-mvp within ~30s.
 */

const publicKey = process.env.LANGFUSE_PUBLIC_KEY
const secretKey = process.env.LANGFUSE_SECRET_KEY
const host = process.env.LANGFUSE_HOST ?? 'https://us.cloud.langfuse.com'
const anthropicKey = process.env.ANTHROPIC_API_KEY

if (publicKey === undefined || secretKey === undefined) {
  console.error(
    '✖ LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are required. Run under Doppler.',
  )
  process.exit(1)
}
if (anthropicKey === undefined) {
  console.error('✖ ANTHROPIC_API_KEY is required. Run under Doppler.')
  process.exit(1)
}

initTracing({
  publicKey,
  secretKey,
  host,
  environment: process.env.NODE_ENV ?? 'development',
  // `immediate` so the smoke script's span flushes before process exit.
  exportMode: 'immediate',
})

const start = Date.now()

const result = await generateText({
  model: anthropic('claude-haiku-4-5-20251001'),
  prompt: 'Say "BLU-20 smoke test ok" and nothing else.',
  maxTokens: 32,
  metadata: {
    tenantId: '00000000-0000-0000-0000-000000000001',
    correlationId: crypto.randomUUID(),
    agentCode: 'smoke',
  },
})

if (!result.ok) {
  console.error('✖ LLM call failed:', result.error)
  await shutdownTracing()
  process.exit(1)
}

console.log('---- LLM output ----')
console.log(result.value.text)
console.log('---- telemetry ----')
console.log({
  langfuseTraceId: result.value.langfuseTraceId,
  modelId: result.value.modelId,
  tokens: result.value.tokens,
  costUsd: result.value.costUsd,
  latencyMs: result.value.latencyMs,
  totalMs: Date.now() - start,
})

await shutdownTracing()
console.log('\n✓ smoke complete — check Langfuse UI within ~30s')
