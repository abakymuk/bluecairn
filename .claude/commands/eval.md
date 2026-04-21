---
description: Run and interpret the eval suite for an agent
argument-hint: <agent-code>
---

Task: run and interpret evals for `$ARGUMENTS`.

1. Run `bun run eval $ARGUMENTS` from the repo root.
2. Report results across all four dimensions separately: unit, regression, rubric, adversarial. A green overall with a red dimension is still red.
3. For each failure surface:
   - The failing case id and input.
   - Expected vs. actual output.
   - Likely cause — prompt drift, tool misselection, policy gap, or guardrail gap — stated as a hypothesis, not a fix.
4. Do not modify the prompt or eval cases to turn a red test green without explicit approval. Failing evals are information, not a bug to suppress.
