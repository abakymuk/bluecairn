-- 0003_audit_triggers.sql
-- Enforces immutability on the audit_log table at the database level.
-- Neither UPDATE nor DELETE is allowed once a row is inserted.
--
-- See ARCHITECTURE.md principle #9 and DATA-MODEL.md § Audit log mechanics.
--
-- Apply via: psql $DATABASE_URL_ADMIN -f migrations-manual/0003_audit_triggers.sql

CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: UPDATE and DELETE are not permitted';
END;
$$;

COMMENT ON FUNCTION prevent_audit_mutation() IS
  'Blocks any UPDATE or DELETE against audit_log. Immutability at the DB layer. GDPR redaction uses a separate purpose-built procedure, not bypass of this trigger.';

-- UPDATE block
DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- DELETE block
DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- -----------------------------------------------------------------------------
-- TRUNCATE is a separate operation not covered by BEFORE DELETE triggers.
-- Revoke TRUNCATE privilege from the app role explicitly.
-- -----------------------------------------------------------------------------
REVOKE TRUNCATE ON audit_log FROM PUBLIC;
-- If you have a specific role: REVOKE TRUNCATE ON audit_log FROM bluecairn_app;
