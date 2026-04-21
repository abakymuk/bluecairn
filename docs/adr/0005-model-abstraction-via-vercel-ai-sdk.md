# ADR-0005: Model abstraction via Vercel AI SDK

**Status:** Accepted
**Date:** 2026-04-20
**Deciders:** Vlad, Claude (cofounder-architect)

## Context

BlueCairn's agents rely on multiple model families for different roles:
- **Primary reasoning** (agent core logic): Claude Opus — highest quality, worth the cost for customer-facing actions.
- **Routing and classification** (orchestrator): Claude Haiku — cheap, fast.
- **Voice** (Nova): OpenAI Realtime API / GPT-4o — the strongest voice model at decision time.
- **Long-context parsing** (document extraction, multi-source synthesis): Gemini — strongest context window.
- **Future-unknown**: models we haven't heard of yet that will be better than any of the above in 2027, 2028, 2029.

We will change models frequently. Sometimes to chase quality (new Claude version). Sometimes to chase cost (a cheaper model that meets the bar). Sometimes to chase capability (a model that does something new). If every agent's code hard-codes a specific provider's SDK, every model change becomes a multi-file refactor.

We need an abstraction that lets us:
- Swap models per agent independently.
- Switch providers for a given agent without rewriting prompt or tool code.
- Track cost, latency, and quality per model and per agent.
- Do A/B or canary comparisons between models cleanly.
- Not lock ourselves to a single provider's proprietary pattern.

## Decision

**We use the Vercel AI SDK (v5+) as the abstraction layer over all LLM providers.**

Every LLM call in the codebase goes through `generateText`, `generateObject`, or `streamText` from the Vercel AI SDK, with the specific model passed as a provider adapter (`anthropic(...)`, `openai(...)`, `google(...)`).

Each agent declares its model in its `meta.ts` file:

```typescript
export const meta = {
  code: 'vendor_ops',
  persona: 'Sofia',
  model: anthropic('claude-opus-4-7'),
  // ...
}
```

Routing agents and summarizers use `claude-haiku-*`. The phone agent uses OpenAI's voice stack. Long-context jobs use Gemini. Changing a model is a one-line edit in `meta.ts`.

Model choice is versioned via ADR amendments as needed, so we can trace why `vendor_ops` switched from Opus to Sonnet in Q3 2027.

## Alternatives considered

**Direct provider SDKs (Anthropic SDK, OpenAI SDK, Google SDK).** Each agent uses the native SDK for its chosen provider. Rejected: tight coupling to provider APIs, every model switch is invasive, cross-provider comparison requires boilerplate, differing abstractions for tool calls / streaming / structured output.

**LangChain / LlamaIndex.** Comprehensive orchestration frameworks with provider abstractions. Rejected: heavy, opinionated, bundle size matters in our stack, rapid API churn has caused friction in other teams. We prefer a thinner abstraction.

**LiteLLM proxy.** An HTTP proxy that normalizes provider APIs. Rejected: adds a network hop and self-hosted dependency, weaker TypeScript integration, extra ops surface.

**Build our own thin wrapper.** We own the abstraction, nothing to learn. Rejected: we'd reinvent Vercel AI SDK poorly, and maintenance burden grows as we add providers. Solo-founder math disfavors NIH here.

**Portkey, OpenRouter, or similar hosted gateway.** Good options for rate-limit pooling and cross-provider observability. Rejected for primary abstraction (we want the abstraction in-process, not across a network), but may layer them on later for specific workloads.

## Consequences

**Accepted benefits:**
- Provider swap is a one-line change per agent.
- Structured output (`generateObject` with Zod schemas) works consistently across providers.
- Tool-calling abstraction works consistently across Anthropic and OpenAI models.
- Streaming is handled uniformly.
- Vercel AI SDK is actively maintained, well-typed, widely adopted. Low risk of stagnation.
- Integration with Langfuse (for tracing) works out of the box via middleware.

**Accepted costs:**
- We accept one extra layer between us and provider APIs. When a provider ships a new feature, there's a small lag before the SDK exposes it cleanly.
- Some provider-specific features (e.g., Anthropic's prompt caching, OpenAI's structured outputs specifics) may require custom handling. We accept this as an occasional cost.
- The SDK's API has evolved across v3 → v4 → v5; we accept the maintenance cost of upgrades.
- We're one more dependency deep on Vercel's ecosystem.

**Rules this decision creates:**
- No direct provider SDK calls in application code. Only `packages/core/llm` may import provider adapters, and only to register them with the Vercel AI SDK.
- Every agent declares its model explicitly in `meta.ts`. No implicit defaults.
- Every LLM call goes through Langfuse middleware for tracing.
- Model changes are tracked: a commit that changes a model has a note in the PR and an entry in the agent's eval history.

## Revisit conditions

- If Vercel AI SDK becomes unmaintained or its direction diverges from our needs.
- If a materially better abstraction emerges (e.g., one tied natively to MCP, or one with semantic-level caching and routing).
- If our scale makes a hosted gateway (Portkey, OpenRouter) the better choice for cross-provider routing, rate-limit management, or cost optimization.
- If a single provider becomes so dominant that multi-provider hedging is no longer meaningful.

Default bet: model diversity is a feature, not a bug. We want to be able to adopt the best tool for each agent's role and revisit frequently. This abstraction preserves that optionality.
