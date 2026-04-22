# BlueCairn — Engineering

*Last updated: April 2026 — v0.1*
*Companion to ARCHITECTURE.md. This document defines how we write code.*

---

## Why this document exists

ARCHITECTURE.md defines the system's shape. This document defines the **discipline by which we build it**.

The audience is specific: a solo founder-engineer using Claude Code as the primary development environment, building a multi-tenant production system that will eventually be maintained by a team. The engineering practices here are calibrated for that exact situation — not enterprise overkill, not cowboy hacking.

Written for future-Vlad (who forgot why he wrote that thing six months ago), future ops-pod engineers (who inherited the codebase), and Claude Code itself (which reads this file as context on every significant task).

---

## Engineering principles

Ten rules. Breaking them requires a note in the PR explaining why.

### 1. Types are the specification

TypeScript strict mode, `noUncheckedIndexedAccess`, `noImplicitAny`, `exactOptionalPropertyTypes`. If a function signature is loose, it is wrong. If the type system doesn't catch a class of bugs we've shipped twice, we extend the type system.

Types are not documentation. They are the contract. A type that is accurate is more valuable than a comment that is accurate.

### 2. Small PRs, honest history

Every change is a pull request, even as a solo developer. PRs are small (target <300 lines changed), focused (one concern per PR), and titled in a way that is readable six months later.

Merge to `main` via squash. `main` is always deployable. `main` history is the authoritative narrative of what the codebase became.

No force-pushes to `main`. No rewriting history. What happened is what happened.

### 3. Tests are specifications, evals are behavior

Unit and integration tests prove that code does what the code says it should do. Evals prove that agents do what we want them to do. Both are required. Neither substitutes for the other.

New code without tests is not finished. New agent prompts without eval updates are not finished.

### 4. Migrations are a contract with the past

Schema migrations never get replayed differently. Once merged, a migration is immutable. Corrections happen via new migrations. The history of migrations is the history of what the database ever was.

If a migration is wrong, it gets reverted by a new migration that reverses its effect. The wrong one stays in history.

### 5. Secrets have exactly one home

Every secret lives in the secrets manager. Not in `.env` files committed to git. Not in CI variables set ad hoc. Not in code comments. Not in Claude Code's context.

A committed secret is a compromised secret, permanently. We rotate; we do not try to unring the bell.

### 6. Observability is not a feature; it is a prerequisite

Every meaningful operation emits a trace or structured log. If you are about to ship a feature and you cannot see it working in production, you are not ready.

Langfuse for agent/LLM traces. Sentry for exceptions. Structured logs (JSON) to Better Stack for everything else. Correlation IDs tie traces to logs to user-visible events.

### 7. Fail loud in development, fail soft in production

Dev: throw. Staging: throw. Production: catch at runtime boundaries, log with full context, degrade gracefully, escalate to ops pod. Never show a stack trace to an operator.

Errors that reach the operator's chat thread are themselves a bug. We track them and treat them as incidents.

### 8. Tenant context is never implicit

Every function that touches tenant data takes an explicit tenant context object. No ambient tenant state. No "current tenant" global. No relying on whatever the last request set.

If a function doesn't clearly need tenant context, it probably shouldn't be touching tenant data.

### 9. Prompts are code

Prompts live in the repository, versioned in files with a known structure. They are reviewed like code. They pass CI like code. They deploy like code. They are rolled back like code.

Prompts edited in production through a UI are an anti-pattern. Prompts edited directly in a database row without a code change are an anti-pattern.

### 10. Claude Code is a collaborator, not an oracle

Claude Code writes most of the code. Vlad reviews all of it. Claude Code gets things subtly wrong in ways that compound over time if un-caught. Every PR is human-read before merge, even — especially — when generated quickly.

Assume Claude Code's suggestions are intelligent but not always correct. Verify against types, tests, and the principles in this document.

---

## Development environment

### Tools assumed installed on Vlad's Mac Studio

- **Node**: Bun 1.2+ as primary runtime, Node 22 LTS as fallback.
- **Git**: 2.40+.
- **Postgres**: local Postgres 16 for offline work (optional; Neon branches preferred for most work).
- **Docker**: for containerized dependencies when needed.
- **Editor**: Cursor or VS Code with Claude Code extension.
- **CLI**: `gh` (GitHub CLI), `inngest` CLI, `drizzle-kit`, `vercel` CLI.

