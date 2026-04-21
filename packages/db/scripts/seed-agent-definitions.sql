-- seed-agent-definitions.sql
-- Populate agent_definitions with the 8 agents defined in docs/AGENTS.md.
-- Platform-global (no tenant_id); same 8 rows every environment.
--
-- Idempotent via ON CONFLICT (code) DO NOTHING. Safe to re-run after schema
-- migrations; a no-op once all 8 rows exist.
--
-- Apply: psql "$DATABASE_URL_ADMIN" -f packages/db/scripts/seed-agent-definitions.sql
--
-- Matches Linear issue BLU-10.

INSERT INTO agent_definitions (code, persona_name, display_scope, priority) VALUES
  ('vendor_ops', 'Sofia', 'Vendor Ops',   'P0'),
  ('inventory',  'Marco', 'Inventory',    'P0'),
  ('finance',    'Dana',  'Finance',      'P0'),
  ('review',     'Iris',  'Review',       'P0'),
  ('scheduling', 'Leo',   'Scheduling',   'P1'),
  ('phone',      'Nova',  'Phone',        'P1'),
  ('marketing',  'Rio',   'Marketing',    'P2'),
  ('compliance', 'Atlas', 'Compliance',   'P2')
ON CONFLICT (code) DO NOTHING;

SELECT code, persona_name, display_scope, priority
FROM   agent_definitions
ORDER  BY priority, code;
