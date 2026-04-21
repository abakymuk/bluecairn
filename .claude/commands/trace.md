---
description: Fetch a Langfuse trace and summarize it for a human reader
argument-hint: <run_id>
---

Task: fetch and summarize Langfuse trace `$ARGUMENTS`.

1. Fetch the trace from `LANGFUSE_HOST` using the configured API key. Do not print the key.
2. Summarize:
   - Agent code and prompt version.
   - Tenant id and correlation id.
   - Input message (redact obvious PII — names, phone numbers, card digits).
   - Tool calls in order: name, latency, outcome, idempotency key if present.
   - Model calls: model, tokens in / out, latency, cost.
   - Final output and termination reason.
3. Flag anomalies explicitly: tool errors, unusually long latencies (> p95 for this agent), repeated tool calls on the same input, unusually high token counts, policy overrides, or approvals that were auto-granted.
4. Only fetch traces for the run id the user specified. Do not walk adjacent traces for the same tenant.