### Monorepo layout (repeated here from ARCHITECTURE.md for reference)

```
bluecairn/
├── apps/
│   ├── api/              # Main API (Hono) — webhooks, orchestrator
│   ├── workers/          # Inngest functions
│   ├── ops-web/          # Ops pod console (Next.js)
│   └── admin-web/        # Super-admin console (Next.js)
├── packages/
│   ├── core/             # Shared domain types, utilities
│   ├── db/               # Drizzle schema, migrations
│   ├── agents/           # Agent definitions, prompts, policies
│   ├── mcp-servers/      # MCP server implementations
│   ├── integrations/     # Vendor adapters
│   ├── evals/            # Eval suites
│   └── memory/           # Memory store helpers
├── docs/                 # All .md docs including this one
├── tools/                # Development scripts (codegen, seeds)
├── .claude/              # Claude Code configuration
│   ├── CLAUDE.md         # Top-level context for Claude Code
│   └── commands/         # Custom slash commands
└── turbo.json, package.json, tsconfig.json, etc.
```

### Package boundaries

- `apps/*` may depend on any `packages/*`.
- `packages/*` may depend on other `packages/*` only in declared directions (no circular deps).
- `packages/core` has no dependencies on other workspace packages. It is the leaf.
- `packages/db` depends only on `core`.
- `packages/agents` depends on `core`, `db`, `memory`.
- `packages/mcp-servers` depends on `core`, `integrations`, `db`.
- `packages/integrations` depends only on `core`.
- `packages/evals` depends on `core`, `agents`.
- `packages/memory` depends on `core`, `db`.

Violations flagged in CI via `turbo.json` task boundaries and linting rules.

### Running locally

```bash
# First time setup
bun install
cp .env.example .env.local   # fill in dev secrets
bun run db:push              # sync schema to local or Neon dev branch
bun run db:seed              # load minimum fixtures

# Daily workflow
bun run dev                  # starts api, workers, ops-web in parallel
bun run test                 # test suites across packages
bun run eval                 # eval suites on changed agents
bun run lint                 # typescript, eslint, prettier
```

Speed target: cold start dev environment in <15s. Full test suite in <90s. Full eval suite in <5 min. If these budgets break, we fix them.

---

## Source control

### Branch strategy

Trunk-based. `main` is the only long-lived branch. Feature work happens in short-lived branches (target <2 days of life).

Branch names: `vlad/<short-description>` or `claude/<short-description>` (indicating who drove the work). No `feature/`, no `bugfix/`, no gerrund prefixes.

### Commit messages

Conventional Commits, loosely followed:

```
feat(agents): sofia handles missing-item disputes
fix(db): tenant_users revoked_at now respected in role lookup
chore(ci): bump turbo to 2.1
docs(architecture): clarify mcp server versioning
refactor(inventory): extract par-level logic to pure function
```

Body wraps at 72 chars. Explains the why, not the what. Links the PR, the ADR if applicable, and the Linear/GitHub issue.

### Pull requests

Even for solo work. PRs serve as:
- A pause before merging (intentional review).
- A durable artifact explaining "why this change".
- An integration point for CI checks.

PR template:

```markdown
## What
<one-paragraph summary>

## Why
<link to ADR, issue, or the reasoning>

## Tests
- [ ] Unit tests added / updated
- [ ] Integration test if crossing a layer boundary
- [ ] Eval suite updated if agent behavior changed

## Operational impact
<migration? feature flag? downtime? rollback plan?>

## Screenshots
<if UI>
```

Self-review is mandatory. After opening the PR, step away for at least an hour, then re-read the diff as if it were someone else's. At least 60% of solo-dev bugs are caught this way.

### Review from Claude Code

Claude Code is available to review PRs. Useful for:
- Catching subtle type errors.
- Finding missing test cases.
- Identifying inconsistencies with ARCHITECTURE.md or AGENTS.md principles.

Not sufficient for architectural judgment. That is still Vlad's job.

---

## Testing

Three layers. Each with distinct purpose.

### Layer 1: Unit tests (Vitest)

