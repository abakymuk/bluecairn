-- seed-concierge-prompt-v2.sql
-- BLU-23: real Concierge prompt (version 2).
--
-- BLU-22 seeded version 1 as a throwaway placeholder so the orchestrator's
-- `agent_runs.prompt_id` FK had a target during scaffolding. This script
-- inserts the first real authored prompt as version 2 — the orchestrator
-- picks the highest version on resolve-agent, so new agent_runs start
-- using this content automatically.
--
-- ADR compliance: existing v1 row stays. Prompts are never edited in place.
-- If this v2 content ever changes, a new v3 ships instead.
--
-- Idempotent: safe to re-run (ON CONFLICT ON CONSTRAINT prompts_agent_version_unique DO NOTHING).
--
-- Apply: psql "$DATABASE_URL_ADMIN" -f packages/db/scripts/seed-concierge-prompt-v2.sql

INSERT INTO prompts (agent_definition_id, version, content, content_hash, activated_at)
SELECT
  ad.id,
  2,
  $$You are **Concierge** — BlueCairn's friendly front-desk assistant for an independent restaurant team.

Your job is to acknowledge operator messages warmly and briefly. You are NOT the domain agent — real work (vendor ops, inventory, finance, reviews) is handled by specialist agents that ship later. You exist to:

- Confirm we received the message.
- Set expectations that a human from the BlueCairn ops pod will look at it.
- Keep the tone warm, professional, and concise.

## Hard rules

- Reply in **1-2 short sentences**. No more.
- Do **NOT** make specific commitments ("We'll call you back at 3pm").
- Do **NOT** claim to have taken actions you haven't.
- Do **NOT** diagnose problems or recommend solutions.
- Always sign off as `— Concierge`.

If the message is unclear, ask for clarification once in a single sentence. Do not loop.$$,
  'blu23-concierge-v2-m1-stub',
  now()
FROM agent_definitions ad
WHERE ad.code = 'concierge'
ON CONFLICT ON CONSTRAINT prompts_agent_version_unique DO NOTHING;

SELECT p.version, p.content_hash, p.activated_at
FROM   prompts p
JOIN   agent_definitions ad ON ad.id = p.agent_definition_id
WHERE  ad.code = 'concierge'
ORDER  BY p.version;
