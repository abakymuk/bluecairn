# @bluecairn/workers

Inngest durable-execution layer (ADR-0004). Hosts the serve handler that
Inngest Cloud (or the local Inngest dev CLI) invokes for every registered
function. All durable side-effects — agent runs, MCP tool calls, approval
gates, scheduled jobs — land here.

## Routes

| Path            | Method      | Purpose                                         |
| --------------- | ----------- | ----------------------------------------------- |
| `/health`       | GET         | Liveness probe for Railway / uptime monitoring. |
| `/api/inngest`  | GET/POST/PUT| Inngest handshake + function invocations.       |

## Functions

| Name            | Event trigger     | Purpose                                      |
| --------------- | ----------------- | -------------------------------------------- |
| `hello-world`   | `debug.ping`      | BLU-18 smoke. Will be removed once real      |
|                 |                   | functions land in BLU-22 / BLU-23 / BLU-25.  |

Planned next:

- `orchestrator.route` — BLU-22 — classifies `thread.message.received` and
  emits `agent.run.requested`.
- `agent.concierge.run` — BLU-23 — executes the Concierge catchall agent.
- `action.gate` — BLU-25 — approval-gated action execution with
  `step.waitForEvent('approval.decision.recorded')`.

## Local dev

```bash
# Terminal 1 — workers dev server on :3001
doppler run --config dev -- bun run --cwd apps/workers dev

# Terminal 2 — Inngest dev CLI on :8288. Auto-registers `/api/inngest`.
# First run downloads the binary; use --ignore-scripts=false under bun/npm
# because Bun skips post-install scripts by default.
NPM_CONFIG_CACHE=$(mktemp -d) npx --ignore-scripts=false -y inngest-cli@latest \
  dev -u http://localhost:3001/api/inngest

# Open http://localhost:8288 for the dev dashboard.
# Fire a smoke event:
curl -X POST 'http://localhost:8288/e/dev' \
  -H 'Content-Type: application/json' \
  -d '{"name":"debug.ping","data":{"ping_id":"local-smoke"}}'

# Workers logs should show: "debug.ping received" with the ping_id.
```

## Deploy (Railway staging)

- **Service**: `workers-staging` in Railway project `bluecairn`, environment `staging`.
- **Config path**: `apps/workers/railway.json` (the file in this directory).
- **Build**: Nixpacks with `bun install --frozen-lockfile && bun run --cwd apps/workers build`.
- **Start**: `bun run --cwd apps/workers start`.
- **Healthcheck**: `GET /health` — JSON includes `deployedSha` from Railway's
  auto-injected `RAILWAY_GIT_COMMIT_SHA`. CI uses this to detect deploy completion.
- **Secrets**: Doppler `stg` sync — requires `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` from Inngest Cloud → staging environment.
- **Inngest webhook**: once deployed, register the public URL (e.g. `https://workers-staging.up.railway.app/api/inngest`) in Inngest Cloud → Apps → `bluecairn` → staging environment. Inngest pings the URL; discovered functions appear in the dashboard.

### Auto-sync Inngest Cloud after deploy (BLU-36)

Each push to `main` that changes `apps/workers/src/functions/**` must be
followed by an Inngest Cloud sync — otherwise the Dashboard keeps serving
the previous function manifest and new events go unconsumed.

This is automated in `.github/workflows/ci.yml` via the `sync-inngest-staging`
job, which runs after `verify` passes on main:

1. Polls `$WORKERS_URL/health` (5s intervals, 5min timeout) until
   `deployedSha == github.sha` — guarantees Railway's rolling deploy has
   rotated to the new revision before we sync.
2. `curl -X PUT $WORKERS_URL/api/inngest --fail-with-body` — the Inngest
   `serve()` handler reads its current function manifest and pushes it to
   Inngest Cloud using the worker's `INNGEST_SIGNING_KEY`. Idempotent.

No new secrets required — the workers URL is a public non-sensitive subdomain
(stored as a workflow env, not a secret). Auth to Inngest Cloud uses the
already-provisioned `INNGEST_SIGNING_KEY` on the workers side.

If Railway regenerates the workers-staging subdomain (rare), update the
`WORKERS_URL` env in `.github/workflows/ci.yml`.

**Manual fallback** (if CI job fails or pre-BLU-36 branch): click "Sync" in
[Inngest Dashboard](https://app.inngest.com) → staging env → Apps →
`bluecairn-workers`. Or from any machine with the workers URL:

```bash
curl -X PUT https://workers-staging-staging-8181.up.railway.app/api/inngest --fail-with-body
```

Dogfood after deploy: fire `debug.ping` from the Inngest Cloud dashboard →
expect a green `hello-world` run within a few seconds.

See `../../apps/api/railway.json` for the companion API service config.
