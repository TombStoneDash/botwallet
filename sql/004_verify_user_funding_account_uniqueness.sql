-- Read-only verification for 004_fix_user_funding_account_uniqueness.sql.
-- Does not query application rows beyond aggregate counts and does not
-- invoke bw_register_agent or any other application RPC.

DO $verify$
DECLARE
  dupe_owner_count integer;
  expected_user_id_attnum smallint;
BEGIN
  SELECT a.attnum INTO expected_user_id_attnum
  FROM pg_attribute a
  WHERE a.attrelid = 'public.bw_accounts'::regclass
    AND a.attname = 'user_id'
    AND NOT a.attisdropped;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_index i ON i.indexrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'idx_bw_accounts_user_funding_unique'
      AND i.indrelid = 'public.bw_accounts'::regclass
      AND i.indisunique
      AND i.indisvalid
      AND i.indisready
      AND i.indnkeyatts = 1
      AND i.indkey::text = expected_user_id_attnum::text
      AND pg_get_expr(i.indpred, i.indrelid) = '(type = ''user_funding''::text)'
  ) THEN
    RAISE EXCEPTION 'idx_bw_accounts_user_funding_unique is missing or has an unexpected definition';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.oid = to_regprocedure('public.bw_register_agent(text,text,text,text,text,text)')
      AND pg_get_functiondef(p.oid) ILIKE '%ON CONFLICT (user_id) WHERE type = ''user_funding'' DO NOTHING%'
  ) THEN
    RAISE EXCEPTION 'bw_register_agent does not contain the create-or-reuse user_funding ON CONFLICT clause';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.oid = to_regprocedure('public.bw_register_agent(text,text,text,text,text,text)')
      AND p.proconfig @> ARRAY['search_path=pg_catalog, public, extensions, pg_temp']::text[]
  ) THEN
    RAISE EXCEPTION 'bw_register_agent does not retain the hardened search_path';
  END IF;

  SELECT COUNT(*) INTO dupe_owner_count
  FROM (
    SELECT user_id
    FROM bw_accounts
    WHERE type = 'user_funding' AND user_id IS NOT NULL
    GROUP BY user_id
    HAVING COUNT(*) > 1
  ) dupes;

  IF dupe_owner_count > 0 THEN
    RAISE WARNING '% owner(s) still have more than one user_funding account (pre-existing state; not cleaned by this migration)', dupe_owner_count;
  END IF;
END
$verify$;

SELECT
  (SELECT COUNT(*) FROM bw_accounts WHERE type = 'user_funding') AS total_user_funding_accounts,
  (SELECT COUNT(DISTINCT user_id) FROM bw_accounts WHERE type = 'user_funding' AND user_id IS NOT NULL) AS distinct_owners_with_funding_account;
