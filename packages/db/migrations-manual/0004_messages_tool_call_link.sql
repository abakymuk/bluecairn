-- 0004_messages_tool_call_link.sql
-- BLU-32: explicit outbound linkage + direction ENUM on messages.
--
-- Before: messages inferred inbound vs outbound from author_kind
--   ('user' → inbound, 'agent'/'system' → outbound). Implicit, entangled
--   with author semantics.
-- After: explicit `direction` column + `tool_call_id` FK so ops-web (BLU-27)
--   can render "this outbound message was produced by tool_calls[X]"
--   directly, without the agent_runs → tool_calls → messages join dance.
--
-- Idempotent: safe to re-run (IF NOT EXISTS + IF EXISTS guards).

-- -----------------------------------------------------------------------------
-- 1. tool_call_id FK — nullable; SET NULL on parent delete so audit trail of
-- the message survives even if the tool_call is purged.
-- -----------------------------------------------------------------------------
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS tool_call_id UUID
  REFERENCES tool_calls(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 2. direction column. Add nullable, backfill from author_kind, then enforce
-- NOT NULL + CHECK. Drizzle cannot generate CHECK constraints, so we keep it
-- at the SQL layer.
-- -----------------------------------------------------------------------------
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS direction TEXT;

UPDATE messages
SET direction = CASE
  WHEN author_kind = 'user'              THEN 'inbound'
  WHEN author_kind IN ('agent', 'system') THEN 'outbound'
  ELSE 'inbound' -- defensive default for unknown author_kind values
END
WHERE direction IS NULL;

ALTER TABLE messages
  ALTER COLUMN direction SET NOT NULL;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_direction_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_direction_check
  CHECK (direction IN ('inbound', 'outbound'));

-- -----------------------------------------------------------------------------
-- 3. Partial index for ops-web's tool_call → outbound message join pattern.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_messages_tool_call
  ON messages (tenant_id, tool_call_id)
  WHERE tool_call_id IS NOT NULL;
