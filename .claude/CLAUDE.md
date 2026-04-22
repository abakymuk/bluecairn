# BlueCairn — Claude Code context

*Last updated: April 2026 — v0.1*
*This file is read by Claude Code on every session. Keep it dense and current.*

---

## What BlueCairn is

A managed service for independent restaurants, delivered entirely through chat (Telegram for MVP). We replace the back-office — vendor ops, inventory, finance, reviews, scheduling, phone, marketing, compliance — with 8 named AI agents supervised by a small human ops pod.

The customer never logs in. The customer never sees a dashboard. The customer uses Telegram.

We are **built to last**. No VC, no exit, bootstrap forever. Target: 30,000+ independent restaurants by 2055.

Full vision: `docs/VISION.md`.  
Product concept: `docs/PRODUCT.md`.

---

## Current phase

**Between M1 and M2** as of 2026-04-22.

M0 (Foundation) + M1 (Orchestrator + Comms) shipped ~3 weeks ahead of ROADMAP schedule. Staging runs the Concierge catchall agent on Telegram with inline-button approval flow, Langfuse Cloud tracing, and the internal ops-web console. M0 + M1 Linear projects are at 100% milestone progress.

**Next Linear project:** M2 — Sofia Online. Milestone-0 (`M1 debt + Sofia prereqs`) is underway — closes BLU-34 (orchestrator/agent failure paths), BLU-35 (eval harness), BLU-38 (doc actualization), and the M1 retrospective. Sofia build itself (milestones 1–6) is blocked on Track A confirmation from Nick (real vendor relationships are Sofia's training data per ROADMAP Month 2).

Roadmap: `docs/ROADMAP.md`. Linear: **M2 — Sofia Online** (BlueCairn team, key `BLU`).

---

## Architecture principles (non-negotiable)

Every change you make must be consistent with these. If you think a rule should be broken, open an ADR first.

1. **Layers are replaceable in isolation.** The 6-layer model (Interface → Orchestrator → Agents → MCP → Integrations → State) has stable contracts. Don't couple across layer boundaries.
2. **Agents never talk to the outside world directly.** They call MCP tools. They never import vendor SDKs (Square, Twilio, grammY, etc.).
3. **Durability by default.** Any side-effect (sending a message, writing to an external system) runs through Inngest. No `setTimeout`, no raw queues, no custom cron.
4. **Multi-tenant from commit #1.** Every tenant-scoped table has `tenant_id uuid not null`. Every query filters by tenant. RLS enforced at the DB layer.
5. **Prompts are versioned artifacts**, not string literals. They live in `packages/agents/src/<agent-code>/prompt.md` with frontmatter.
6. **Observability before scale.** Every LLM call is traced in Langfuse from Day 1.
7. **Idempotency on the boundary.** Every webhook, every tool call, every user command has an idempotency key.
8. **Human approval is default; autonomy is earned.** Agents default to `approval_required` for new actions. Autonomy is granted per-tenant per-workflow.
9. **Audit everything.** Every agent action, tool call, approval → `audit_log` (immutable).
10. **Fail loud in dev, fail soft in prod.** Dev: throw. Prod: catch, log with tenant_id + correlation_id, degrade or escalate. Never show stack traces to operators.

Full detail: `docs/ARCHITECTURE.md`.

---

## Tech stack (ratified via ADRs)

- **TypeScript strict mode** everywhere. `any` requires a justifying comment. Schema validation at system boundaries (Zod).
- **Bun 1.2+** as runtime. Node 22 LTS fallback.
- **Hono** for HTTP (apps/api).
- **Next.js 15 App Router + shadcn/ui** for internal web apps (ops-web, admin-web).
- **Postgres 16 via Neon** — only primary store. Upstash Redis for ephemeral only.
- **Drizzle ORM** — schema is TS-first, migrations generated from schema.
- **pgvector** for embeddings (1536-dim OpenAI text-embedding-3-small).
- **Vercel AI SDK** — only abstraction over LLM providers. Never import provider SDKs directly.
  - Claude Opus 4.7: primary agent reasoning
  - Claude Haiku: routing, classification
  - GPT-4o Realtime: voice (via Vapi in MVP)
  - Gemini: long-context jobs
- **MCP (Anthropic SDK)** — contract between agents and external capabilities.
- **Inngest Cloud** for durable execution.
- **Langfuse Cloud** (Hobby tier, US region) for LLM observability (ADR-0010). Self-host deferred to Month 12+.
- **Braintrust + Promptfoo** for eval suites.
- **Telegram Bot API via `grammY`** — MVP primary channel. Twilio Conversations (WhatsApp + SMS) deferred to Month 11+.
- **Turborepo** monorepo with Bun workspaces.

---

## Repo layout

```
bluecairn/
├── apps/
│   ├── api/              # Main API (Hono) — webhooks, orchestrator entry
│   ├── workers/          # Inngest functions — agent runs, scheduled jobs
│   ├── ops-web/          # Internal console for ops pod (Next.js)
│   └── admin-web/        # Super-admin console (Next.js)  [M3+]
├── packages/
│   ├── core/             # Shared domain types, utilities
│   ├── db/               # Drizzle schema, migrations, query helpers
│   ├── agents/           # Agent definitions, prompts, policies  [M2+]
│   ├── integrations/     # Vendor adapters (one subpackage per vendor)
│   ├── mcp-servers/      # MCP server implementations  [M1+]
│   ├── evals/            # Eval suites for each agent  [M2+]
│   └── memory/           # Memory store helpers  [M2+]
├── docs/                 # All foundational docs
│   ├── VISION.md
│   ├── PRODUCT.md
│   ├── ARCHITECTURE.md
│   ├── DATA-MODEL.md
│   ├── AGENTS.md
│   ├── ROADMAP.md
│   ├── ENGINEERING.md
│   ├── OPERATIONS.md
│   ├── DECISIONS.md
│   ├── LINEAR-SETUP.md
│   └── adr/
│       └── 0001-... through 0010-*.md
└── .claude/
    ├── CLAUDE.md         # This file
    └── commands/         # Custom slash commands for Claude Code
```

---

## Agents (8 total, in priority order)

| Agent | Persona | Scope | Priority | Ship target |
|---|---|---|---|---|
| `vendor_ops` | **Sofia** | Vendor deliveries, disputes, orders | P0 | Month 2 |
| `inventory` | **Marco** | Stock, reorders, waste | P0 | Month 3 |
| `finance` | **Dana** | Reconciliation, close, anomalies | P0 | Month 3 |
| `review` | **Iris** | Review monitoring + response | P0 | Month 4 |
| `scheduling` | **Leo** | Shift changes, coverage | P1 | Month 5 |
| `phone` | **Nova** | Voice triage, reservations | P1 | Month 6 |
| `marketing` | **Rio** | Campaign execution | P2 | Month 9 |
| `compliance` | **Atlas** | Deadlines, inspection prep | P2 | Month 10 |

Persona names are stable — do NOT rename. Full specs: `docs/AGENTS.md`.

---

## How you (Claude Code) should work

### Before writing any code

1. Read the relevant section of the relevant doc. You are not a magic oracle; the docs encode specific decisions.
2. If the task mentions a Linear issue (e.g., "implement BLU-9"), read the issue description — it contains acceptance criteria, doc links, and out-of-scope notes.
3. If you are uncertain about a design choice, stop and propose a plan before coding.

### Planning pattern (required for non-trivial tasks)

For any task >30 lines of code, any new module, or any cross-file change:

1. Propose a plan: files to change, contracts to establish, tests to write. Present it in a numbered list.
2. Wait for Vlad to approve or amend the plan.
3. Implement against the approved plan.

### Small PRs

Target <300 lines changed per PR. If scope grows, propose decomposition into multiple PRs.

### What you never do without explicit instruction

- Merge PRs (Vlad merges).
- Modify `docs/*.md` or `docs/adr/*.md` (those are intentional edits by Vlad).
- Delete files.
- Bypass CI failures (fix the failure, not the gate).
- Write `any` types (except at untrusted-boundary parsing points, narrowed immediately).
- Import a vendor SDK directly in agent code (use MCP).
- Skip eval updates when changing an agent's prompt or policy.
- Use browser-local storage (localStorage, sessionStorage) — not applicable for this backend project anyway.

### When you catch me making a mistake

Say so. Built-to-last means unvarnished feedback, not politeness. Explain:
- What you observed.
- What principle or ADR it conflicts with.
- What you'd recommend.

---

## Common task templates

### Adding a new Drizzle table

1. Create file `packages/db/src/schema/<domain>/<table>.ts`.
2. Include `tenant_id uuid not null` (unless platform-global).
3. Include `created_at`, `updated_at` (or `created_at` alone for append-only).
4. Add indexes per query patterns (ask about read paths; don't guess).
5. Update `packages/db/src/schema/index.ts` barrel.
6. Run `bunx drizzle-kit generate` — review the generated SQL manually.
7. Add RLS policy in a migration if tenant-scoped.
8. Add to bootstrap script if it needs seed data.
9. Tests: at minimum, insert + query + (if tenant-scoped) cross-tenant leakage test.

### Adding a new agent

1. Read `docs/AGENTS.md` § Agent anatomy.
2. Add row to `agent_definitions` via migration + seed.
3. Create dir `packages/agents/src/<code>/` with:
   - `prompt.md` (frontmatter + content)
   - `meta.ts` (declares model, tools, policies)
   - `tools.ts` (MCP tool registrations)
   - `policies.ts` (default approval policies)
   - `guardrails.ts` (pre-execution checks)
   - `evals/{unit,regression,rubric,adversarial}.{jsonl,md}`
   - `index.ts`
4. Add the agent to orchestrator routing.
5. Update `docs/AGENTS.md` with the agent spec.
6. Ship in **supervised mode only**. Autonomy is earned later per-tenant.

### Adding a new MCP server

1. Read `docs/adr/0003-mcp-as-tool-protocol.md`.
2. Create `packages/mcp-servers/<name>/` with:
   - `package.json`
   - `src/index.ts` — MCP server entry
   - `src/tools/<tool-name>.ts` — one file per tool
   - `README.md` — capability contract
3. Integrations it wraps go in `packages/integrations/<vendor>/` (SDK adapters only, no business logic).
4. Tests: each tool has a happy-path test and an error-path test against mocked vendor API.

### Modifying a prompt

1. Never edit an existing prompt version in place.
2. Create a new version file (e.g., `prompt.md` version: 8).
3. Update `evals/unit.jsonl` with any new expected behaviors.
4. Run `bun run eval <agent-code>` locally — all 4 dimensions must pass.
5. Open PR with eval results pasted in description.
6. After merge, the prompt canaries at 5% for 48h before promoting.

---

## Environment variables

All in `.env.local` for development (not committed). Production uses 1Password/Doppler. Required for M0:

```
# Neon
DATABASE_URL=postgresql://bluecairn_app:***@ep-xxx.neon.tech/bluecairn

# Upstash
REDIS_URL=rediss://default:***@...upstash.io:6379

# Telegram
TELEGRAM_BOT_TOKEN=***
TELEGRAM_WEBHOOK_SECRET=***

# Langfuse Cloud (ADR-0010)
LANGFUSE_HOST=https://us.cloud.langfuse.com
LANGFUSE_PUBLIC_KEY=pk-***
LANGFUSE_SECRET_KEY=sk-***

# LLM providers
ANTHROPIC_API_KEY=sk-ant-***
OPENAI_API_KEY=sk-***  # for embeddings and voice
GOOGLE_GENERATIVE_AI_API_KEY=***  # Gemini, later

# Inngest
INNGEST_EVENT_KEY=***
INNGEST_SIGNING_KEY=signkey-***
```

See `.env.example` in the repo root.

---

## Things that hurt if you forget them

A hard-learned list. Check against it when something seems off.

- **RLS silently returns zero rows** if `app.current_tenant` isn't set. If a query mysteriously returns nothing: check that the session is configured.
- **Bigint is returned as bigint, not number**, from Postgres. Money arithmetic must use `BigInt` types, not `Number`.
- **Timestamptz stores UTC**. Display is localized at the render layer. Don't store `America/Los_Angeles` times.
- **Drizzle doesn't generate triggers or CHECK constraints**. Write them as raw SQL in a separate migration.
- **Turborepo caches build output**. If you change something and don't see it reflected, run `bunx turbo run build --force`.
- **`strict: true` + `noUncheckedIndexedAccess: true`** makes `arr[0]` of type `T | undefined`. Handle it. Don't cast.
- **Telegram webhook must respond within 5s** or Telegram treats it as failed. Long work goes to Inngest, not inline.
- **Neon dev branches are cheap** — use them liberally for migration testing. Don't push untested migrations to staging.

---

## Links

- **Linear team**: https://linear.app/oveglobal/team/BLU/active
- **Current project**: see Linear, project "M2 — Sofia Online"
- **GitHub repo**: https://github.com/abakymuk/bluecairn
- **Neon**: console.neon.tech (project `bluecairn`)
- **Langfuse**: https://us.cloud.langfuse.com (Cloud Hobby US, ADR-0010)

---

*Keep this file under 400 lines. If it grows, split by domain into `.claude/context/*.md` files.*
