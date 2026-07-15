#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

PSQL=(psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 -q)
TABLES=(
  bazaar_disputes
  bazaar_receipts
  bot_captcha_challenges
  bot_captcha_human_attempts
  bot_captcha_leaderboard
  bot_captcha_tokens
)

"${PSQL[@]}" <<'SQL'
DO $$
BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

DROP TABLE IF EXISTS public.bazaar_disputes CASCADE;
DROP TABLE IF EXISTS public.bazaar_receipts CASCADE;
DROP TABLE IF EXISTS public.bot_captcha_challenges CASCADE;
DROP TABLE IF EXISTS public.bot_captcha_human_attempts CASCADE;
DROP TABLE IF EXISTS public.bot_captcha_leaderboard CASCADE;
DROP TABLE IF EXISTS public.bot_captcha_tokens CASCADE;

CREATE TABLE public.bazaar_disputes (id bigint PRIMARY KEY, marker text);
CREATE TABLE public.bazaar_receipts (id bigint PRIMARY KEY, marker text);
CREATE TABLE public.bot_captcha_challenges (id bigint PRIMARY KEY, marker text);
CREATE TABLE public.bot_captcha_human_attempts (id bigint PRIMARY KEY, marker text);
CREATE TABLE public.bot_captcha_leaderboard (id bigint PRIMARY KEY, marker text);
CREATE TABLE public.bot_captcha_tokens (id bigint PRIMARY KEY, marker text);

ALTER TABLE public.bazaar_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bazaar_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_captcha_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_captcha_human_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_captcha_leaderboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_captcha_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_disputes ON public.bazaar_disputes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_receipts ON public.bazaar_receipts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.bot_captcha_challenges
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.bot_captcha_human_attempts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.bot_captcha_leaderboard
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.bot_captcha_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT ALL PRIVILEGES ON TABLE
  public.bazaar_disputes,
  public.bazaar_receipts,
  public.bot_captcha_challenges,
  public.bot_captcha_human_attempts,
  public.bot_captcha_leaderboard,
  public.bot_captcha_tokens
TO anon, authenticated, service_role;
SQL

policy_snapshot() {
  "${PSQL[@]}" -AtF '|' -c "
    SELECT tablename, policyname, cmd, roles::text, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'bazaar_disputes',
        'bazaar_receipts',
        'bot_captcha_challenges',
        'bot_captcha_human_attempts',
        'bot_captcha_leaderboard',
        'bot_captcha_tokens'
      )
    ORDER BY tablename, policyname;
  "
}

policy_before="$(policy_snapshot)"
"${PSQL[@]}" -f sql/005_revoke_service_table_client_grants.sql
"${PSQL[@]}" -f sql/005_verify_service_table_client_grants.sql >/dev/null
policy_after="$(policy_snapshot)"

if [[ "${policy_before}" != "${policy_after}" ]]; then
  echo "ERROR: migration changed policy command, role, or expression" >&2
  diff -u <(printf '%s\n' "${policy_before}") <(printf '%s\n' "${policy_after}") >&2 || true
  exit 1
fi

assert_client_denied() {
  local role="$1"
  local table
  local output

  for table in "${TABLES[@]}"; do
    output="$(mktemp)"
    if "${PSQL[@]}" -c "SET ROLE ${role}; SELECT count(*) FROM public.${table};" >"${output}" 2>&1; then
      echo "ERROR: ${role} unexpectedly retained SELECT on ${table}" >&2
      rm -f "${output}"
      exit 1
    fi

    if ! grep -Eq "permission denied for table ${table}|permission denied for schema public" "${output}"; then
      echo "ERROR: ${role} was denied ${table} for an unexpected reason" >&2
      cat "${output}" >&2
      rm -f "${output}"
      exit 1
    fi
    rm -f "${output}"
  done
}

assert_client_denied anon
assert_client_denied authenticated

for table in "${TABLES[@]}"; do
  "${PSQL[@]}" -c "
    BEGIN;
    SET ROLE service_role;
    INSERT INTO public.${table} (id, marker) VALUES (1, 'disposable-service-proof');
    UPDATE public.${table} SET marker = 'updated-service-proof' WHERE id = 1;
    SELECT count(*) FROM public.${table} WHERE id = 1;
    DELETE FROM public.${table} WHERE id = 1;
    ROLLBACK;
  " >/dev/null
done

"${PSQL[@]}" -f sql/005_revoke_service_table_client_grants.rollback.sql

restored_count="$("${PSQL[@]}" -Atqc "
  SELECT count(*)
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN (
      'bazaar_disputes',
      'bazaar_receipts',
      'bot_captcha_challenges',
      'bot_captcha_human_attempts',
      'bot_captcha_leaderboard',
      'bot_captcha_tokens'
    )
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN (
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    );
")"

if [[ "${restored_count}" != "84" ]]; then
  echo "ERROR: rollback restored ${restored_count}/84 expected client grants" >&2
  exit 1
fi

policy_after_rollback="$(policy_snapshot)"
if [[ "${policy_before}" != "${policy_after_rollback}" ]]; then
  echo "ERROR: rollback changed the service_role policy contract" >&2
  exit 1
fi

# Finish the disposable database in the secure posture and prove idempotent
# reapplication against the same policy/table shape.
"${PSQL[@]}" -f sql/005_revoke_service_table_client_grants.sql
"${PSQL[@]}" -f sql/005_verify_service_table_client_grants.sql >/dev/null

client_grants_remaining="$("${PSQL[@]}" -Atqc "
  SELECT count(*)
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN (
      'bazaar_disputes',
      'bazaar_receipts',
      'bot_captcha_challenges',
      'bot_captcha_human_attempts',
      'bot_captcha_leaderboard',
      'bot_captcha_tokens'
    )
    AND grantee IN ('anon', 'authenticated');
")"

if [[ "${client_grants_remaining}" != "0" ]]; then
  echo "ERROR: ${client_grants_remaining} client grants remain after reapplication" >&2
  exit 1
fi

echo "PASS: six policy definitions remained byte-for-byte equivalent"
echo "PASS: anon and authenticated lost direct access to all six tables"
echo "PASS: service_role retained disposable read/write behavior"
echo "PASS: rollback restored only prior client grants and preserved policy scope"
echo "PASS: service-only table grant acceptance complete"
