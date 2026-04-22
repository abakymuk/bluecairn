-- seed-concierge-prompt.sql
-- BLU-22: placeholder Concierge prompt (version 1) so the orchestrator's
-- `agent_runs.prompt_id` foreign key has a target. BLU-23 replaces the
-- placeholder with the real Concierge prompt as version 2; version 1 stays
-- around for historical audit per ADR "prompts never edited in place".
--
-- Idempotent: safe to re-run (ON CONFLICT DO NOTHING on the
-- `prompts_agent_version_unique` constraint).
--
-- Apply: psql "$DATABASE_URL_ADMIN" -f packages/db/scripts/seed-concierge-prompt.sql

INSERT INTO prompts (agent_definition_id, version, content, content_hash, activated_at)
SELECT
  ad.id,
  1,
  '(BLU-22 placeholder — real Concierge prompt lands in BLU-23)',
  'blu22-concierge-v1-placeholder',
  now()
FROM agent_definitions ad
WHERE ad.code = 'concierge'
ON CONFLICT ON CONSTRAINT prompts_agent_version_unique DO NOTHING;
