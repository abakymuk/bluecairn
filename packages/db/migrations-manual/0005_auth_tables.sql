-- 0005_auth_tables.sql
-- BLU-26: Better Auth tables for ops-web. Platform-global, RLS NOT applied.
--
-- Table prefix `auth_` keeps these clearly separate from the domain
-- `users` / `tenants` tables. Ops-pod operators log in via Google OAuth;
-- Better Auth writes into these tables; ops-web reads from them through
-- the Drizzle adapter (`apps/ops-web/src/lib/auth.ts`).
--
-- Idempotent: safe to re-run (IF NOT EXISTS guards).
--
-- Apply:
--   doppler run --config dev -- bash -c 'psql "$DATABASE_URL_ADMIN" -f packages/db/migrations-manual/0005_auth_tables.sql'
--   doppler run --config stg -- bash -c 'psql "$DATABASE_URL_ADMIN" -f packages/db/migrations-manual/0005_auth_tables.sql'
--
-- See ADR-0006 (multi-tenant). These are explicitly single-tenant-equivalent
-- (one ops pod across all customer tenants); no tenant_id column is ever
-- added. Cross-tenant authorization lives in application code.

-- -----------------------------------------------------------------------------
-- auth_user — one row per Google identity that can sign in to ops-web.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_user (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  image          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- auth_session — one row per active browser session.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_session (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_session_user ON auth_session (user_id);

-- -----------------------------------------------------------------------------
-- auth_account — one row per (user, provider) tuple. Stores OAuth tokens.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_account (
  id                         TEXT PRIMARY KEY,
  account_id                 TEXT NOT NULL,
  provider_id                TEXT NOT NULL,
  user_id                    TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  access_token               TEXT,
  refresh_token              TEXT,
  id_token                   TEXT,
  access_token_expires_at    TIMESTAMPTZ,
  refresh_token_expires_at   TIMESTAMPTZ,
  scope                      TEXT,
  password                   TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_account_user ON auth_account (user_id);

-- -----------------------------------------------------------------------------
-- auth_verification — ephemeral verification challenges (not used by Google
-- OAuth alone, but Better Auth's schema requires it).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_verification (
  id          TEXT PRIMARY KEY,
  identifier  TEXT NOT NULL,
  value       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_verification_identifier ON auth_verification (identifier);

-- -----------------------------------------------------------------------------
-- RLS: intentionally NOT enabled on any auth_* table. These are
-- platform-global per ADR-0006 (similar posture to `users`, `tenants`,
-- `agent_definitions`, `prompts`). Authorization of who can log in is
-- enforced by the OPS_WEB_ALLOWED_EMAILS env allow-list in ops-web's
-- middleware + layout, not at the row level.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Grants for bluecairn_app (the RLS-subject role used by ops-web server
-- code). bluecairn_admin already has table-owner privileges.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluecairn_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth_user, auth_session, auth_account, auth_verification TO bluecairn_app;
  END IF;
END $$;
