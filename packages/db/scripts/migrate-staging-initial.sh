#!/usr/bin/env bash
# migrate-staging-initial.sh — one-time initial migration of the staging
# Neon branch. Applies the same chain that was run on dev (BLU-9 / BLU-12):
#   extensions → Drizzle schema → app grants → RLS → audit triggers → agent seed.
#
# Roles (bluecairn_app + bluecairn_admin) are assumed already provisioned
# on the staging branch via `provision-roles.sql` during BLU-3. This script
# skips role creation and expects them to exist.
#
# Preconditions — do these as `neondb_owner` in the Neon Console SQL Editor
# on the staging branch BEFORE running this script (same one-liners we ran
# for dev during BLU-9):
#
#     GRANT CREATE ON SCHEMA public TO bluecairn_admin;
#
# Then populate Doppler `stg` config with DATABASE_URL + DATABASE_URL_ADMIN
# from 1Password (BLU-3 stashed them as DATABASE_URL_STAGING and
# DATABASE_URL_ADMIN_STAGING).
#
# Run:
#     cd /Users/abakymuk/BlueCairn/bluecairn
#     doppler run --project bluecairn --config stg -- bash packages/db/scripts/migrate-staging-initial.sh
#
# Idempotency: re-running will fail on duplicate CREATE (policies exist,
# extension already on). That's fine — this is a one-shot. Ongoing schema
# changes flow through the regular "update file, apply to each branch in
# order: dev → stg → main" manual process.

set -euo pipefail

: "${DATABASE_URL_ADMIN:?DATABASE_URL_ADMIN must be set (from Doppler stg config)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "→ Migrating staging Neon branch"
echo "  admin URL: ${DATABASE_URL_ADMIN:0:30}…"

echo "  1/6 enabling extensions (as admin)"
psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 \
  -f "$REPO_ROOT/packages/db/migrations-manual/0001_enable_extensions.sql"

echo "  2/6 applying Drizzle migration"
psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 \
  -f "$REPO_ROOT/packages/db/migrations/0000_overconfident_trish_tilby.sql"

echo "  3/6 granting app DML privileges"
psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 \
  -f "$REPO_ROOT/packages/db/scripts/grant-app-privileges.sql"

echo "  4/6 enabling RLS policies"
psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 \
  -f "$REPO_ROOT/packages/db/migrations-manual/0002_rls_policies.sql"

echo "  5/6 installing audit-log immutability triggers"
psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 \
  -f "$REPO_ROOT/packages/db/migrations-manual/0003_audit_triggers.sql"

echo "  6/6 seeding agent_definitions"
psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 \
  -f "$REPO_ROOT/packages/db/scripts/seed-agent-definitions.sql" > /dev/null

echo "✓ Staging migration complete."
echo ""
echo "Next steps:"
echo "  1. Populate remaining Doppler stg secrets (TELEGRAM_BOT_TOKEN,"
echo "     TELEGRAM_WEBHOOK_SECRET, LANGFUSE_*) — reuse dev values for M0."
echo "  2. Create Railway project + service (see packages/db/scripts/README.md"
echo "     § BLU-17 deploy)."
echo "  3. setWebhook against the Railway URL once deployed."
