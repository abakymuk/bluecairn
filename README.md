# BlueCairn

An operational partner for independent restaurants, delivered through chat.

BlueCairn replaces the back-office layer of a restaurant — vendor management, inventory, daily finance, reviews, scheduling, phone, marketing, compliance — with a team of AI agents supervised by a small human ops pod. The operator interacts with everything through a single Telegram thread. No dashboard. No app to install. No more admin after 10pm.

## Who we serve

Independent restaurant operators in the US, roughly $1M–$5M annual revenue, 5–25 employees, owner-operator format. Fast-casual, neighborhood casual, bakery-café, small ethnic, coffee+food. See `docs/PRODUCT.md` § Who we serve.

## Status

**Month 0 — Foundation**, April 2026. Building the platform. No external customers yet. First external pilot: Month 12.

Current project tracking: Linear workspace `oveglobal`, team `BlueCairn` (key `BLU`), project `M0 — Foundation`.

## Documents — read in this order

**Strategic** (read first):
1. [`docs/VISION.md`](./docs/VISION.md) — why we exist, what we're building toward
2. [`docs/PRODUCT.md`](./docs/PRODUCT.md) — what we build and for whom
3. [`docs/ROADMAP.md`](./docs/ROADMAP.md) — 18-month plan

**Technical** (required for any engineering work):
4. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 6-layer model, 10 principles
5. [`docs/DATA-MODEL.md`](./docs/DATA-MODEL.md) — schema
6. [`docs/AGENTS.md`](./docs/AGENTS.md) — the 8 agents
7. [`docs/ENGINEERING.md`](./docs/ENGINEERING.md) — code discipline
8. [`docs/DECISIONS.md`](./docs/DECISIONS.md) — index of ADRs

**Operational**:
9. [`docs/OPERATIONS.md`](./docs/OPERATIONS.md) — for Nick (cofounder, operator)
10. [`docs/LINEAR-SETUP.md`](./docs/LINEAR-SETUP.md) — Linear configuration

## Quick start

```bash
# Clone (once GitHub repo exists)
git clone git@github.com:abakymuk/bluecairn.git
cd bluecairn

# Install dependencies
bun install

# Copy env template
cp .env.example .env.local
# Fill in values — see .claude/CLAUDE.md § Environment variables

# Run the API (after env is configured)
bun run dev

# Run the DB push (first time only)
bun run db:push
```

Full setup: see `docs/LINEAR-SETUP.md` and the Linear issue `BLU-6` (monorepo init).

## Structure

```
bluecairn/
├── apps/
│   ├── api/              # Main API (Hono) — webhooks, orchestrator
│   ├── workers/          # Inngest durable functions  [M1+]
│   ├── ops-web/          # Internal console (Next.js)  [M1+]
│   └── admin-web/        # Super-admin console         [M3+]
├── packages/
│   ├── core/             # Shared types, utilities
│   ├── db/               # Drizzle schema & migrations
│   ├── agents/           # Agent prompts, tools, policies  [M2+]
│   ├── integrations/     # Vendor adapters
│   ├── mcp-servers/      # MCP servers                     [M1+]
│   ├── evals/            # Eval suites                     [M2+]
│   └── memory/           # Memory store helpers            [M2+]
├── docs/                 # Foundational docs + ADRs
│   └── adr/
└── .claude/              # Claude Code context
```

## Contributing

Solo project for now (Vlad). First team engineer joins Month 15 per ROADMAP.

When someone new joins:
1. Read all 10 docs listed above, in order.
2. Read `.claude/CLAUDE.md`.
3. Set up dev environment per Quick start.
4. Pick a starter issue (label `type/docs` or trivial `type/refactor`).
5. Open first PR with Vlad as reviewer.

## License

Proprietary — all rights reserved, BlueCairn Operations LLC.  
Contact: vlad@bluecairn.app (once domain provisioned).