For pure functions, utilities, domain logic without I/O.

- Fast (<10ms per test).
- No database, no network.
- Coverage target: 80%+ for `packages/core`, `packages/agents` logic, `packages/db` query builders.
- Coverage is a guide, not a target. We don't chase 100%.

Structure:

```typescript
// packages/core/src/money/cents.test.ts
import { describe, expect, test } from 'vitest'
import { centsToDollars, dollarsToCents } from './cents'

describe('centsToDollars', () => {
  test('converts whole dollars', () => {
    expect(centsToDollars(100_00n)).toBe(100)
  })

  test('handles zero', () => {
    expect(centsToDollars(0n)).toBe(0)
  })

  test('rejects negative', () => {
    expect(() => centsToDollars(-1n)).toThrow()
  })
})
```

### Layer 2: Integration tests (Vitest + Testcontainers or Neon branches)

For code that crosses a boundary: database, MCP call, Inngest function, HTTP handler.

- Uses real Postgres (via Testcontainers locally, Neon branch in CI).
- Mocks external APIs (Twilio, Square, etc.) with well-defined fixtures.
- Asserts on observable behavior: database rows, emitted events, HTTP responses.
- Slower (seconds per test). Run in parallel via test file sharding.

Every handler, every MCP tool, every Inngest function has at least one happy-path integration test and one error-path test.

### Layer 3: Agent evals (in-repo runner, ADR-0011)

Evals test agent behavior, not code correctness. A code test says "this function returns X for input Y". An eval says "when Sofia sees this delivery-reconciliation scenario, she should draft a dispute and flag the correct amount".

Every agent has four eval dimensions:

1. **Unit evals**: curated input → expected output. Small, focused cases.
2. **Regression evals**: real historical cases that previously broke or were edge-cases.
3. **Rubric evals**: LLM-as-judge scoring against a written rubric (tone, completeness, accuracy).
4. **Adversarial evals**: prompt injection, policy violation attempts, edge cases designed to break the agent.

Evals are executed by the in-repo runner in `packages/evals/` via `bun run eval <agent-code>`. Per ADR-0011 we do not use Braintrust or Promptfoo for M2/M3 — a minimal TypeScript runner reuses the existing `generateText` wrapper and tags every eval call with `metadata.eval` + `metadata.case_id` for Langfuse filtering. See `packages/evals/README.md` for authoring cases.

Evals run in CI on any change that touches:
- An agent's prompt file.
- An agent's tool registration.
- An agent's policy.
- Any MCP server the agent uses.

**CI evals are advisory, not blocking** — the workflow exits 0 regardless of per-case outcomes and surfaces pass/fail via workflow status + an uploaded Markdown report. Locally the CLI exits 1 on failure so authors see a clear signal. Promoting evals to a blocking merge gate requires a fresh ADR capturing the operational trigger (see ADR-0011 revisit conditions).

### What we do not test

- We do not write tests for Drizzle-generated SQL (the ORM is the test).
- We do not write tests for third-party library behavior.
- We do not test logs or metrics emissions (verified by observability in production).
- We do not chase test counts. A codebase with 1000 mediocre tests is worse than one with 300 sharp ones.

---

## Database and migrations

### Schema authoring

Schema lives in `packages/db/src/schema/`. Files organized by domain:

```
schema/
├── platform/
│   ├── tenants.ts
│   ├── users.ts
│   ├── channels.ts
│   ├── threads.ts
│   └── ...
├── agents/
│   ├── agent_definitions.ts
│   ├── agent_runs.ts
│   └── ...
├── domain/
│   ├── vendors.ts
│   ├── inventory.ts
│   └── ...
└── index.ts               # barrel
```

### Migration workflow

1. Modify schema file in TypeScript.
2. Run `bun drizzle-kit generate` → creates SQL migration in `packages/db/migrations/`.
3. Review the generated SQL manually. Drizzle is good but not always perfect.
4. Run `bun drizzle-kit push` against a Neon dev branch to test.
5. Open PR. CI runs migration against a fresh Neon branch cloned from production, then runs the full test suite.
6. On merge, migration applies to staging automatically. Production migrations gated by manual approval.

### Migration hygiene

