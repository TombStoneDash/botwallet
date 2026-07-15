-- Read-only catalog verification for 005_revoke_service_table_client_grants.sql.
-- This file does not query application rows or invoke application functions.

DO $verify$
DECLARE
  target record;
  client_role text;
  privilege_name text;
  qualified_name text;
BEGIN
  FOR target IN
    SELECT *
    FROM (VALUES
      ('public', 'bazaar_disputes', 'service_role_disputes'),
      ('public', 'bazaar_receipts', 'service_role_receipts'),
      ('public', 'bot_captcha_challenges', 'Service role full access'),
      ('public', 'bot_captcha_human_attempts', 'Service role full access'),
      ('public', 'bot_captcha_leaderboard', 'Service role full access'),
      ('public', 'bot_captcha_tokens', 'Service role full access')
    ) AS targets(schema_name, table_name, policy_name)
  LOOP
    qualified_name := format('%I.%I', target.schema_name, target.table_name);

    IF to_regclass(qualified_name) IS NULL THEN
      RAISE EXCEPTION 'missing table %', qualified_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      WHERE c.oid = to_regclass(qualified_name)
        AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on %', qualified_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = target.schema_name
        AND p.tablename = target.table_name
        AND p.policyname = target.policy_name
        AND p.cmd = 'ALL'
        AND p.permissive = 'PERMISSIVE'
        AND p.roles = ARRAY['service_role']::name[]
        AND p.qual = 'true'
        AND p.with_check = 'true'
    ) THEN
      RAISE EXCEPTION 'service_role-only policy % on % is missing or changed',
        target.policy_name, qualified_name;
    END IF;

    FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      FOREACH privilege_name IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ]
      LOOP
        IF has_table_privilege(client_role, qualified_name, privilege_name) THEN
          RAISE EXCEPTION '% still has % on %', client_role, privilege_name, qualified_name;
        END IF;
      END LOOP;
    END LOOP;

    FOREACH privilege_name IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    LOOP
      IF NOT has_table_privilege('service_role', qualified_name, privilege_name) THEN
        RAISE EXCEPTION 'service_role is missing % on %', privilege_name, qualified_name;
      END IF;
    END LOOP;
  END LOOP;
END
$verify$;

SELECT
  p.schemaname,
  p.tablename,
  p.policyname,
  p.cmd,
  p.roles,
  p.qual,
  p.with_check,
  has_table_privilege('anon', format('%I.%I', p.schemaname, p.tablename), 'SELECT') AS anon_select,
  has_table_privilege('authenticated', format('%I.%I', p.schemaname, p.tablename), 'SELECT') AS authenticated_select,
  has_table_privilege('service_role', format('%I.%I', p.schemaname, p.tablename), 'SELECT') AS service_role_select
FROM pg_policies p
WHERE (p.schemaname, p.tablename, p.policyname) IN (
  ('public', 'bazaar_disputes', 'service_role_disputes'),
  ('public', 'bazaar_receipts', 'service_role_receipts'),
  ('public', 'bot_captcha_challenges', 'Service role full access'),
  ('public', 'bot_captcha_human_attempts', 'Service role full access'),
  ('public', 'bot_captcha_leaderboard', 'Service role full access'),
  ('public', 'bot_captcha_tokens', 'Service role full access')
)
ORDER BY p.tablename;
