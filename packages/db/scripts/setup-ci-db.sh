#!/usr/bin/env bash
# setup-ci-db.sh — full idempotent bootstrap of a Postgres DB to match
# BlueCairn's dev schema state.
#
# Intended for:
#   - CI (GitHub Actions postgres service container)
#   - Local Docker Postgres (developer clean-room testing)
#
# Produces:
#   - `bluecairn_admin` role owns all application tables
#   - `bluecairn_app` role: SELECT/INSERT/UPDATE/DELETE granted, NOBYPASSRLS
#   - All migrations applied: extensions, Drizzle schema, RLS policies,
#     audit-log immutability triggers
#   - `agent_definitions` seeded with the 8 agents
#
# Required env:
#   POSTGRES_URL              — superuser/owner URL (e.g. postgresql://postgres:postgres@localhost:5432/bluecairn)
#   ADMIN_URL                 — bluecairn_admin URL, same host/db, bluecairn_admin credentials
#   BLUECAIRN_APP_PASSWORD    — plaintext password for bluecairn_app (substituted into provision-roles.sql)
#   BLUECAIRN_ADMIN_PASSWORD  — plaintext password for bluecairn_admin (substituted into provision-roles.sql)
#
# Matches Linear issue BLU-15.

set -euo pipefail

: "${POSTGRES_URL:?POSTGRES_URL (superuser) must be set}"
: "${ADMIN_URL:?ADMIN_URL (bluecairn_admin) must be set}"
: "${BLUECAIRN_APP_PASSWORD:?BLUECAIRN_APP_PASSWORD must be set}"
: "${BLUECAIRN_ADMIN_PASSWORD:?BLUECAIRN_ADMIN_PASSWORD must be set}"

# Absolute path to the repo root, regardless of where this script is invoked from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "→ Bootstrapping BlueCairn DB"
echo "  repo:  $REPO_ROOT"

# -----------------------------------------------------------------------------
# 1. Roles (as superuser)
# -----------------------------------------------------------------------------
echo "  1/6 creating roles"
sed -e "s|REPLACE_APP_PASSWORD|$BLUECAIRN_APP_PASSWORD|g" \
    -e "s|REPLACE_ADMIN_PASSWORD|$BLUECAIRN_ADMIN_PASSWORD|g" \
    "$REPO_ROOT/packages/db/scripts/provision-roles.sql" \
  | psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 -q

# -----------------------------------------------------------------------------
# 2. Extensions + current_tenant_id() function (as superuser)
# -----------------------------------------------------------------------------
echo "  2/6 enabling extensions"
psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 -q \
  -f "$REPO_ROOT/packages/db/migrations-manual/0001_enable_extensions.sql"

# -----------------------------------------------------------------------------
# 3. Drizzle schema (as admin)
# -----------------------------------------------------------------------------
echo "  3/6 applying Drizzle migration"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
  -f "$REPO_ROOT/packages/db/migrations/0000_overconfident_trish_tilby.sql"

# -----------------------------------------------------------------------------
# 4. App-role DML grants + default privileges (as admin)
# -----------------------------------------------------------------------------
echo "  4/6 granting app privileges"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
  -f "$REPO_ROOT/packages/db/scripts/grant-app-privileges.sql"

# -----------------------------------------------------------------------------
# 5. RLS policies + audit-log immutability triggers (as admin)
# -----------------------------------------------------------------------------
echo "  5/6 applying RLS + audit triggers + schema deltas"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
  -f "$REPO_ROOT/packages/db/migrations-manual/0002_rls_policies.sql"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
  -f "$REPO_ROOT/packages/db/migrations-manual/0003_audit_triggers.sql"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
  -f "$REPO_ROOT/packages/db/migrations-manual/0004_messages_tool_call_link.sql"

# -----------------------------------------------------------------------------
# 6. Platform seed (as admin)
# -----------------------------------------------------------------------------
echo "  6/6 seeding agent_definitions + concierge prompts (v1 placeholder + v2)"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
  -f "$REPO_ROOT/packages/db/scripts/seed-agent-definitions.sql" > /dev/null
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
  -f "$REPO_ROOT/packages/db/scripts/seed-concierge-prompt.sql" > /dev/null
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
  -f "$REPO_ROOT/packages/db/scripts/seed-concierge-prompt-v2.sql" > /dev/null

echo "✓ Done."
