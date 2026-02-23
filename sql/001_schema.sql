-- BotWall3t Schema — Standalone Supabase project (public schema, bw_ prefix)
-- Run this in Supabase SQL Editor

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Users (humans who own wallets) ───
CREATE TABLE IF NOT EXISTS bw_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Agents (AI agents with wallets) ───
CREATE TABLE IF NOT EXISTS bw_agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES bw_users(id),
  name TEXT NOT NULL,
  description TEXT,
  api_key_hash TEXT NOT NULL UNIQUE,
  api_key_prefix TEXT NOT NULL,
  frozen BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Accounts (double-entry ledger accounts) ───
CREATE TABLE IF NOT EXISTS bw_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES bw_agents(id),
  user_id UUID REFERENCES bw_users(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bw_accounts_agent ON bw_accounts(agent_id);
CREATE INDEX IF NOT EXISTS idx_bw_accounts_user ON bw_accounts(user_id);

-- ─── Transactions (one logical business event) ───
CREATE TABLE IF NOT EXISTS bw_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  idempotency_key TEXT UNIQUE,
  type TEXT NOT NULL,
  reference TEXT,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bw_transactions_type ON bw_transactions(type);
CREATE INDEX IF NOT EXISTS idx_bw_transactions_idempotency ON bw_transactions(idempotency_key);

-- ─── Postings (the heart of double-entry) ───
CREATE TABLE IF NOT EXISTS bw_postings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID NOT NULL REFERENCES bw_transactions(id),
  account_id UUID NOT NULL REFERENCES bw_accounts(id),
  amount_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bw_postings_transaction ON bw_postings(transaction_id);
CREATE INDEX IF NOT EXISTS idx_bw_postings_account ON bw_postings(account_id);

-- ─── Spend Requests (agent-initiated) ───
CREATE TABLE IF NOT EXISTS bw_spend_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES bw_agents(id),
  transaction_id UUID REFERENCES bw_transactions(id),
  amount_cents INTEGER NOT NULL,
  merchant TEXT NOT NULL,
  description TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  auto_approved BOOLEAN NOT NULL DEFAULT FALSE,
  denial_reason TEXT,
  policy_id UUID,
  expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bw_spend_agent ON bw_spend_requests(agent_id);
CREATE INDEX IF NOT EXISTS idx_bw_spend_status ON bw_spend_requests(status);

-- ─── Policies (spending rules per agent) ───
CREATE TABLE IF NOT EXISTS bw_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES bw_agents(id),
  type TEXT NOT NULL,
  config JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bw_policies_agent ON bw_policies(agent_id);

-- ─── Gift Links ───
CREATE TABLE IF NOT EXISTS bw_gift_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID NOT NULL REFERENCES bw_users(id),
  agent_id UUID NOT NULL REFERENCES bw_agents(id),
  slug TEXT NOT NULL UNIQUE,
  amount_cents INTEGER,
  goal_cents INTEGER,
  raised_cents INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  message TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  claim_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bw_gift_slug ON bw_gift_links(slug);

-- ─── Gift Claims ───
CREATE TABLE IF NOT EXISTS bw_gift_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gift_link_id UUID NOT NULL REFERENCES bw_gift_links(id),
  amount_cents INTEGER NOT NULL,
  stripe_payment_id TEXT,
  funder_name TEXT,
  funder_email TEXT,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Audit Log ───
CREATE TABLE IF NOT EXISTS bw_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bw_audit_actor ON bw_audit_log(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_bw_audit_action ON bw_audit_log(action);

-- ─── Allowances (recurring funding) ───
CREATE TABLE IF NOT EXISTS bw_allowances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES bw_agents(id),
  amount_cents INTEGER NOT NULL,
  frequency TEXT NOT NULL,
  stripe_subscription_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  next_credit_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS but allow service_role full access
ALTER TABLE bw_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bw_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE bw_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bw_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bw_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bw_spend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE bw_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE bw_gift_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE bw_gift_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE bw_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE bw_allowances ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically, so no policies needed for API routes
-- Add anon read access for gift links only
CREATE POLICY "Gift links are publicly readable" ON bw_gift_links FOR SELECT USING (active = true);
