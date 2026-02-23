-- BotWall3t RPC Functions — Atomic ledger operations (public schema, bw_ prefix)
-- Run this in Supabase SQL Editor AFTER 001_schema.sql

-- ─── Fund an agent's wallet (atomic double-entry) ───
CREATE OR REPLACE FUNCTION bw_fund_account(
  p_from_account_id UUID,
  p_to_account_id UUID,
  p_amount_cents INTEGER,
  p_description TEXT DEFAULT NULL,
  p_reference TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tx_id UUID;
BEGIN
  IF p_amount_cents <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_tx_id FROM bw_transactions WHERE idempotency_key = p_idempotency_key;
    IF v_tx_id IS NOT NULL THEN
      RETURN json_build_object('success', true, 'transaction_id', v_tx_id, 'idempotent', true);
    END IF;
  END IF;

  INSERT INTO bw_transactions (type, reference, description, idempotency_key, metadata)
  VALUES ('fund', p_reference, COALESCE(p_description, 'Fund $' || (p_amount_cents / 100.0)::TEXT), p_idempotency_key, '{"source": "api"}'::jsonb)
  RETURNING id INTO v_tx_id;

  INSERT INTO bw_postings (transaction_id, account_id, amount_cents)
  VALUES
    (v_tx_id, p_from_account_id, -p_amount_cents),
    (v_tx_id, p_to_account_id, p_amount_cents);

  RETURN json_build_object('success', true, 'transaction_id', v_tx_id);
END;
$$;

-- ─── Place a hold on funds ───
CREATE OR REPLACE FUNCTION bw_place_hold(
  p_credits_account_id UUID,
  p_holds_account_id UUID,
  p_amount_cents INTEGER,
  p_description TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tx_id UUID;
  v_available INTEGER;
BEGIN
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_available
  FROM bw_postings WHERE account_id = p_credits_account_id;

  IF v_available < p_amount_cents THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient funds. Available: ' || v_available || ' cents');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_tx_id FROM bw_transactions WHERE idempotency_key = p_idempotency_key;
    IF v_tx_id IS NOT NULL THEN
      RETURN json_build_object('success', true, 'transaction_id', v_tx_id, 'idempotent', true);
    END IF;
  END IF;

  INSERT INTO bw_transactions (type, description, idempotency_key)
  VALUES ('hold', COALESCE(p_description, 'Hold $' || (p_amount_cents / 100.0)::TEXT), p_idempotency_key)
  RETURNING id INTO v_tx_id;

  INSERT INTO bw_postings (transaction_id, account_id, amount_cents)
  VALUES
    (v_tx_id, p_credits_account_id, -p_amount_cents),
    (v_tx_id, p_holds_account_id, p_amount_cents);

  RETURN json_build_object('success', true, 'transaction_id', v_tx_id);
END;
$$;

-- ─── Release a hold ───
CREATE OR REPLACE FUNCTION bw_release_hold(
  p_credits_account_id UUID,
  p_holds_account_id UUID,
  p_amount_cents INTEGER,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tx_id UUID;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_tx_id FROM bw_transactions WHERE idempotency_key = p_idempotency_key;
    IF v_tx_id IS NOT NULL THEN
      RETURN json_build_object('success', true, 'transaction_id', v_tx_id, 'idempotent', true);
    END IF;
  END IF;

  INSERT INTO bw_transactions (type, description, idempotency_key)
  VALUES ('release', 'Release hold $' || (p_amount_cents / 100.0)::TEXT, p_idempotency_key)
  RETURNING id INTO v_tx_id;

  INSERT INTO bw_postings (transaction_id, account_id, amount_cents)
  VALUES
    (v_tx_id, p_holds_account_id, -p_amount_cents),
    (v_tx_id, p_credits_account_id, p_amount_cents);

  RETURN json_build_object('success', true, 'transaction_id', v_tx_id);
END;
$$;

-- ─── Complete a spend (from holds → platform) ───
CREATE OR REPLACE FUNCTION bw_complete_spend(
  p_holds_account_id UUID,
  p_platform_account_id UUID,
  p_amount_cents INTEGER,
  p_metadata JSONB DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tx_id UUID;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_tx_id FROM bw_transactions WHERE idempotency_key = p_idempotency_key;
    IF v_tx_id IS NOT NULL THEN
      RETURN json_build_object('success', true, 'transaction_id', v_tx_id, 'idempotent', true);
    END IF;
  END IF;

  INSERT INTO bw_transactions (type, description, metadata, idempotency_key)
  VALUES ('spend', 'Spend $' || (p_amount_cents / 100.0)::TEXT, p_metadata, p_idempotency_key)
  RETURNING id INTO v_tx_id;

  INSERT INTO bw_postings (transaction_id, account_id, amount_cents)
  VALUES
    (v_tx_id, p_holds_account_id, -p_amount_cents),
    (v_tx_id, p_platform_account_id, p_amount_cents);

  RETURN json_build_object('success', true, 'transaction_id', v_tx_id);
END;
$$;

-- ─── Get agent balance (computed from postings) ───
CREATE OR REPLACE FUNCTION bw_get_agent_balance(p_agent_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_credits INTEGER;
  v_holds INTEGER;
BEGIN
  SELECT COALESCE(SUM(p.amount_cents), 0) INTO v_credits
  FROM bw_postings p
  JOIN bw_accounts a ON p.account_id = a.id
  WHERE a.agent_id = p_agent_id AND a.type = 'agent_credits';

  SELECT COALESCE(SUM(p.amount_cents), 0) INTO v_holds
  FROM bw_postings p
  JOIN bw_accounts a ON p.account_id = a.id
  WHERE a.agent_id = p_agent_id AND a.type = 'agent_holds';

  RETURN json_build_object(
    'available_cents', v_credits - v_holds,
    'held_cents', v_holds,
    'total_cents', v_credits,
    'currency', 'USD'
  );
END;
$$;

-- ─── Register agent + create accounts (atomic) ───
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

-- ─── Get daily spend for an agent ───
CREATE OR REPLACE FUNCTION bw_get_daily_spend(p_agent_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_total INTEGER;
BEGIN
  SELECT COALESCE(SUM(ABS(p.amount_cents)), 0) INTO v_total
  FROM bw_postings p
  JOIN bw_accounts a ON p.account_id = a.id
  WHERE a.agent_id = p_agent_id
    AND a.type = 'agent_credits'
    AND p.amount_cents < 0
    AND p.created_at >= DATE_TRUNC('day', NOW());
  RETURN v_total;
END;
$$;

-- ─── Get monthly spend for an agent ───
CREATE OR REPLACE FUNCTION bw_get_monthly_spend(p_agent_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_total INTEGER;
BEGIN
  SELECT COALESCE(SUM(ABS(p.amount_cents)), 0) INTO v_total
  FROM bw_postings p
  JOIN bw_accounts a ON p.account_id = a.id
  WHERE a.agent_id = p_agent_id
    AND a.type = 'agent_credits'
    AND p.amount_cents < 0
    AND p.created_at >= DATE_TRUNC('month', NOW());
  RETURN v_total;
END;
$$;

-- ─── Verify transaction balance (sum of postings = 0) ───
CREATE OR REPLACE FUNCTION bw_verify_transaction(p_transaction_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_sum INTEGER;
BEGIN
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_sum
  FROM bw_postings WHERE transaction_id = p_transaction_id;
  RETURN json_build_object('balanced', v_sum = 0, 'sum', v_sum);
END;
$$;
