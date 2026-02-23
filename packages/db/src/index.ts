import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lazy singleton — uses service_role for full access
let _client: SupabaseClient | null = null;

export function getClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    }
    _client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _client;
}

export type { SupabaseClient };

// Table names (bw_ prefix for namespace isolation in public schema)
export const T = {
  users: "bw_users",
  agents: "bw_agents",
  accounts: "bw_accounts",
  transactions: "bw_transactions",
  postings: "bw_postings",
  spend_requests: "bw_spend_requests",
  policies: "bw_policies",
  gift_links: "bw_gift_links",
  gift_claims: "bw_gift_claims",
  audit_log: "bw_audit_log",
  allowances: "bw_allowances",
} as const;
