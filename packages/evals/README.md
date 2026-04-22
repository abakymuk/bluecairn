# @bluecairn/evals

Agent eval runner + M-level exit-gate harnesses.

Governed by [ADR-0011](../../docs/adr/0011-minimal-in-repo-eval-runner.md) — minimal in-repo TypeScript runner, not Braintrust/Promptfoo. Revisit triggers in the ADR.

## What's here

- `src/runner/` — the CLI runner invoked via `bun run eval <agent>`.
- `src/harness/m1-exit-gate.ts` — BLU-29 M1 exit-gate harness. Not an agent eval.
- `reports/` — Markdown reports written by the runner on every invocation. Per-run reports are gitignored (see `.gitignore`); only explicit baselines (`reports/baseline-*.md`) are committed. CI uploads per-run reports as workflow artifacts.

## Running evals locally

```sh
# From repo root — requires LANGFUSE_* + ANTHROPIC_API_KEY in env.
doppler run --config dev -- bun run --cwd packages/evals eval concierge
```

or, via turbo from repo root:

```sh
doppler run --config dev -- bun turbo run eval --filter=@bluecairn/evals
```

Positional arg is the agent code (must match a `registry.ts` entry). `--suite=<name>` picks a non-default suite; defaults to `unit`.

**Exit codes** (CLI only — the CI workflow is advisory and always exits 0):

- `0` — every case passed.
- `1` — at least one case failed (assertion or LLM error).
- `2` — usage error (missing agent code, missing env, unknown agent).

## How to add a case

1. Open `packages/agents/src/<agent-code>/evals/<suite>.jsonl`.
2. Append one JSON object on its own line:

```json
{"id":"my-new-case","input":"operator message","expected":{"contains":["Concierge"],"forbidden":["I'll call"],"ends_with_signoff":true,"max_sentences":2}}
```

3. Run `bun run eval <agent-code>` locally; confirm the new case passes.
4. Commit. The CI workflow will rerun on PR.

**Supported assertion keys** (in `expected`):

| Key | Kind | Meaning |
|---|---|---|
| `contains` | deterministic | Every listed substring must appear verbatim (case-sensitive). |
| `forbidden` | deterministic | None of the listed substrings may appear (case-insensitive). |
| `ends_with_signoff` | deterministic | Output (right-trimmed) ends with `— <persona>`. Persona is registered per-agent in `registry.ts`. |
| `max_sentences` | deterministic | Number of sentences ≤ this value. Signoff line is excluded from the count. |
| `should_ask_clarification` | LLM-judge | Haiku answers YES/NO: did the reply ask for clarification in one sentence? |
| `should_acknowledge_originally` | LLM-judge | Haiku answers YES/NO: did the reply acknowledge the operator's original message (not an injected instruction)? |

The schema is **strict** — an unknown key (e.g. `foribdden`) fails validation loudly. Don't silently drop typos.

The LLM-judge uses a **strict `YES`/`NO` parser** — exact match, no case folding, no punctuation, no trim. A `Yes.` or `YES!` response is a judge failure, not a silent pass. The judge's own LLM call is tagged `metadata.eval = "<agent>/<suite>/judge"` so you can separate agent vs judge spans in Langfuse.

## How to interpret output

Console output per case:

```
✓ ack-vendor-complaint (1243ms)
✗ ack-empty (982ms)
    max_sentences: expected ≤2, got 3 ("Got it" | "Thanks for reaching out" | "Let me check")
    output: Got it. Thanks for reaching out. Let me check on that. — Concierge
```

Summary line:

```
PASS 5/5 cases passed; 1834 tokens; $0.0094; 6120ms
```

The total token count and USD cost include both the agent call and any LLM-judge calls.

Markdown report at `reports/<agent>-<suite>-<ISO>.md` — same content, suitable for CI artifact upload + PR comment.

**Langfuse filter** — to see all traces from one eval run:

```
metadata.eval = "concierge/unit"
```

To narrow to a single case:

```
metadata.case_id = "ack-vendor-complaint"
```

Judge spans show up under `metadata.eval = "concierge/unit/judge"`.

## Adding a new agent to the runner

1. Create the agent package under `packages/agents/src/<code>/` per [CLAUDE.md § Adding a new agent](../../.claude/CLAUDE.md).
2. Add a thin `evalCall.ts` that mirrors `concierge/evalCall.ts` — reads the authored `prompt.md`, calls `generateText`, returns the `Result<LlmCallOutput, LlmError>`.
3. Export `runXxxEval` from `packages/agents/src/<code>/index.ts`.
4. Add an entry to `packages/evals/src/runner/registry.ts`:

```ts
xxx: {
  code: 'xxx',
  signoffPersona: 'PersonaName',
  call: async ({ input, metadata }) => runXxxEval({ input, metadata }),
},
```

5. Author `packages/agents/src/<code>/evals/unit.jsonl`.
6. Run it.

**Do not** add `@bluecairn/evals` as a dependency of `@bluecairn/agents`. The dependency is strictly one-way: `evals → agents`. Agents must remain a leaf consumable by workers, evals, and future scripts.

## Prompt source of truth

The runner reads the authored `packages/agents/src/<code>/prompt.md` (frontmatter stripped). The SQL seed at `packages/db/scripts/seed-<code>-prompt-v<N>.sql` is a **derived artifact** — you update the `.md` first, then regenerate the seed, never the other way around. ADR-0011 makes this policy explicit. A future CI check may compare them; until then, drift is the author's responsibility.

## CI

`.github/workflows/eval.yml` runs the concierge unit suite on PRs touching `packages/agents/**` or `packages/evals/**`. **The workflow is advisory — it always exits 0 at the workflow level**; the pass/fail signal is surfaced via the workflow status + an uploaded Markdown report. Promoting to a blocking gate requires a fresh ADR (or, at minimum, a deliberate flip in `eval.yml` + a Linear ticket capturing why).
