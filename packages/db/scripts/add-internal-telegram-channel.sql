-- add-internal-telegram-channel.sql
-- Add a secondary Telegram channel + thread for the `bluecairn-internal`
-- tenant. Use when you want a second Telegram user (e.g. Nick) to be able
-- to message `@bluecairn_internal_bot` and have their messages persisted.
--
-- Idempotent — re-running is a no-op.
--
-- Parameters (set via `psql -v`):
--   chat_id       — Telegram chat_id (= user_id for 1:1 bot chats)
--   display_name  — human label, shown in channels.display_name + threads.title
--
-- Usage:
--   doppler run --project bluecairn --config <env> -- sh -c \
--     'psql "$DATABASE_URL_ADMIN" \
--       -v chat_id="'\''167099195'\''" \
--       -v display_name="'\''Nick (personal)'\''" \
--       -f packages/db/scripts/add-internal-telegram-channel.sql'
--
-- Apply to both `dev` and `stg` (and `prd` when it exists) for consistency.

\set ON_ERROR_STOP on

-- 1. Channel row (non-primary — the primary telegram channel is reserved
--    for whoever ran the initial bootstrap)
INSERT INTO channels (tenant_id, kind, external_id, display_name, is_primary, active)
SELECT t.id, 'telegram', :chat_id, :display_name, false, true
FROM   tenants t
WHERE  t.slug = 'bluecairn-internal'
  AND  NOT EXISTS (
    SELECT 1 FROM channels
    WHERE  tenant_id = t.id AND kind = 'telegram' AND external_id = :chat_id
  );

-- 2. Thread on the new channel
INSERT INTO threads (tenant_id, channel_id, kind, title)
SELECT t.id, c.id, 'owner_primary', :display_name
FROM   tenants  t
JOIN   channels c ON c.tenant_id = t.id AND c.kind = 'telegram' AND c.external_id = :chat_id
WHERE  t.slug = 'bluecairn-internal'
  AND  NOT EXISTS (SELECT 1 FROM threads WHERE channel_id = c.id);

-- 3. Verification
SELECT c.external_id, c.display_name, c.is_primary, t.title AS thread_title
FROM   channels c
JOIN   threads  t ON t.channel_id = c.id
JOIN   tenants  tt ON tt.id = c.tenant_id
WHERE  tt.slug = 'bluecairn-internal'
ORDER  BY c.is_primary DESC, c.created_at;
