-- BotWall3t security follow-through — remove direct client table grants from
-- six objects whose only RLS policy is explicitly scoped to service_role.
--
-- Production prerequisite:
--   migration scope_service_only_policies_20260715 has already changed each
--   named ALL policy to TO service_role.
--
-- This migration fails closed if a table or expected service_role policy is
-- missing or has drifted. It changes grants only: no row, policy expression,
-- RLS state, function, or schema shape is modified.

BEGIN;

DO $guard$
DECLARE
  target record;
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
    IF to_regclass(format('%I.%I', target.schema_name, target.table_name)) IS NULL THEN
      RAISE EXCEPTION 'required service-only table %.% is missing',
        target.schema_name, target.table_name;
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
      RAISE EXCEPTION 'expected service_role-only ALL policy % on %.% is missing or drifted',
        target.policy_name, target.schema_name, target.table_name;
    END IF;
  END LOOP;
END
$guard$;

REVOKE ALL PRIVILEGES ON TABLE public.bazaar_disputes
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.bazaar_receipts
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.bot_captcha_challenges
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.bot_captcha_human_attempts
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.bot_captcha_leaderboard
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.bot_captcha_tokens
  FROM PUBLIC, anon, authenticated;

-- Preserve an explicit server-side grant rather than depending on a previous
-- PUBLIC grant or owner privilege. The application uses a server-only
-- service-role client for these internal objects.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.bazaar_disputes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.bazaar_receipts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.bot_captcha_challenges TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.bot_captcha_human_attempts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.bot_captcha_leaderboard TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.bot_captcha_tokens TO service_role;

COMMIT;
