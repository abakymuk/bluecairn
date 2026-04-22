# @bluecairn/ops-web

Internal console for the BlueCairn ops pod (Vlad + Nick in M1, growing
later). Next.js 15 App Router + Tailwind 4 + shadcn/ui + Better Auth +
Google OAuth with an email allow-list.

Per [ADR-0007](../../docs/adr/0007-chat-first-no-customer-dashboard.md),
ops-web is **never** customer-facing. Customers only use Telegram.

## Routes

| Path                | Auth        | Purpose                                                      |
| ------------------- | ----------- | ------------------------------------------------------------ |
| `/`                 | public      | Landing / sign-in card. Redirects to `/threads` if authed.   |
| `/threads`          | ops allow   | Placeholder for BLU-27 thread viewer.                        |
| `/api/auth/*`       | public      | Better Auth catchall (sign in, callback, sign out, session). |
| `/api/health`       | public      | Unauthed liveness probe for Railway + BLU-36 CI sync job.    |

## Auth model

- **Provider**: Google OAuth only (M1).
- **Storage**: Better Auth's Drizzle adapter writes into the shared
  Neon Postgres via the `auth_user`, `auth_session`, `auth_account`,
  `auth_verification` tables (see
  `packages/db/src/schema/auth/` and `migrations-manual/0005_auth_tables.sql`).
- **Session**: 7-day expiry with 1-day sliding window.
- **Allow-list**: server-side check in `(authed)/layout.tsx` against
  `OPS_WEB_ALLOWED_EMAILS` (comma-separated, lowercased, trimmed). Non-
  allowed emails land on a 403 panel; the signed-in row still exists in
  `auth_session` (observable audit of who tried).
- **Edge middleware**: fast cookie-presence check — redirect to `/` if
  absent. Authoritative session validation happens server-side in the
  authed layout.

## Local dev

```bash
cp apps/ops-web/.env.example apps/ops-web/.env.local
# Fill in DATABASE_URL, BETTER_AUTH_SECRET, Google OAuth creds (1Password),
# and your @gmail on OPS_WEB_ALLOWED_EMAILS.

# From the repo root:
bun install
# One-time DB migration for the auth_* tables:
doppler run --config dev -- bash -c 'psql "$DATABASE_URL_ADMIN" -f packages/db/migrations-manual/0005_auth_tables.sql'

# Start the dev server:
doppler run --config dev -- bun run --cwd apps/ops-web dev
# → http://localhost:3002
```

## Google OAuth setup (one-time)

1. Google Cloud Console → **APIs & Services → Credentials** → _Create
   Credentials → OAuth 2.0 Client ID_.
2. Type: **Web application**. Name: `BlueCairn ops-web`.
3. Authorized redirect URIs:
   - `http://localhost:3002/api/auth/callback/google` (dev)
   - `https://ops-web-staging-<hash>.up.railway.app/api/auth/callback/google` (stg — paste actual Railway domain)
4. Save the client ID + secret into 1Password (vault: `BlueCairn → Platform`).
5. Push to Doppler:
   ```bash
   doppler secrets set --config dev GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… --silent
   doppler secrets set --config stg GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… --silent
   ```

## Staging deploy (Railway)

- **Service name**: `ops-web-staging` (to be created in Railway
  dashboard, environment `staging`).
- **Config file**: `apps/ops-web/railway.json` (this repo).
- **Build**: Nixpacks — `bun install --frozen-lockfile && bun run --cwd apps/ops-web build`.
- **Start**: `bun run --cwd apps/ops-web start`.
- **Healthcheck**: `GET /api/health`.
- **Secrets**: Doppler `stg` auto-syncs via the integration
  ([BLU-31](https://linear.app/oveglobal/issue/BLU-31)). Required vars:
  - `DATABASE_URL`, `DATABASE_URL_ADMIN` (Neon)
  - `BETTER_AUTH_SECRET` (`openssl rand -base64 48`)
  - `BETTER_AUTH_URL` = public Railway URL (e.g. `https://ops-web-staging-<hash>.up.railway.app`)
  - `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (same creds as dev OR separate staging project in Google Console)
  - `OPS_WEB_ALLOWED_EMAILS`

After first deploy, run the auth-table migration against staging:

```bash
doppler run --config stg -- bash -c 'psql "$DATABASE_URL_ADMIN" -f packages/db/migrations-manual/0005_auth_tables.sql'
```

Verify:

```bash
curl -sfS https://ops-web-staging-<hash>.up.railway.app/api/health | jq .
# → {"status":"ok","service":"ops-web","deployedSha":"…"}
```

## Infra checklist for BLU-26 ship

- [ ] Google OAuth web client created (dev + staging redirect URIs)
- [ ] 1Password entry: `BlueCairn / Platform / Google OAuth ops-web` (client id + secret)
- [ ] 1Password entry: `BlueCairn / Platform / Better Auth secret` (48-char random)
- [ ] Doppler `dev` has 5 new vars: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPS_WEB_ALLOWED_EMAILS`
- [ ] Doppler `stg` has the same 5 vars (may share Google creds with dev)
- [ ] Neon `stg` has `auth_*` tables (run migration 0005)
- [ ] Neon `dev` has `auth_*` tables (run migration 0005)
- [ ] Railway service `ops-web-staging` created + linked to GitHub + Doppler
- [ ] Railway custom domain (optional, later) — M1 stays on `*.up.railway.app`
- [ ] First login smoke: Vlad signs in via Google → redirects to `/threads` → sees ops-web online
- [ ] Negative smoke: non-allow-listed Google account → lands on 403 panel

## Known limitations (BLU-26 scope)

- **No tenant-scoped data**. `/threads` is a placeholder; the real
  read-only thread viewer ships in
  [BLU-27](https://linear.app/oveglobal/issue/BLU-27).
- **No user management UI**. The allow-list is env-only for M1.
  Changing it requires `doppler secrets set` + Railway redeploy (or
  Doppler→Railway sync if BLU-31 live sync is configured).
- **No custom domain**. Stays on Railway's generated subdomain. If the
  subdomain ever rotates, update `BETTER_AUTH_URL` + Google OAuth
  redirect URI + document in CLAUDE.md.
- **No real-time updates**. BLU-27 decides polling vs SSE. Default is
  poll.
- **No CSRF token on the sign-in button**. Better Auth handles its own
  CSRF state internally via cookies; we don't expose any additional
  form on the landing page.
