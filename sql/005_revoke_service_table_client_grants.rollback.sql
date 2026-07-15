-- SECURITY ROLLBACK ONLY — restores the direct anon/authenticated table grants
-- that existed immediately before 005_revoke_service_table_client_grants.sql.
--
-- The service_role-only RLS policies are deliberately left unchanged. This
-- rollback therefore restores the prior table-grant posture without reopening
-- a PUBLIC RLS policy. Apply only if a confirmed application dependency needs
-- direct client table privileges and the incident owner authorizes rollback.
-- No table data is changed.

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.bazaar_disputes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.bazaar_receipts TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.bot_captcha_challenges TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.bot_captcha_human_attempts TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.bot_captcha_leaderboard TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.bot_captcha_tokens TO anon, authenticated;

COMMIT;
