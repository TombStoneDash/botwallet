-- DATA-INTEGRITY ROLLBACK ONLY — restores the pre-004 bw_register_agent
-- behavior (unconditionally inserts a new user_funding account on every
-- call) and drops the one-user_funding-account-per-owner unique index added
-- by 004_fix_user_funding_account_uniqueness.sql.
--
-- Apply only if a confirmed application dependency needs the prior
-- multi-account-per-owner behavior and the incident owner authorizes
-- rollback. No table data is changed or deleted.

BEGIN;

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

  INSERT INTO bw_accounts (user_id, type, name) VALUES
    (v_user_id, 'user_funding', p_owner_name || ' Funding')
  RETURNING id INTO v_funding_id;

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

-- Preserve the 003 security hardening while restoring only the pre-004 body.
ALTER FUNCTION bw_register_agent(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  SET search_path = pg_catalog, public, extensions, pg_temp;

DROP INDEX IF EXISTS idx_bw_accounts_user_funding_unique;

COMMIT;
