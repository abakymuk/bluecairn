-- 0001_enable_extensions.sql
-- Run BEFORE the Drizzle-generated initial migration (0000_init.sql).
--
-- Drizzle can't generate extension enables or session settings. These are
-- prerequisites for the schema.
--
-- Apply via: psql $DATABASE_URL_ADMIN -f migrations-manual/0001_enable_extensions.sql

-- -----------------------------------------------------------------------------
-- pgvector extension (for memory_entries and threads.summary_embedding)
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- Custom GUC (Grand Unified Configuration) parameters for RLS
-- -----------------------------------------------------------------------------
-- These let the application set per-request tenant context via:
--   set local app.current_tenant = '<uuid>';
--   set local app.correlation_id = '<uuid>';
--
-- Postgres requires custom parameters to be declared before they can be set.

-- The 'app' namespace must be registered for custom parameters.
-- (On Neon this works automatically; on self-hosted Postgres you may need
--  to add `app.current_tenant = ''` to postgresql.conf.)

-- -----------------------------------------------------------------------------
-- Convenience function: get current tenant from session
-- -----------------------------------------------------------------------------
-- Wrapped so RLS policies don't have to inline current_setting() every time
-- and errors are clearer if the session variable isn't set.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$
    SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid;
  $$;

COMMENT ON FUNCTION current_tenant_id() IS
  'Returns the tenant_id set for the current session via `set local app.current_tenant = <uuid>`. Returns NULL if not set — RLS policies treat this as "no access".';