- Additive by default: add columns, add tables, add indexes. Never drop in the same migration as add.
- Large backfills run as Inngest jobs, not inline migrations.
- Breaking changes go through the two-phase pattern (see DATA-MODEL.md).
- Every migration has a corresponding test in `packages/db/migrations-tests/` that verifies before and after state on a representative dataset.

### Introspection and recovery

- Neon branching is our recovery tool. A bad migration on a dev or staging branch: destroy the branch, try again.
- Production backups are automatic via Neon. Restore drills run quarterly.
- Full ledger of migrations lives in `schema_migrations` table (Drizzle-managed).

---

## Agents and prompts

### Prompt files

Each agent has a directory under `packages/agents/src/<agent-code>/`:

```
packages/agents/src/vendor_ops/
├── prompt.md              # the prompt text, versioned
├── meta.ts                # agent definition (code, persona, tools, policies)
├── tools.ts               # tool registration
├── policies.ts            # default approval policies
├── guardrails.ts          # pre-execution checks
├── evals/
│   ├── unit.jsonl
│   ├── regression.jsonl
│   ├── rubric.md
│   └── adversarial.jsonl
└── index.ts
```

Prompts are stored as `.md` files with frontmatter for version and metadata. Example:

```markdown
---
version: 7
activated_at: 2026-08-14T00:00:00Z
changelog: |
  - Adjusted tone for vendor emails (less formal)
  - Added handling for partial credit disputes
  - Clarified escalation for legal-tinged vendor language
---

# Sofia — Vendor Ops

You are Sofia, the Vendor Ops agent at BlueCairn...
```

### Prompt changes

Every prompt change is a PR. The PR must include:

1. The prompt diff.
2. Updated `evals/unit.jsonl` cases if the change introduced new behavior.
3. Local eval run results pasted into the PR description.
4. A note in `CHANGELOG.md` for `packages/agents`.

CI runs the full eval suite. If it passes, the PR is mergeable. If it fails, the failures are interrogated — often the prompt needs more work, sometimes the evals are wrong and need updating.

### Prompt deployment

On merge to `main`:

1. The new prompt version is recorded in the `prompts` table with `eval_passed = true`.
2. New prompt is deployed but **not activated** — it sits as "staged" alongside the current active version.
3. Canary rollout: the new version runs against 5% of agent invocations for the next 48 hours, results compared to the current version via Langfuse.
4. If canary metrics are healthy, prompt is promoted to active.
5. If not, prompt is rolled back automatically.

For prompts deployed to new agents (first ship), canary is skipped — but the agent is always in supervised mode on first ship regardless.

### Voice calibration per tenant

Each tenant may have prompt overrides or amendments (e.g., "respond in Spanish", "always include our cafe's name at closing"). These are stored per-tenant, applied as prompt appendices, and evolve via operator feedback.

Overrides are not unbounded — they sit within a structured schema of allowed adjustments. Operators cannot override guardrails, escalation triggers, or policy enforcement.

---

## Claude Code workflow

Because Claude Code writes most of the code, our workflow is optimized around it.

### `.claude/CLAUDE.md`

The top-level context file that Claude Code reads on every session. It includes:

- Summary of VISION, PRODUCT, ARCHITECTURE (linked to full docs).
- The ten engineering principles above.
- The current phase of the roadmap.
- Recently-changed areas (auto-regenerated weekly).
- "Watch out for" notes — known pitfalls, past incidents.

Keep it under 300 lines. Dense. Claude Code will not re-read a 2000-line CLAUDE.md effectively.

### Task patterns

**Plan before code.** For any non-trivial task (>30 lines, new module, cross-file change), the workflow is:

1. Claude Code reads relevant docs (ARCHITECTURE, AGENTS, DATA-MODEL as needed).
2. Claude Code produces a plan: what files will change, what is the contract, what are the tests.
3. Vlad reviews the plan. Rejects or adjusts.
4. Claude Code implements against the approved plan.
5. Vlad reviews the code. Runs tests. Merges or requests changes.

This is slower on simple tasks and dramatically safer on complex ones. We default to planning.

**Small PRs.** If a task would produce a >500-line PR, it is broken into smaller PRs. Claude Code is instructed to propose decomposition when it senses scope.

