-- SECURITY ROLLBACK ONLY — reopens direct execution to public client roles.
-- Do not apply unless the server-side application is broken after 003_lockdown_rpc_grants.sql,
-- the incident owner explicitly authorizes rollback, and the exposure window is accepted.
--
-- This restores the pre-lockdown grant posture and removes the fixed search_path settings.
-- It does not change table data.

BEGIN;

ALTER FUNCTION public.bw_fund_account(uuid, uuid, integer, text, text, text)
  RESET search_path;
GRANT EXECUTE ON FUNCTION public.bw_fund_account(uuid, uuid, integer, text, text, text)
  TO PUBLIC, anon, authenticated;

ALTER FUNCTION public.bw_place_hold(uuid, uuid, integer, text, text)
  RESET search_path;
GRANT EXECUTE ON FUNCTION public.bw_place_hold(uuid, uuid, integer, text, text)
  TO PUBLIC, anon, authenticated;

ALTER FUNCTION public.bw_release_hold(uuid, uuid, integer, text)
  RESET search_path;
GRANT EXECUTE ON FUNCTION public.bw_release_hold(uuid, uuid, integer, text)
  TO PUBLIC, anon, authenticated;

ALTER FUNCTION public.bw_complete_spend(uuid, uuid, integer, jsonb, text)
  RESET search_path;
GRANT EXECUTE ON FUNCTION public.bw_complete_spend(uuid, uuid, integer, jsonb, text)
  TO PUBLIC, anon, authenticated;

ALTER FUNCTION public.bw_get_agent_balance(uuid)
  RESET search_path;
GRANT EXECUTE ON FUNCTION public.bw_get_agent_balance(uuid)
  TO PUBLIC, anon, authenticated;

ALTER FUNCTION public.bw_register_agent(text, text, text, text, text, text)
  RESET search_path;
GRANT EXECUTE ON FUNCTION public.bw_register_agent(text, text, text, text, text, text)
  TO PUBLIC, anon, authenticated;

ALTER FUNCTION public.bw_get_daily_spend(uuid)
  RESET search_path;
GRANT EXECUTE ON FUNCTION public.bw_get_daily_spend(uuid)
  TO PUBLIC, anon, authenticated;

ALTER FUNCTION public.bw_get_monthly_spend(uuid)
  RESET search_path;
GRANT EXECUTE ON FUNCTION public.bw_get_monthly_spend(uuid)
  TO PUBLIC, anon, authenticated;

ALTER FUNCTION public.bw_verify_transaction(uuid)
  RESET search_path;
GRANT EXECUTE ON FUNCTION public.bw_verify_transaction(uuid)
  TO PUBLIC, anon, authenticated;

COMMIT;
