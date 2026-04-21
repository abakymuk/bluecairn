-- grant-app-privileges.sql
-- Grant bluecairn_app the DML privileges it needs to query and modify tables.
-- RLS enforces WHICH rows are visible; these grants enable the SQL operations
-- themselves (a role with no grant can't even see the table exists).
--
-- Idempotent: safe to re-run.
--
-- Run as bluecairn_admin (owner of all application tables) AFTER tables exist.
-- Apply: psql "$DATABASE_URL_ADMIN" -f packages/db/scripts/grant-app-privileges.sql
--
-- Matches Linear issue BLU-12.

-- =============================================================================
-- 1. Grant on existing tables + sequences
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO bluecairn_app;
GRANT USAGE,  SELECT                 ON ALL SEQUENCES IN SCHEMA public TO bluecairn_app;

-- =============================================================================
-- 2. Default privileges for future tables
-- =============================================================================
-- When bluecairn_admin (this role, running this script) creates new tables or
-- sequences in `public` later, they auto-grant to bluecairn_app. Keeps future
-- migrations from re-hitting the "permission denied" trap.

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO bluecairn_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE,  SELECT                 ON SEQUENCES TO bluecairn_app;

-- =============================================================================
-- 3. Verify
-- =============================================================================

SELECT grantee, table_name, privilege_type
FROM   information_schema.role_table_grants
WHERE  grantee = 'bluecairn_app' AND table_schema = 'public'
ORDER  BY table_name, privilege_type
LIMIT  20;
