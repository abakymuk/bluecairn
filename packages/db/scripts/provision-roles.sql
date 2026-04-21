-- provision-roles.sql
-- Create the `bluecairn_app` and `bluecairn_admin` roles on a Neon branch.
-- Apply once per branch (main, staging, dev) connected as the Neon-provisioned
-- owner role (typically `neondb_owner`).
--
-- How to run (ONCE per branch — this is not safe to re-run via SQL on Neon):
--   1. Generate two strong passwords:
--        openssl rand -base64 32 | tr -d '/+=' | cut -c1-32
--   2. Replace REPLACE_APP_PASSWORD and REPLACE_ADMIN_PASSWORD below with the
--      generated values. Keep the single quotes.
--   3. Paste into any SQL client (Neon SQL Editor / psql / DataGrip / ...) and
--      run. Make sure the current role is `neondb_owner`.
--
-- If you need to re-provision a branch: delete both roles via Neon Console
-- (Branches → [branch] → Roles tab → Delete). Neon's control plane can drop
-- roles that SQL-level DROP OWNED BY / DROP ROLE cannot, because of Postgres
-- 16 + Neon permission constraints on grant chains. Then re-run this script.
--
-- Notes on the pattern:
--   - This script is one-shot per branch. Postgres 16 + Neon permission
--     constraints make SQL-level DROP ROLE / DROP OWNED BY unreliable once
--     grants exist. Use the Neon Console to delete roles before re-running.
--   - Plain SQL only — runs in any SQL client (Neon editor, psql, DataGrip).
--     No psql variable substitution, no DO blocks, no EXPLAIN incompatibilities.
--
-- Matches Linear issue BLU-3.

-- =============================================================================
-- 1. Create roles with password inline
-- =============================================================================
-- If the role already exists, CREATE ROLE will error. Delete via Neon Console
-- and re-run (see header). Do NOT attempt SQL-level cleanup — DROP OWNED BY
-- and DROP ROLE both fail under typical Neon permission constraints.

-- Application role. NOBYPASSRLS so RLS enforces tenant isolation.
CREATE ROLE bluecairn_app
  LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE
  PASSWORD 'REPLACE_APP_PASSWORD';

-- Migrations/ops role. Not a superuser; RLS doesn't restrict DDL so BYPASSRLS
-- is unnecessary. For rare DML that must ignore RLS, use `set local
-- row_security = off` in-session instead of granting BYPASSRLS.
CREATE ROLE bluecairn_admin
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  PASSWORD 'REPLACE_ADMIN_PASSWORD';

-- =============================================================================
-- 2. Minimum privileges
-- =============================================================================
-- Both roles need to connect and see the public schema. Table-level grants are
-- issued by the schema migration (separate Linear issue, not BLU-3).

GRANT CONNECT ON DATABASE bluecairn TO bluecairn_app, bluecairn_admin;
GRANT USAGE   ON SCHEMA   public    TO bluecairn_app, bluecairn_admin;

-- bluecairn_admin needs CREATE on schema public to run migrations (create
-- tables, functions, extensions' SQL objects). Neon's default-owned `public`
-- only grants USAGE; CREATE must be granted explicitly.
GRANT CREATE  ON SCHEMA   public    TO bluecairn_admin;

-- =============================================================================
-- 3. Verification
-- =============================================================================
-- Expect:
--   bluecairn_app    rolsuper=f  rolbypassrls=f  rolcanlogin=t
--   bluecairn_admin  rolsuper=f  rolbypassrls=f  rolcanlogin=t

SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM   pg_roles
WHERE  rolname LIKE 'bluecairn_%'
ORDER  BY rolname;

-- =============================================================================
-- Password rotation
-- =============================================================================
-- Do NOT re-run this script to rotate. For rotation, run only:
--
--   ALTER ROLE bluecairn_app   WITH PASSWORD 'NEW_APP_PASSWORD';
--   ALTER ROLE bluecairn_admin WITH PASSWORD 'NEW_ADMIN_PASSWORD';
--
-- If ALTER fails with "permission denied", the connected role didn't create
-- the target role (Postgres 16 + Neon restriction). Workaround: rotate the
-- password via Neon Console (Branches → [branch] → Roles → role → Reset password).
