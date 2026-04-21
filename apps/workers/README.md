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
- **Healthcheck**: `GET /health`.
- **Secrets**: Doppler `stg` sync — requires `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` from Inngest Cloud → staging environment.
- **Inngest webhook**: once deployed, register the public URL (e.g. `https://workers-staging.up.railway.app/api/inngest`) in Inngest Cloud → Apps → `bluecairn` → staging environment. Inngest pings the URL; discovered functions appear in the dashboard.

Dogfood after deploy: fire `debug.ping` from the Inngest Cloud dashboard →
expect a green `hello-world` run within a few seconds.

See `../../apps/api/railway.json` for the companion API service config.
