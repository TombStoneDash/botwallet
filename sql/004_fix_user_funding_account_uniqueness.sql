-- BotWall3t funding-authority follow-through — repair the same-owner
-- `user_funding` account invariant.
--
-- Prerequisite decision:
-- BOTWALLET_PR7_FUNDING_AUTHORITY_DECISION_GATE_20260729.md selected model A
-- (agent keys cannot self-fund). This migration is independent source/schema
-- work: bw_register_agent previously inserted a brand new `user_funding`
-- account on every call, even when the owner (matched by email, via the
-- bw_users upsert) already had one from an earlier registration — so
-- registering a second agent for the same owner silently produced a second
-- `user_funding` account.
--
-- This migration makes registration deterministic: create the owner's
-- canonical `user_funding` account only if one doesn't already exist, reuse
-- it otherwise. It fails closed rather than papering over pre-existing bad
-- state: if any owner already has more than one `user_funding` account, the
-- migration refuses to add the uniqueness constraint. Cleaning up existing
-- duplicate rows is a separate, explicitly authorized data action and is not
-- part of this migration.

BEGIN;

DO $guard$
DECLARE
  dupe_owner_count integer;
BEGIN
  SELECT COUNT(*) INTO dupe_owner_count
  FROM (
    SELECT user_id
    FROM bw_accounts
    WHERE type = 'user_funding' AND user_id IS NOT NULL
    GROUP BY user_id
    HAVING COUNT(*) > 1
  ) dupes;

  IF dupe_owner_count > 0 THEN
    RAISE EXCEPTION
      'refusing to add idx_bw_accounts_user_funding_unique: % owner(s) already have more than one user_funding account. That is unexplained pre-existing multiplicity — resolve it as a separate, explicitly authorized data-cleanup action, then re-run this migration.',
      dupe_owner_count;
  END IF;
END
$guard$;

-- IF NOT EXISTS is safe only after proving that a same-named index is the
-- exact constraint this migration expects. Fail closed on catalog drift.
DO $index_guard$
DECLARE
  existing_relation_oid oid;
  existing_relation_kind "char";
  existing_index_oid oid;
  existing_table_oid oid;
  expected_user_id_attnum smallint;
  existing_key text;
  existing_predicate text;
  existing_unique boolean;
  existing_valid boolean;
  existing_ready boolean;
  existing_key_count smallint;
BEGIN
  SELECT a.attnum INTO expected_user_id_attnum
  FROM pg_attribute a
  WHERE a.attrelid = 'public.bw_accounts'::regclass
    AND a.attname = 'user_id'
    AND NOT a.attisdropped;

  SELECT c.oid, c.relkind
  INTO existing_relation_oid, existing_relation_kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'idx_bw_accounts_user_funding_unique';

  IF existing_relation_oid IS NOT NULL
     AND existing_relation_kind NOT IN ('i', 'I') THEN
    RAISE EXCEPTION
      'refusing to reuse idx_bw_accounts_user_funding_unique: same-named relation is not an index (relkind=%)',
      existing_relation_kind;
  END IF;

  SELECT c.oid, i.indrelid, i.indkey::text, pg_get_expr(i.indpred, i.indrelid),
         i.indisunique, i.indisvalid, i.indisready, i.indnkeyatts
  INTO existing_index_oid, existing_table_oid, existing_key, existing_predicate,
       existing_unique, existing_valid, existing_ready, existing_key_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_index i ON i.indexrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relname = 'idx_bw_accounts_user_funding_unique'
    AND c.oid = existing_relation_oid;

  -- Check ownership here, not in the lookup WHERE clause: filtering out a
  -- wrong-table index would let CREATE INDEX IF NOT EXISTS silently skip it.
  IF existing_index_oid IS NOT NULL AND NOT (
    existing_table_oid = 'public.bw_accounts'::regclass
    AND existing_unique
    AND existing_valid
    AND existing_ready
    AND existing_key_count = 1
    AND existing_key = expected_user_id_attnum::text
    AND existing_predicate = '(type = ''user_funding''::text)'
  ) THEN
    RAISE EXCEPTION
      'refusing to reuse idx_bw_accounts_user_funding_unique: same-named index has unexpected definition (definition=%)',
      pg_get_indexdef(existing_index_oid);
  END IF;
END
$index_guard$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bw_accounts_user_funding_unique
  ON bw_accounts (user_id)
  WHERE type = 'user_funding';

CREATE OR REPLACE FUNCTION bw_register_agent(
  p_owner_email TEXT,
  p_owner_name TEXT,
  p_agent_name TEXT,
  p_agent_description TEXT DEFAULT NULL,
  p_api_key_hash TEXT DEFAULT NULL,
  p_api_key_prefix TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_agent_id UUID;
  v_credits_id UUID;
  v_holds_id UUID;
  v_funding_id UUID;
BEGIN
  INSERT INTO bw_users (email, name)
  VALUES (p_owner_email, p_owner_name)
  ON CONFLICT (email) DO UPDATE SET name = COALESCE(EXCLUDED.name, bw_users.name), updated_at = NOW()
  RETURNING id INTO v_user_id;

  INSERT INTO bw_agents (owner_id, name, description, api_key_hash, api_key_prefix)
  VALUES (v_user_id, p_agent_name, p_agent_description, COALESCE(p_api_key_hash, encode(gen_random_bytes(32), 'hex')), COALESCE(p_api_key_prefix, 'bw_temp...'))
  RETURNING id INTO v_agent_id;

  INSERT INTO bw_accounts (agent_id, type, name) VALUES
    (v_agent_id, 'agent_credits', p_agent_name || ' Credits')
  RETURNING id INTO v_credits_id;

  INSERT INTO bw_accounts (agent_id, type, name) VALUES
    (v_agent_id, 'agent_holds', p_agent_name || ' Holds')
  RETURNING id INTO v_holds_id;

  -- One canonical user_funding account per owner: insert only if this owner
  -- doesn't already have one — idx_bw_accounts_user_funding_unique makes this
  -- atomic even under two concurrent registrations for a brand-new owner —
  -- and reuse the existing row otherwise instead of inserting a duplicate.
  INSERT INTO bw_accounts (user_id, type, name)
  VALUES (v_user_id, 'user_funding', p_owner_name || ' Funding')
  ON CONFLICT (user_id) WHERE type = 'user_funding' DO NOTHING
  RETURNING id INTO v_funding_id;

  IF v_funding_id IS NULL THEN
    SELECT id INTO v_funding_id
    FROM bw_accounts
    WHERE user_id = v_user_id AND type = 'user_funding'
    LIMIT 1;
  END IF;

  INSERT INTO bw_audit_log (actor_type, actor_id, action, target, details)
  VALUES ('system', 'registration', 'agent_registered', v_agent_id::TEXT,
    json_build_object('agent_name', p_agent_name, 'owner_email', p_owner_email)::jsonb);

  RETURN json_build_object(
    'success', true,
    'user_id', v_user_id,
    'agent_id', v_agent_id,
    'accounts', json_build_object(
      'credits', v_credits_id,
      'holds', v_holds_id,
      'funding', v_funding_id
    )
  );
END;
$$;

-- CREATE OR REPLACE can replace the function body after the 003 lockdown.
-- Re-assert the hardened lookup path so extensions.gen_random_bytes remains
-- available without falling back to the caller-controlled search_path.
ALTER FUNCTION bw_register_agent(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  SET search_path = pg_catalog, public, extensions, pg_temp;

COMMIT;