**Explicit context loading.** When touching a specific area, Claude Code is instructed to read the relevant docs first, even if it is confident. "You know this already" is not a reason to skip.

### Custom slash commands

`.claude/commands/` holds reusable task templates:

- `/migration <description>` — scaffolds a new migration with test.
- `/agent <code>` — scaffolds a new agent directory with all required files.
- `/mcp <name>` — scaffolds a new MCP server with example tools.
- `/eval <agent>` — runs and interprets the eval suite for the agent.
- `/trace <run_id>` — fetches a Langfuse trace and summarizes it.
- `/review` — reviews the current PR against engineering principles.

Commands evolve as patterns emerge. New command templates require consensus (in this case, Vlad agreeing with himself after a day of distance).

### What Claude Code does NOT do

- Claude Code does not merge PRs. Only Vlad does.
- Claude Code does not modify `docs/*.md` without explicit instruction. Documentation changes are intentional.
- Claude Code does not delete files without explicit instruction.
- Claude Code does not bypass CI failures. Fix the failure, not the gate.

---

## Dependencies

### Adoption policy

New dependencies require a written justification (in the PR or an ADR if significant). Questions:

1. Can we do this without a dependency?
2. How actively maintained is it?
3. What is the bundle size / runtime cost?
4. If it disappears tomorrow, can we replace it?

Our core commitment: no dependency we cannot replace within 90 days.

### Update cadence

- **Weekly**: dependabot or renovate PRs for patch updates. Auto-merge if tests pass.
- **Monthly**: review minor updates. Merge after brief smoke test.
- **Quarterly**: review major updates. Plan migration work if needed.

Never upgrade a major version same-day. Always let it bake in staging for at least a week.

### Lockfile discipline

`bun.lockb` is committed. Pinned versions. We do not use `^` or `~` ranges in our own workspace; dependencies get exact versions.

Dev dependencies may use caret ranges for less-critical tools (types, eslint plugins).

---

## Deployment

### Environments

- **Development**: local Bun processes + Neon dev branches per developer.
- **Staging**: deployed on merge to `main`. Shared Neon branch (`staging`). All integrations against sandbox/test vendor accounts.
- **Production**: deployed on manual approval from staging. Separate Neon branch (`production`). Real integrations.

### Deployment pipeline

On merge to `main`:

