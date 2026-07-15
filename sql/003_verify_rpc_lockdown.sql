-- Read-only verification for 003_lockdown_rpc_grants.sql.
-- This script inspects catalog privileges/configuration only. It never invokes a financial RPC.

DO $$
DECLARE
  signature text;
  is_definer boolean;
  function_config text[];
  expected_signatures constant text[] := ARRAY[
    'public.bw_fund_account(uuid,uuid,integer,text,text,text)',
    'public.bw_place_hold(uuid,uuid,integer,text,text)',
    'public.bw_release_hold(uuid,uuid,integer,text)',
    'public.bw_complete_spend(uuid,uuid,integer,jsonb,text)',
    'public.bw_get_agent_balance(uuid)',
    'public.bw_register_agent(text,text,text,text,text,text)',
    'public.bw_get_daily_spend(uuid)',
    'public.bw_get_monthly_spend(uuid)',
    'public.bw_verify_transaction(uuid)'
  ];
BEGIN
  FOREACH signature IN ARRAY expected_signatures LOOP
    SELECT p.prosecdef, p.proconfig
      INTO is_definer, function_config
      FROM pg_proc AS p
     WHERE p.oid = signature::regprocedure;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Missing expected RPC: %', signature;
    END IF;

    IF NOT is_definer THEN
      RAISE EXCEPTION 'Expected SECURITY DEFINER function: %', signature;
    END IF;

    IF has_function_privilege('anon', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can still execute %', signature;
    END IF;

    IF has_function_privilege('authenticated', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated can still execute %', signature;
    END IF;

    IF NOT has_function_privilege('service_role', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute %', signature;
    END IF;

    IF function_config IS NULL
       OR NOT ('search_path=pg_catalog, public, pg_temp' = ANY(function_config)) THEN
      RAISE EXCEPTION 'Fixed search_path missing for %: %', signature, function_config;
    END IF;
  END LOOP;
END
$$;

WITH expected(signature) AS (
  VALUES
    ('public.bw_fund_account(uuid,uuid,integer,text,text,text)'),
    ('public.bw_place_hold(uuid,uuid,integer,text,text)'),
    ('public.bw_release_hold(uuid,uuid,integer,text)'),
    ('public.bw_complete_spend(uuid,uuid,integer,jsonb,text)'),
    ('public.bw_get_agent_balance(uuid)'),
    ('public.bw_register_agent(text,text,text,text,text,text)'),
    ('public.bw_get_daily_spend(uuid)'),
    ('public.bw_get_monthly_spend(uuid)'),
    ('public.bw_verify_transaction(uuid)')
)
SELECT
  expected.signature,
  has_function_privilege('anon', expected.signature, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', expected.signature, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', expected.signature, 'EXECUTE') AS service_role_execute,
  p.prosecdef AS security_definer,
  p.proconfig
FROM expected
JOIN pg_proc AS p ON p.oid = expected.signature::regprocedure
ORDER BY expected.signature;
