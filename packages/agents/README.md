# @bluecairn/agents

Agent runtime for BlueCairn. Houses the shared LLM wrapper, OpenTelemetry +
Langfuse tracing bootstrap, and (from Month 2+) per-agent definitions.

## Public exports

```ts
import {
  // LLM
  generateText,
  type LlmCallInput,
  type LlmCallOutput,
  type LlmError,
  type LlmMetadata,
  // Tracing
  initTracing,
  shutdownTracing,
  type TracingConfig,
} from '@bluecairn/agents'
```

## The `generateText` rule (ADR-0005)

`generateText` is the ONLY way to call an LLM from anywhere in the codebase.

**Do NOT import provider SDKs directly** from agent, orchestrator, MCP, or
worker code:

```ts
// ❌ Forbidden
import Anthropic from '@anthropic-ai/sdk'
import { openai } from '@ai-sdk/openai'
import { generateText } from 'ai' // the raw AI SDK — use our wrapper
```

```ts
// ✅ Correct
import { anthropic } from '@ai-sdk/anthropic' // only here, for model factory
import { generateText } from '@bluecairn/agents'

const result = await generateText({
  model: anthropic('claude-haiku-4-5-20251001'),
  prompt,
  metadata: { tenantId, correlationId, agentRunId, agentCode: 'concierge' },
})
if (!result.ok) { /* classify LlmError and escalate */ }
const { text, tokens, costUsd, langfuseTraceId, latencyMs } = result.value
```

The wrapper guarantees:

- Uniform Langfuse instrumentation (`trace_id`, `tokens`, `cost`, `latency`,
  span name `llm.<agentCode>`).
- Normalized token + cost accounting writable straight into `agent_runs`
  (`agent_runs.langfuse_trace_id`, `tokens`, `cost_usd`, `latency_ms`).
- Typed `Result<LlmCallOutput, LlmError>` so the caller picks between
  retry / context-overflow escalation / user-facing failure.
- One place to update model pricing (see `MODEL_COSTS` in `src/llm.ts`).

## Tracing bootstrap

Call `initTracing` **once per process boot** — typically from `apps/workers`
entry and from smoke scripts. Idempotent; repeated calls are no-ops.

```ts
initTracing({
  publicKey: env.LANGFUSE_PUBLIC_KEY,
  secretKey: env.LANGFUSE_SECRET_KEY,
  host: env.LANGFUSE_HOST,
  environment: env.NODE_ENV,
  exportMode: 'batched', // 'immediate' for serverless / one-shot scripts
})
```

Per ADR-0010, Langfuse Cloud (Hobby, US) is the M0/M1 backend — update
`host` to the self-hosted URL when that migration happens.

## Smoke test

```bash
doppler run --config dev -- bun run --cwd packages/agents scripts/smoke-langfuse.ts
```

Drives one real Haiku call through the wrapper, prints the telemetry
payload, and confirms the trace reaches Langfuse Cloud. Use before shipping
any change to `llm.ts` or `tracing.ts`.

## Model pricing

`MODEL_COSTS` in `src/llm.ts` is hand-maintained from
[anthropic.com/pricing](https://www.anthropic.com/pricing). Unknown models
return `costUsd=0` rather than a confidently-wrong number — surface this in
agent_runs so bad pricing lookups are obvious.
