# DB scripts

Operational scripts for the Postgres (Neon) backend. Not part of the published `@bluecairn/db` API surface.

| Script | Purpose | Linear |
|---|---|---|
| `provision-roles.sql` | Create `bluecairn_app` + `bluecairn_admin` roles on a Neon branch | BLU-3 |
| `grant-app-privileges.sql` | Grant `bluecairn_app` DML + set default privileges for future tables | BLU-12 |
| `seed-agent-definitions.sql` | Seed the 8 agents into `agent_definitions` | BLU-10 |
| `bootstrap-internal-tenant.ts` | Seed the `bluecairn-internal` tenant for dogfooding | BLU-14 |
| `setup-ci-db.sh` | One-shot full bootstrap for CI / clean-room Docker Postgres | BLU-15 |
| `migrate-staging-initial.sh` | One-time initial migration of the staging Neon branch | BLU-17 |
| `add-internal-telegram-channel.sql` | Add a secondary Telegram chat_id to the `bluecairn-internal` tenant (e.g. onboarding Nick, a second device) | follow-up |

---

## BLU-3 — Provision Neon project with dev + staging branches

End-to-end runbook. Most steps run outside the repo (Neon console, Doppler). Apply once.

### 1. Neon project + branches

Via [console.neon.tech](https://console.neon.tech):

1. New project: name `bluecairn`, Postgres 16, region `aws-us-west-2`, database name `bluecairn`.
2. The default branch is `main` — rename if Neon calls it anything else. Enable branch protection on `main`.
3. Create branch `staging` from `main`.
4. Create branch `dev` from `main`.
5. For each branch, copy both the **pooled** and **unpooled (direct)** connection strings from the Neon dashboard — you need both. The owner role Neon provisioned (typically `neondb_owner` or similar) is what you use to run `provision-roles.sql` and nothing else.

### 2. Create the app + admin roles on each branch

Run the SQL three times, once per branch. The script is plain SQL — works in `psql`, the Neon SQL Editor, DataGrip, or any client. No psql-specific features.

```bash
# Generate six strong passwords (one per role per branch); stash in 1Password.
for n in app_main admin_main app_staging admin_staging app_dev admin_dev; do
  printf '%s=%s\n' "$n" "$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)"
done
```

For each branch:

1. Open the Neon SQL Editor on that branch, connected as the Neon-provisioned owner (Neon's editor uses the owner role by default).
2. Paste the contents of `packages/db/scripts/provision-roles.sql`.
3. Replace `REPLACE_APP_PASSWORD` and `REPLACE_ADMIN_PASSWORD` with the branch's passwords (keep the single quotes).
4. Run.

Or via psql:

```bash
# Edit the file or use sed to substitute the two placeholders, then:
psql "<neon_owner_unpooled_url_for_dev>" -f packages/db/scripts/provision-roles.sql
```

The final `SELECT` prints the role attributes. Confirm:
- `bluecairn_app`: `rolsuper = f`, `rolbypassrls = f`, `rolcanlogin = t`
- `bluecairn_admin`: `rolsuper = f`, `rolcanlogin = t`

Repeat for `staging` and `main` with their own passwords + owner URLs. If the database on a branch is not named `bluecairn`, change the `GRANT CONNECT ON DATABASE bluecairn` line to match.

**Rotation**: run only the `ALTER ROLE ... PASSWORD ...` block at the bottom of the SQL file. Do not re-run `CREATE ROLE` — it errors on duplicates.

### 3. Build the connection strings

Replace the Neon-owner user + password in each branch's connection string with the role-specific credentials. For each branch you end up with:

- `DATABASE_URL` — `postgresql://bluecairn_app:<app_pass>@<branch-pooled-host>/bluecairn?sslmode=require`
- `DATABASE_URL_ADMIN` — `postgresql://bluecairn_admin:<admin_pass>@<branch-unpooled-host>/bluecairn?sslmode=require`

The app role uses the **pooled** endpoint (app traffic). The admin role uses the **unpooled (direct)** endpoint — migrations and `drizzle-kit` need direct connections because the pooler disables some session features.

### 4. Store in Doppler

```bash
brew install dopplerhq/cli/doppler
doppler login
doppler setup --project bluecairn --config dev   # run from repo root
```

Then for each config, paste in the two URLs above (no file commits):

| Neon branch | Doppler config | `DATABASE_URL`                   | `DATABASE_URL_ADMIN`              |
|---          |---             |---                               |---                                |
| `dev`       | `dev`          | app role, pooled                 | admin role, unpooled              |
| `staging`   | `stg`          | app role, pooled                 | admin role, unpooled              |
| `main`      | `prd`          | app role, pooled                 | admin role, unpooled              |

Doppler UI or CLI:

```bash
doppler secrets set --project bluecairn --config dev DATABASE_URL='postgresql://bluecairn_app:...@.../bluecairn?sslmode=require'
doppler secrets set --project bluecairn --config dev DATABASE_URL_ADMIN='postgresql://bluecairn_admin:...@.../bluecairn?sslmode=require'
# repeat for stg and prd
```

### 5. Verify (acceptance criteria)

```bash
# AC1 + AC2 — project + 3 branches visible in Neon Console.

# AC3 — can connect to dev branch from local
doppler run --project bluecairn --config dev -- \
  sh -c 'psql "$DATABASE_URL" -c "select current_user, version();"'
# expect: current_user = bluecairn_app

# AC4 — bluecairn_app lacks BYPASSRLS on every branch
for cfg in dev stg prd; do
  echo "=== $cfg ==="
  doppler run --project bluecairn --config "$cfg" -- \
    sh -c 'psql "$DATABASE_URL_ADMIN" -c "select rolname, rolbypassrls from pg_roles where rolname like '\''bluecairn_%'\'' order by rolname;"'
done
# expect: bluecairn_app | f  (on every config)

# AC5 — no real connection strings in git (matches only a 16+ char alphanum
# password character; placeholders like `***`, `...`, `<pw>`, `PASSWORD` do not
# match).
git -C /Users/abakymuk/BlueCairn/bluecairn grep -E 'postgresql://bluecairn_(app|admin):[A-Za-z0-9+/=]{16,}' || echo 'clean'
```

**Note on `sh -c`**: doppler injects env vars into the subprocess, but if you write `psql "$DATABASE_URL"` directly after `doppler run --`, zsh expands `$DATABASE_URL` *before* doppler runs (at command-parse time, when it's empty) and psql falls back to the local socket. Wrapping in `sh -c '…'` defers expansion until the subprocess runs with the injected vars.

### Out of scope (BLU-3)

Handled in later issues:
- Extension enables, RLS policies, audit triggers — `migrations-manual/0001`–`0003`.
- Initial Drizzle schema push — `bun run db:generate && bun run db:push`.
- Table/sequence `GRANT`s to `bluecairn_app` — applied by the schema migration issue (it knows which tables exist).
- Internal tenant seed — `bootstrap-internal-tenant.ts` (BLU-14).

---

## BLU-17 — Staging deploy (Railway)

### 1. Migrate the staging Neon branch (one-time)

As `neondb_owner` in Neon Console SQL Editor on the **staging** branch:

```sql
GRANT CREATE ON SCHEMA public TO bluecairn_admin;
```

Populate Doppler `stg` config with values from 1Password (BLU-3 saved them as `DATABASE_URL_STAGING` and `DATABASE_URL_ADMIN_STAGING`):

- `DATABASE_URL` ← `DATABASE_URL_STAGING`
- `DATABASE_URL_ADMIN` ← `DATABASE_URL_ADMIN_STAGING`

Then from the repo root:

```bash
doppler run --project bluecairn --config stg -- bash packages/db/scripts/migrate-staging-initial.sh
```

Expected output: 6 steps end with `✓ Staging migration complete.` Tables visible in Neon Console → staging → Tables.

### 2. Populate the rest of Doppler stg

Reuse the dev values for now (same internal bot, same Langfuse project):

- `TELEGRAM_BOT_TOKEN` — copy from Doppler dev
- `TELEGRAM_WEBHOOK_SECRET` — copy from Doppler dev
- `LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` — copy from Doppler dev
- `NODE_ENV=staging`
- `LOG_LEVEL=info`

When we have a dedicated production bot + separate Langfuse project (later ticket), stg will diverge.

### 3. Railway project

1. [railway.com](https://railway.com) → New Project → Deploy from GitHub repo → pick `abakymuk/bluecairn` → grant Railway access.
2. Service name: `api-staging`. Root directory: `/`. Railway auto-detects `railway.json` at the repo root.
3. Deploy → Settings → **Wait for CI** (toggle on) so deploys only happen after GitHub Actions `verify` passes.
4. Service → Variables → **Connect Doppler**:
   - Authorize Railway to read Doppler
   - Select project `bluecairn`, config `stg`
   - Secrets flow in automatically; updates sync live.

First deploy kicks off on merge to `main`. Railway assigns a URL like `https://api-staging-<slug>.up.railway.app`.

### 4. Verify deploy

```bash
curl -s https://<your-railway-url>/health | jq
# expect: {"status":"ok","service":"api","env":"staging","timestamp":"..."}
```

### 5. Set the Telegram webhook

```bash
doppler run --project bluecairn --config stg -- sh -c \
  'curl -sX POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d "url=https://<your-railway-url>/webhooks/telegram" \
     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" | jq'
# expect: {"ok":true,"result":true,"description":"Webhook was set"}
```

Confirm:

```bash
doppler run --project bluecairn --config stg -- sh -c \
  'curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq'
```

### 6. Live test — first inbound message (closes BLU-13 AC #6)

1. Open `@bluecairn_internal_bot` in Telegram, send any message (e.g. `/start` followed by `hello from staging`).
2. Within ~10s, row appears in `messages` on staging:

```bash
doppler run --project bluecairn --config stg -- sh -c \
  'psql "$DATABASE_URL_ADMIN" -c "SELECT id, content, created_at FROM messages ORDER BY created_at DESC LIMIT 3"'
```

### Redeploys

Push to `main` → CI runs → on green, Railway deploys. No other steps unless schema changes.

**When schema changes**: update migration files, apply to dev/stg/main Neon branches manually **before** merging to `main`. Deploy workflow assumes schema is already in sync.
