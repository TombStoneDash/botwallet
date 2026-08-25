#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

PSQL=(psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1)

"${PSQL[@]}" <<'SQL'
DO $$
BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END
$$;

DO $$
BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END
$$;

DO $$
BEGIN
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END
$$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
SQL

"${PSQL[@]}" -f sql/001_schema.sql
"${PSQL[@]}" -f sql/002_rpc_functions.sql
"${PSQL[@]}" -f sql/003_lockdown_rpc_grants.sql
"${PSQL[@]}" -f sql/003_verify_rpc_lockdown.sql

# ─── Prove a wrong same-named index fails closed ─────────────────────────
"${PSQL[@]}" -c "CREATE TABLE idx_bw_accounts_user_funding_unique (id integer);"
if "${PSQL[@]}" -f sql/004_fix_user_funding_account_uniqueness.sql >/tmp/004-relation-guard-output.txt 2>&1; then
  echo "ERROR: 004 migration reused a same-named non-index relation" >&2
  exit 1
fi
if ! grep -q 'same-named relation is not an index' /tmp/004-relation-guard-output.txt; then
  echo "ERROR: 004 migration rejected relation-name drift for an unexpected reason" >&2
  cat /tmp/004-relation-guard-output.txt >&2
  exit 1
fi
"${PSQL[@]}" -c "DROP TABLE idx_bw_accounts_user_funding_unique;"
echo "PASS: 004 migration fails closed on a same-named non-index relation"

"${PSQL[@]}" -c "CREATE INDEX idx_bw_accounts_user_funding_unique ON bw_accounts (created_at);"
if "${PSQL[@]}" -f sql/004_fix_user_funding_account_uniqueness.sql >/tmp/004-index-guard-output.txt 2>&1; then
  echo "ERROR: 004 migration reused a wrong same-named index" >&2
  exit 1
fi
if ! grep -q 'same-named index has unexpected definition' /tmp/004-index-guard-output.txt; then
  echo "ERROR: 004 migration rejected index drift for an unexpected reason" >&2
  cat /tmp/004-index-guard-output.txt >&2
  exit 1
fi
"${PSQL[@]}" -c "DROP INDEX idx_bw_accounts_user_funding_unique;"
echo "PASS: 004 migration fails closed on a wrong same-named index"

# ─── Prove 004 fails closed on pre-existing unexplained multiplicity ───────
# Seed a synthetic duplicate: one owner with two user_funding accounts, as if
# an earlier bug (the one this migration fixes) had already produced it.
"${PSQL[@]}" <<'SQL'
INSERT INTO bw_users (id, email, name)
VALUES ('00000000-0000-0000-0000-0000000000d1'::uuid, 'dupe-guard-probe@example.invalid', 'Dupe Guard Probe');

INSERT INTO bw_accounts (user_id, type, name) VALUES
  ('00000000-0000-0000-0000-0000000000d1'::uuid, 'user_funding', 'Dupe Guard Probe Funding 1'),
  ('00000000-0000-0000-0000-0000000000d1'::uuid, 'user_funding', 'Dupe Guard Probe Funding 2');
SQL

if "${PSQL[@]}" -f sql/004_fix_user_funding_account_uniqueness.sql >/tmp/004-guard-output.txt 2>&1; then
  echo "ERROR: 004 migration unexpectedly succeeded despite pre-existing user_funding multiplicity" >&2
  cat /tmp/004-guard-output.txt >&2
  exit 1
fi

if ! grep -q 'unexplained pre-existing multiplicity' /tmp/004-guard-output.txt; then
  echo "ERROR: 004 migration failed for an unexpected reason" >&2
  cat /tmp/004-guard-output.txt >&2
  exit 1
fi
echo "PASS: 004 migration fails closed when an owner already has more than one user_funding account"

# Remove only the synthetic probe rows created above, in this disposable
# database, so the real migration can be proven on a clean state. This is not
# a live/production duplicate-row cleanup — see scope boundary in the SQL
# migration's header comment.
"${PSQL[@]}" <<'SQL'
DELETE FROM bw_accounts WHERE user_id = '00000000-0000-0000-0000-0000000000d1'::uuid;
DELETE FROM bw_users WHERE id = '00000000-0000-0000-0000-0000000000d1'::uuid;
SQL

# ─── Apply the real migration and verify it ────────────────────────────────
"${PSQL[@]}" -f sql/004_fix_user_funding_account_uniqueness.sql
"${PSQL[@]}" -f sql/004_verify_user_funding_account_uniqueness.sql
echo "PASS: 004 migration applies cleanly and verification finds no remaining multiplicity"

# ─── Prove two same-owner registrations reuse one canonical account ───────
first_output="$("${PSQL[@]}" -Atqc "SET ROLE service_role; SELECT public.bw_register_agent('same-owner-probe@example.invalid', 'Same Owner Probe', 'Agent One', NULL, 'same-owner-hash-1', 'bw_so1...');")"
second_output="$("${PSQL[@]}" -Atqc "SET ROLE service_role; SELECT public.bw_register_agent('same-owner-probe@example.invalid', 'Same Owner Probe', 'Agent Two', NULL, 'same-owner-hash-2', 'bw_so2...');")"

if [[ "${first_output}" != *"agent_id"* ]] || [[ "${second_output}" != *"agent_id"* ]]; then
  echo "ERROR: same-owner registration proof did not return the expected payload" >&2
  echo "first: ${first_output}" >&2
  echo "second: ${second_output}" >&2
  exit 1
fi

owner_id="$("${PSQL[@]}" -Atqc "SELECT id FROM bw_users WHERE email = 'same-owner-probe@example.invalid';")"
account_count="$("${PSQL[@]}" -Atqc "SELECT COUNT(*) FROM bw_accounts WHERE user_id = '${owner_id}'::uuid AND type = 'user_funding';")"

if [[ "${account_count}" != "1" ]]; then
  echo "ERROR: expected exactly 1 user_funding account for the same owner after two registrations, found ${account_count}" >&2
  exit 1
fi

first_agent_id="$("${PSQL[@]}" -Atqc "SELECT id FROM bw_agents WHERE api_key_hash = 'same-owner-hash-1';")"
second_agent_id="$("${PSQL[@]}" -Atqc "SELECT id FROM bw_agents WHERE api_key_hash = 'same-owner-hash-2';")"

if [[ -z "${first_agent_id}" || -z "${second_agent_id}" || "${first_agent_id}" == "${second_agent_id}" ]]; then
  echo "ERROR: expected two distinct agents to be registered for the same owner" >&2
  exit 1
fi

echo "PASS: two same-owner registrations create exactly one canonical user_funding account and two distinct agents"

# The rollback is intentionally incident-gated because it restores duplicate
# creation. Execute it here only in the disposable database and verify that it
# preserves the 003 SECURITY DEFINER grants and hardened search_path.
"${PSQL[@]}" -f sql/004_fix_user_funding_account_uniqueness.rollback.sql
"${PSQL[@]}" -f sql/003_verify_rpc_lockdown.sql
echo "PASS: 004 rollback executes and preserves RPC lockdown in disposable PostgreSQL"
echo "PASS: user-funding-account uniqueness proof complete"