1. CI runs: type check, lint, unit tests, integration tests, eval suite.
2. On green: artifacts built (Vercel apps, workers bundles).
3. Automatic deploy to **staging**.
4. Smoke tests against staging.
5. Manual promotion to **production** by Vlad (one click in a small ops-web view).
6. Post-deploy: Langfuse + Sentry + Better Stack validate no regression in error or latency for 15 minutes.
7. If regression detected: automatic rollback to previous version (Vercel's atomic deployment handles this).

### Feature flags

Significant changes ship behind flags. Flags live in the `policies` table at the tenant level or as a platform-level setting.

Types of flags:

- **Release flags** (short-lived): turn a new feature on for a subset of tenants, roll out gradually.
- **Ops flags** (long-lived): turn an agent off for a tenant if it misbehaves. Emergency kill switch.
- **Experiment flags** (time-bounded): A/B test a prompt variant.

Flags are reviewed quarterly. Stale release flags are removed.

### Database deploys

Migrations apply automatically on deploy:

- Staging: on every merge.
- Production: after staging has run cleanly for at least 1 hour and Vlad has reviewed the migration diff.

Long-running migrations (>5 seconds) are flagged. They run out-of-band via Inngest with progress monitoring.

---

## Observability

### Logging

Structured JSON logs via a single `logger` utility in `packages/core`. Every log line includes:

- `timestamp` (ISO 8601 UTC).
- `level` (debug | info | warn | error).
- `service` (api | workers | ops-web | admin-web).
- `tenant_id` (if available).
- `correlation_id` (request or run ID).
- `agent_run_id`, `tool_call_id` (when within an agent context).
- `message` (human-readable).
- Arbitrary additional fields per context.

Never log: prompts, LLM responses verbatim, credentials, customer PII beyond what is strictly needed for debugging. Langfuse handles prompt/response visibility with proper access control.

### Traces

Langfuse is the primary trace store for agent runs. Every agent invocation:

- Opens a trace.
- Traces include sub-spans for each tool call, each LLM call, each policy check.
- Tags: tenant, agent code, trigger kind, outcome status.

Access: Vlad and ops pod have full access. Customers do not. Data retention: 2 years hot, archived beyond.

### Metrics

Key metrics, tracked via Better Stack:

- **Per-agent**: invocation count, success rate, escalation rate, P50/P95 latency, token usage, cost.
- **Per-MCP-server**: call count, success rate, P95 latency, error rate by error type.
- **Per-tenant**: active threads, messages/day, actions/day, ops-pod touches/day.
- **Platform**: API request rate, error rate, database connection pool, queue depth (Inngest).

Alerts:

- Agent error rate >5% over 10 min — page ops pod.
- P95 latency >3x baseline — notify (not page).
- Database connection pool >80% — notify.
- Any critical action failure — page.

### Dashboards

One-screen dashboard per role:

- **Vlad's dashboard**: platform health, cost trends, agent performance trends.
- **Ops pod dashboard**: open escalations, tenants needing attention, today's escalated actions.
- **Per-tenant dashboard** (internal, not customer-facing): this tenant's activity, agent performance on this tenant, costs.

Dashboards are deliberately sparse. A dashboard that shows 40 metrics is a dashboard nobody reads.

---

## Incident response

### Definitions

- **SEV-1**: Platform down, data loss, cross-tenant data leak, money-moving error. Wake people up.
- **SEV-2**: Major feature broken, single tenant severely impacted, external customer experience degraded. Respond within 30 minutes.
- **SEV-3**: Minor issue, workaround available, no customer impact. Respond within business hours.

### Response pattern

1. **Detect** — alert or report triggers incident.
2. **Declare** — create a new entry in `incidents/` doc folder. Assign severity. Open a Linear issue.
3. **Mitigate** — restore service. This may mean disabling a feature flag, rolling back a deploy, or manually working around. Mitigation is always faster than root-cause fix.
4. **Communicate** — within 15 minutes of SEV-1 declaration, affected operators are informed via their chat thread: *"We're seeing a temporary issue with [X]. Our team is on it. We'll confirm when resolved."* Clear, no-jargon.
5. **Resolve** — system is back to normal.
6. **Post-mortem** — within 5 business days. Written up in `incidents/<date>-<slug>.md`. Five-whys analysis. Concrete changes identified.
7. **Close** — post-mortem reviewed, changes implemented or scheduled, incident closed.

### Post-mortem principles

- Blameless. The process failed, not the person.
- Concrete. Every finding has a corresponding action item with an owner and a date.
- Public internally. Shared with all engineers (once we have more than Vlad).
- Shared with affected operators if relevant. Operator trust is built by how we handle mistakes.

### Kill switches

Every agent has a per-tenant kill switch (via `policies` table). Flipping it:

- Stops new agent invocations for that tenant.
- In-flight invocations complete but no new actions execute.
- Operator sees a message: *"BlueCairn's automation is temporarily paused. Our team will be in touch shortly."*
- Ops pod takes over manually.

Every MCP server has a global kill switch. Every deploy has a rollback button (1 click in ops-web).

We drill kill switches quarterly. Using them in a real incident should feel routine, not exotic.

---

## Security

See ARCHITECTURE.md for the architectural posture. This section covers the day-to-day practice.

### Secrets

- All secrets in 1Password Secrets Automation or Doppler. Never in git, never in `.env` files committed.
- Access via environment variables populated at deploy time.
- Rotation schedule: vendor OAuth tokens per vendor recommendation, internal keys every 90 days.

### Access control

- GitHub: 2FA mandatory. SSH key per device, rotated annually.
- Vercel, Neon, Twilio, etc.: SSO where available, 2FA always.
- Production database: read-only access by default, write via deploy pipeline only. Emergency write access requires a second person (future state; for now, Vlad's access is audited by Langfuse/Better Stack).

### Customer data

- Encrypted at rest (Neon native).
- Encrypted in transit (TLS always).
- Not sent to third parties beyond the integrations the customer has authorized.
- Never used to train models without explicit opt-in.
- Deleted on request (with audit-log redaction, not removal — see DATA-MODEL.md).

### Code security

- GitHub secret scanning enabled.
- Dependabot security alerts reviewed within 48 hours.
- No executable code downloaded and run without inspection.
- Claude Code is not granted credentials for production. Ever.

---

## Performance

### Budgets

- API endpoint P95: <500ms for simple reads, <1s for writes.
- Agent invocation (full cycle): P95 <15 seconds for single-agent run, <30 seconds for multi-agent.
- Message delivery to operator from inbound trigger: P95 <60 seconds for routine, <10 seconds for urgent.
- Dashboard load time: P95 <2 seconds.

Budgets reviewed quarterly. A feature that blows a budget requires justification (and usually optimization).

### Profiling

- Langfuse identifies slow LLM calls.
- Neon query performance dashboard surfaces slow queries.
- Vercel analytics on frontend performance.
- Ad hoc: `bun --inspect` for Node profiling when needed.

### Scaling considerations (for the horizon)

- **Up to 100 tenants**: current architecture handles without rework.
- **100–1000 tenants**: likely need read replicas on Postgres, sharded Inngest concerns, bigger Vercel plan.
- **1000+ tenants**: revisit. Possibly per-shard tenants, dedicated workers per tenant tier.

We don't engineer for 1000 tenants in the first year. We design for replaceability so that when we get there, we can scale the parts that need scaling.

---

## Documentation

### What we document

- Every ADR (architectural decision record) under `docs/adr/`.
- Every agent, per the structure in AGENTS.md.
- Every MCP server (a `README.md` in its package).
- Every integration (a `README.md` in its package).
- Every non-obvious business rule (in code comments, linked to source).

### What we do not document

- Code that should be readable from its own structure. Comments that paraphrase the code are noise.
- Internal APIs that only have one consumer. Types are the documentation.
- Decisions that will change in 3 months. We document stable decisions.

### CHANGELOG.md

Each package has a `CHANGELOG.md` with a human-readable log of user-facing changes. Updated per PR when relevant. Links to the PR and the ADR if applicable.

### When docs conflict with code

The code is the truth. The docs are stale. Update the docs.

When docs conflict with another doc: either the newer one overrides, or we reconcile. Never leave the conflict visible.

---

## Onboarding the first non-founder engineer (Month 15+)

We'll be bringing someone into the codebase at Month 15 or so (see ROADMAP.md). This section plans for that.

### The expected new-engineer experience

- **Day 1**: Read VISION, PRODUCT, ARCHITECTURE, AGENTS. Set up dev environment. Open first PR (fix a typo, small refactor).
- **Week 1**: Shadow operations. Observe three tenant threads end-to-end. Understand what agents actually do.
- **Week 2**: Take on one small feature. Pair with Vlad (or Claude Code with heavy Vlad review).
- **Week 4**: Own a feature end-to-end, including eval and deploy.
- **Month 3**: Lead on one agent's quarterly iteration.

### What we commit to providing

- Clean, consistent codebase. No mysterious historic detritus.
- Up-to-date documentation. If it's wrong, we fix it on Day 1.
- A real on-call rotation (once we're 2+ engineers).
- Defined responsibilities, not "figure it out".

### What we expect

- Respect for the principles in this document. Disagree productively, not by skirting.
- Attention to multi-tenancy and audit trail — the invariants that keep customers safe.
- Willingness to ship quality slowly over quantity quickly.

---

## Relationship to other documents

- **VISION.md** says why we build this way (built-to-last).
- **PRODUCT.md** says what we build.
- **ARCHITECTURE.md** says how the system is shaped.
- **DATA-MODEL.md** says what the data looks like.
- **AGENTS.md** says what each agent does.
- **ROADMAP.md** says what order we build it.
- **This document (ENGINEERING.md)** says how we write it, day to day.
- **OPERATIONS.md** says how Nick's work and the ops pod interact with the platform.
- **ADRs** (under `docs/adr/`) say why specific technical decisions were made.

When this document drifts from the others, the others win — except ARCHITECTURE, which defines the contract this document's practices must honor.

---

*Drafted by Vlad and Claude (cofounder-architect) in April 2026.*
*Living document. Revise quarterly, or whenever reality diverges from what's written here.*
