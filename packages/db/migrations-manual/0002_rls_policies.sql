-- 0002_rls_policies.sql
-- Run AFTER the Drizzle-generated initial migration (0000_init.sql).
--
-- Enables Row Level Security (RLS) on every tenant-scoped table and
-- installs the tenant isolation policy. Platform-global tables are NOT
-- covered here (users, agent_definitions, prompts).
--
-- See ADR-0006 and DATA-MODEL.md § Multi-tenancy enforcement.
--
-- Apply via: psql $DATABASE_URL_ADMIN -f migrations-manual/0002_rls_policies.sql

-- -----------------------------------------------------------------------------
-- Platform tables
-- -----------------------------------------------------------------------------
ALTER TABLE tenant_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_locations_isolation ON tenant_locations
  USING (tenant_id = current_tenant_id());

ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_users_isolation ON tenant_users
  USING (tenant_id = current_tenant_id());

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY channels_isolation ON channels
  USING (tenant_id = current_tenant_id());

ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY threads_isolation ON threads
  USING (tenant_id = current_tenant_id());

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_isolation ON messages
  USING (tenant_id = current_tenant_id());

-- -----------------------------------------------------------------------------
-- Agent platform tables
-- -----------------------------------------------------------------------------
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_runs_isolation ON agent_runs
  USING (tenant_id = current_tenant_id());

ALTER TABLE tool_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY tool_calls_isolation ON tool_calls
  USING (tenant_id = current_tenant_id());

ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY actions_isolation ON actions
  USING (tenant_id = current_tenant_id());

ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY approval_requests_isolation ON approval_requests
  USING (tenant_id = current_tenant_id());

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tasks_isolation ON tasks
  USING (tenant_id = current_tenant_id());

ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY policies_isolation ON policies
  USING (tenant_id = current_tenant_id());

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY integrations_isolation ON integrations
  USING (tenant_id = current_tenant_id());

-- -----------------------------------------------------------------------------
-- Cross-cutting
-- -----------------------------------------------------------------------------
ALTER TABLE memory_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY memory_entries_isolation ON memory_entries
  USING (tenant_id = current_tenant_id());

-- audit_log is special: its tenant_id is nullable (platform-global events
-- allowed), so the policy allows NULL tenant_id through for ops-pod reads.
-- Regular app connections will see only their tenant's entries plus platform
-- events.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_isolation ON audit_log
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL);

-- -----------------------------------------------------------------------------
-- The bluecairn_app role runs without bypassrls (configured at Neon role level).
-- The bluecairn_admin role used for migrations retains full access.
-- -----------------------------------------------------------------------------
