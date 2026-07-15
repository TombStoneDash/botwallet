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

assert_client_denied() {
  local role="$1"
  local output
  output="$(mktemp)"

  if "${PSQL[@]}" -c "SET ROLE ${role}; SELECT public.bw_get_agent_balance('00000000-0000-0000-0000-000000000001'::uuid);" >"${output}" 2>&1; then
    echo "ERROR: ${role} unexpectedly executed bw_get_agent_balance" >&2
    cat "${output}" >&2
    rm -f "${output}"
    exit 1
  fi

  if ! grep -Eq 'permission denied for function bw_get_agent_balance|permission denied for schema public' "${output}"; then
    echo "ERROR: ${role} was denied for an unexpected reason" >&2
    cat "${output}" >&2
    rm -f "${output}"
    exit 1
  fi

  rm -f "${output}"
  echo "PASS: ${role} cannot execute financial RPCs"
}

assert_client_denied anon
assert_client_denied authenticated

registration_output="$("${PSQL[@]}" -Atqc "SET ROLE service_role; SELECT public.bw_register_agent('security-ci@example.invalid', 'Security CI', 'Security CI Agent', 'isolated grant probe', 'ci-security-hash', 'bw_ci...');")"
if [[ "${registration_output}" != *"agent_id"* ]] || [[ "${registration_output}" != *"accounts"* ]]; then
  echo "ERROR: service_role registration proof returned an unexpected payload" >&2
  exit 1
fi

agent_id="$("${PSQL[@]}" -Atqc "SELECT id FROM public.bw_agents WHERE api_key_hash = 'ci-security-hash';")"
if [[ -z "${agent_id}" ]]; then
  echo "ERROR: isolated registration did not create the expected agent" >&2
  exit 1
fi

service_output="$("${PSQL[@]}" -Atqc "SET ROLE service_role; SELECT public.bw_get_agent_balance('${agent_id}'::uuid);")"
if [[ "${service_output}" != *"available_cents"* ]] || [[ "${service_output}" != *"currency"* ]]; then
  echo "ERROR: service_role balance proof returned an unexpected payload" >&2
  exit 1
fi

echo "PASS: service_role registration resolves extensions.gen_random_bytes"
echo "PASS: service_role can execute the read-only balance RPC"
echo "PASS: isolated PostgreSQL grant-lockdown acceptance complete"
