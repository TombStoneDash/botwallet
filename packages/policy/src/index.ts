import type { SupabaseClient } from "@supabase/supabase-js";
import { T } from "@botwallet/db";

// ─── Types ───

export interface SpendCheck {
  agentId: string;
  amountCents: number;
  merchant: string;
  category?: string;
}

export type PolicyDecision = {
  approved: boolean;
  autoApproved: boolean;
  reason?: string;
  policyId?: string;
  requiresHumanApproval?: boolean;
};

interface PolicyConfig {
  merchants?: string[];
  categories?: string[];
  amount_cents?: number;
}

interface PolicyRow {
  id: string;
  type: string;
  config: PolicyConfig;
  active: boolean;
}

// ─── Policy Engine ───

export async function checkPolicies(
  client: SupabaseClient,
  check: SpendCheck
): Promise<PolicyDecision> {
  const { data: activePolicies, error } = await client
    .from(T.policies)
    .select("id, type, config, active")
    .eq("agent_id", check.agentId)
    .eq("active", true);

  if (error) throw new Error(`Policy check error: ${error.message}`);

  const policies = (activePolicies || []) as PolicyRow[];

  for (const policy of policies) {
    const config = policy.config;

    switch (policy.type) {
      case "merchant_blocklist": {
        const blocked = config.merchants || [];
        if (blocked.some((m) => check.merchant.toLowerCase().includes(m.toLowerCase()))) {
          return {
            approved: false,
            autoApproved: false,
            reason: `Merchant "${check.merchant}" is blocked by policy`,
            policyId: policy.id,
          };
        }
        break;
      }

      case "merchant_allowlist": {
        const allowed = config.merchants || [];
        if (allowed.length > 0 && !allowed.some((m) => check.merchant.toLowerCase().includes(m.toLowerCase()))) {
          return {
            approved: false,
            autoApproved: false,
            reason: `Merchant "${check.merchant}" is not on the allowlist`,
            policyId: policy.id,
          };
        }
        break;
      }

      case "category_block": {
        const blockedCategories = config.categories || [];
        if (check.category && blockedCategories.includes(check.category)) {
          return {
            approved: false,
            autoApproved: false,
            reason: `Category "${check.category}" is blocked`,
            policyId: policy.id,
          };
        }
        break;
      }

      case "transaction_cap": {
        const maxCents = config.amount_cents || 0;
        if (check.amountCents > maxCents) {
          return {
            approved: false,
            autoApproved: false,
            reason: `Amount $${(check.amountCents / 100).toFixed(2)} exceeds transaction cap of $${(maxCents / 100).toFixed(2)}`,
            policyId: policy.id,
            requiresHumanApproval: true,
          };
        }
        break;
      }

      case "daily_cap": {
        const dailyCap = config.amount_cents || 0;
        const { data: todaySpent } = await client.rpc("bw_get_daily_spend", {
          p_agent_id: check.agentId,
        });
        if ((todaySpent || 0) + check.amountCents > dailyCap) {
          return {
            approved: false,
            autoApproved: false,
            reason: `Would exceed daily cap of $${(dailyCap / 100).toFixed(2)} (spent today: $${((todaySpent || 0) / 100).toFixed(2)})`,
            policyId: policy.id,
            requiresHumanApproval: true,
          };
        }
        break;
      }

      case "monthly_cap": {
        const monthlyCap = config.amount_cents || 0;
        const { data: monthSpent } = await client.rpc("bw_get_monthly_spend", {
          p_agent_id: check.agentId,
        });
        if ((monthSpent || 0) + check.amountCents > monthlyCap) {
          return {
            approved: false,
            autoApproved: false,
            reason: `Would exceed monthly cap of $${(monthlyCap / 100).toFixed(2)}`,
            policyId: policy.id,
            requiresHumanApproval: true,
          };
        }
        break;
      }

      case "auto_approve_threshold": {
        const threshold = config.amount_cents || 0;
        if (check.amountCents <= threshold) {
          return {
            approved: true,
            autoApproved: true,
            reason: `Auto-approved: under $${(threshold / 100).toFixed(2)} threshold`,
            policyId: policy.id,
          };
        }
        break;
      }
    }
  }

  const hasAutoApprove = policies.some((p) => p.type === "auto_approve_threshold");
  if (hasAutoApprove) {
    return {
      approved: false,
      autoApproved: false,
      reason: "Amount exceeds auto-approve threshold. Requires human approval.",
      requiresHumanApproval: true,
    };
  }

  return {
    approved: true,
    autoApproved: true,
    reason: "No policies configured — auto-approved",
  };
}

export async function getPolicySummary(
  client: SupabaseClient,
  agentId: string
): Promise<Array<{ id: string; type: string; config: unknown; active: boolean }>> {
  const { data, error } = await client
    .from(T.policies)
    .select("id, type, config, active")
    .eq("agent_id", agentId)
    .eq("active", true);

  if (error) throw new Error(`Policy summary error: ${error.message}`);
  return data || [];
}
