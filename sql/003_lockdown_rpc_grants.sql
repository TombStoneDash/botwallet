-- BotWall3t SECURITY P0 — restrict financial SECURITY DEFINER RPCs.
-- Prepared for GitHub issue #1. This file is migration-only and is NOT applied automatically.
--
-- Runtime caller inventory:
--   apps/web -> @botwallet/db getClient() -> SUPABASE_SERVICE_ROLE_KEY
--   packages/ledger and packages/policy call these RPCs with that server-only client.
--
-- Effect:
--   * fixes each function search_path;
--   * preserves Supabase's extensions schema because bw_register_agent calls
--     extensions.gen_random_bytes through its existing unqualified source;
--   * removes direct client execution from PUBLIC, anon, and authenticated;
--   * keeps the server-side service_role caller working.
--
-- No table data is changed by this migration.

BEGIN;

ALTER FUNCTION public.bw_fund_account(uuid, uuid, integer, text, text, text)
  SET search_path = pg_catalog, public, extensions, pg_temp;
REVOKE EXECUTE ON FUNCTION public.bw_fund_account(uuid, uuid, integer, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_fund_account(uuid, uuid, integer, text, text, text)
  TO service_role;

ALTER FUNCTION public.bw_place_hold(uuid, uuid, integer, text, text)
  SET search_path = pg_catalog, public, extensions, pg_temp;
REVOKE EXECUTE ON FUNCTION public.bw_place_hold(uuid, uuid, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_place_hold(uuid, uuid, integer, text, text)
  TO service_role;

ALTER FUNCTION public.bw_release_hold(uuid, uuid, integer, text)
  SET search_path = pg_catalog, public, extensions, pg_temp;
REVOKE EXECUTE ON FUNCTION public.bw_release_hold(uuid, uuid, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_release_hold(uuid, uuid, integer, text)
  TO service_role;

ALTER FUNCTION public.bw_complete_spend(uuid, uuid, integer, jsonb, text)
  SET search_path = pg_catalog, public, extensions, pg_temp;
REVOKE EXECUTE ON FUNCTION public.bw_complete_spend(uuid, uuid, integer, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_complete_spend(uuid, uuid, integer, jsonb, text)
  TO service_role;

ALTER FUNCTION public.bw_get_agent_balance(uuid)
  SET search_path = pg_catalog, public, extensions, pg_temp;
REVOKE EXECUTE ON FUNCTION public.bw_get_agent_balance(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_get_agent_balance(uuid)
  TO service_role;

ALTER FUNCTION public.bw_register_agent(text, text, text, text, text, text)
  SET search_path = pg_catalog, public, extensions, pg_temp;
REVOKE EXECUTE ON FUNCTION public.bw_register_agent(text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_register_agent(text, text, text, text, text, text)
  TO service_role;

ALTER FUNCTION public.bw_get_daily_spend(uuid)
  SET search_path = pg_catalog, public, extensions, pg_temp;
REVOKE EXECUTE ON FUNCTION public.bw_get_daily_spend(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_get_daily_spend(uuid)
  TO service_role;

ALTER FUNCTION public.bw_get_monthly_spend(uuid)
  SET search_path = pg_catalog, public, extensions, pg_temp;
REVOKE EXECUTE ON FUNCTION public.bw_get_monthly_spend(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_get_monthly_spend(uuid)
  TO service_role;

ALTER FUNCTION public.bw_verify_transaction(uuid)
  SET search_path = pg_catalog, public, extensions, pg_temp;
REVOKE EXECUTE ON FUNCTION public.bw_verify_transaction(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_verify_transaction(uuid)
  TO service_role;

COMMIT;
