import { eq, and, gte, sql } from "drizzle-orm";
import type { Database } from "@botwallet/db";
import { policies, postings, accounts } from "@botwallet/db";

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

// ─── Policy Engine ───

/**
 * Check all active policies for an agent against a spend request.
 * Returns approve/deny/require_human decision.
 */
export async function checkPolicies(
  db: Database,
  check: SpendCheck
): Promise<PolicyDecision> {
  // Get all active policies for this agent
  const activePolicies = await db
    .select()
    .from(policies)
    .where(and(eq(policies.agentId, check.agentId), eq(policies.active, true)));

  // Check each policy in priority order
  for (const policy of activePolicies) {
    const config = policy.config as PolicyConfig;

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
        const todaySpent = await getDailySpend(db, check.agentId);
        if (todaySpent + check.amountCents > dailyCap) {
          return {
            approved: false,
            autoApproved: false,
            reason: `Would exceed daily cap of $${(dailyCap / 100).toFixed(2)} (spent today: $${(todaySpent / 100).toFixed(2)})`,
            policyId: policy.id,
            requiresHumanApproval: true,
          };
        }
        break;
      }

      case "monthly_cap": {
        const monthlyCap = config.amount_cents || 0;
        const monthSpent = await getMonthlySpend(db, check.agentId);
        if (monthSpent + check.amountCents > monthlyCap) {
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

  // If no policy explicitly approved, require human approval
  // (unless there's an auto-approve threshold that wasn't matched — meaning amount is above it)
  const hasAutoApprove = activePolicies.some((p) => p.type === "auto_approve_threshold");
  if (hasAutoApprove) {
    return {
      approved: false,
      autoApproved: false,
      reason: "Amount exceeds auto-approve threshold. Requires human approval.",
      requiresHumanApproval: true,
    };
  }

  // No policies at all — auto-approve (open policy)
  return {
    approved: true,
    autoApproved: true,
    reason: "No policies configured — auto-approved",
  };
}

// ─── Helpers ───

async function getDailySpend(db: Database, agentId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = await db
    .select({
      total: sql<number>`COALESCE(SUM(ABS(${postings.amountCents})), 0)`,
    })
    .from(postings)
    .innerJoin(accounts, eq(postings.accountId, accounts.id))
    .where(
      and(
        eq(accounts.agentId, agentId),
        eq(accounts.type, "agent_credits"),
        gte(postings.createdAt, today),
        sql`${postings.amountCents} < 0` // only debits
      )
    );

  return Number(result[0]?.total ?? 0);
}

async function getMonthlySpend(db: Database, agentId: string): Promise<number> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const result = await db
    .select({
      total: sql<number>`COALESCE(SUM(ABS(${postings.amountCents})), 0)`,
    })
    .from(postings)
    .innerJoin(accounts, eq(postings.accountId, accounts.id))
    .where(
      and(
        eq(accounts.agentId, agentId),
        eq(accounts.type, "agent_credits"),
        gte(postings.createdAt, monthStart),
        sql`${postings.amountCents} < 0`
      )
    );

  return Number(result[0]?.total ?? 0);
}

/**
 * Get a summary of active policies for an agent.
 */
export async function getPolicySummary(
  db: Database,
  agentId: string
): Promise<Array<{ id: string; type: string; config: unknown; active: boolean }>> {
  return db
    .select({
      id: policies.id,
      type: policies.type,
      config: policies.config,
      active: policies.active,
    })
    .from(policies)
    .where(and(eq(policies.agentId, agentId), eq(policies.active, true)));
}
