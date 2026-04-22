-- 0006_audit_log_auth_user.sql
-- BLU-27: link audit_log entries to Better Auth ops-pod identities.
--
-- Context: audit_log.user_id references the domain `users` table (uuid PK),
-- but Better Auth stores ops-pod operators in `auth_user` (text PK). ops-web
-- thread viewer writes `ops_web_read` audit entries and needs to record
-- WHO read WHAT — we add a separate nullable `auth_user_id` column rather
-- than widening `user_id` or dropping the FK, to keep the two identity
-- domains cleanly separated.
--
-- After this migration:
--   - user_id       — domain-user actor (tenant user, future ops-pod bridge)
--   - auth_user_id  — Better Auth ops-pod actor (who logged into ops-web)
-- Either or both can be null; system-generated events leave both null.
--
-- Idempotent (IF NOT EXISTS guards). Safe to re-run.
--
-- Apply:
--   doppler run --config dev -- bash -c 'psql "$DATABASE_URL_ADMIN" -f packages/db/migrations-manual/0006_audit_log_auth_user.sql'
--   doppler run --config stg -- bash -c 'psql "$DATABASE_URL_ADMIN" -f packages/db/migrations-manual/0006_audit_log_auth_user.sql'

-- Add the column (nullable, no default — back-fills as NULL for existing rows).
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS auth_user_id TEXT;

-- FK to auth_user. ON DELETE SET NULL so purging an old ops-pod identity
-- preserves their audit trail (the append-only trigger still prevents any
-- UPDATE on audit_log, so this ON DELETE clause is effectively a safety net
-- for the schema boundary — it will never actually fire under our triggers).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_log_auth_user_id_fkey'
  ) THEN
    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth_user(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Index for "all reads by ops-pod operator X, most recent first" queries.
CREATE INDEX IF NOT EXISTS idx_audit_auth_user_time
  ON audit_log (auth_user_id, occurred_at DESC);

-- Grant ops-web app role SELECT/INSERT on the new column (grants on the
-- table are already in place via migration 0005; no additional action
-- needed here since column-level grants inherit from table grants in
-- Postgres).
