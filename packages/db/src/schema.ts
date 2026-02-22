import {
  pgTable,
  pgSchema,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
  uuid,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Isolated schema — never shares with other products
export const bw = pgSchema("botwallet");

// ─── Users (humans who own wallets) ───
export const users = bw.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Agents (AI agents with wallets) ───
export const agents = bw.table("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").references(() => users.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  apiKeyHash: text("api_key_hash").notNull().unique(),
  apiKeyPrefix: text("api_key_prefix").notNull(), // "bw_abc..." for display
  frozen: boolean("frozen").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Accounts (double-entry ledger accounts) ───
// Each agent gets: credits, holds
// System accounts: platform_fees, suspense
export const accounts = bw.table("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").references(() => agents.id),
  userId: uuid("user_id").references(() => users.id),
  type: text("type").notNull(), // "agent_credits" | "agent_holds" | "user_funding" | "platform_fees" | "suspense"
  name: text("name").notNull(),
  currency: text("currency").default("USD").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_accounts_agent").on(table.agentId),
  index("idx_accounts_user").on(table.userId),
]);

// ─── Transactions (one logical business event) ───
export const transactions = bw.table("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  idempotencyKey: text("idempotency_key").unique(), // prevent double-processing
  type: text("type").notNull(), // "fund" | "spend" | "hold" | "release" | "refund" | "gift"
  reference: text("reference"), // external reference (Stripe payment intent, etc.)
  description: text("description"),
  metadata: jsonb("metadata"), // { merchant, project, feature, etc. }
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_transactions_type").on(table.type),
  index("idx_transactions_idempotency").on(table.idempotencyKey),
]);

// ─── Postings (the heart of double-entry) ───
// Every transaction has 2+ postings that sum to 0
export const postings = bw.table("postings", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id").references(() => transactions.id).notNull(),
  accountId: uuid("account_id").references(() => accounts.id).notNull(),
  amountCents: integer("amount_cents").notNull(), // positive = debit, negative = credit
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_postings_transaction").on(table.transactionId),
  index("idx_postings_account").on(table.accountId),
]);

// ─── Spend Requests (agent-initiated) ───
export const spendRequests = bw.table("spend_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").references(() => agents.id).notNull(),
  transactionId: uuid("transaction_id").references(() => transactions.id),
  amountCents: integer("amount_cents").notNull(),
  merchant: text("merchant").notNull(),
  description: text("description"),
  category: text("category"), // "api" | "image_gen" | "tools" | "comms" | "other"
  status: text("status").default("pending").notNull(), // "pending" | "approved" | "denied" | "completed" | "expired"
  autoApproved: boolean("auto_approved").default(false).notNull(),
  denialReason: text("denial_reason"),
  policyId: uuid("policy_id"), // which policy triggered
  expiresAt: timestamp("expires_at"),
  completedAt: timestamp("completed_at"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_spend_agent").on(table.agentId),
  index("idx_spend_status").on(table.status),
]);

// ─── Policies (spending rules per agent) ───
export const policies = bw.table("policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").references(() => agents.id).notNull(),
  type: text("type").notNull(), // "merchant_allowlist" | "merchant_blocklist" | "category_block" | "transaction_cap" | "daily_cap" | "monthly_cap" | "auto_approve_threshold"
  config: jsonb("config").notNull(), // { merchants: [...], amount_cents: ..., categories: [...] }
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_policies_agent").on(table.agentId),
]);

// ─── Gift Links ───
export const giftLinks = bw.table("gift_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id").references(() => users.id).notNull(),
  agentId: uuid("agent_id").references(() => agents.id).notNull(),
  slug: text("slug").notNull().unique(), // "fund-daisy"
  amountCents: integer("amount_cents"), // null = any amount
  goalCents: integer("goal_cents"), // for progress bar
  raisedCents: integer("raised_cents").default(0).notNull(),
  title: text("title"),
  message: text("message"),
  active: boolean("active").default(true).notNull(),
  claimCount: integer("claim_count").default(0).notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_gift_slug").on(table.slug),
]);

// ─── Gift Claims (who funded what) ───
export const giftClaims = bw.table("gift_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  giftLinkId: uuid("gift_link_id").references(() => giftLinks.id).notNull(),
  amountCents: integer("amount_cents").notNull(),
  stripePaymentId: text("stripe_payment_id"),
  funderName: text("funder_name"), // optional, for display
  funderEmail: text("funder_email"),
  message: text("message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Audit Log ───
export const auditLog = bw.table("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorType: text("actor_type").notNull(), // "human" | "agent" | "system"
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(), // "policy_changed" | "agent_frozen" | "key_rotated" | "spend_approved" | "spend_denied"
  target: text("target"), // what was acted on
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_audit_actor").on(table.actorType, table.actorId),
  index("idx_audit_action").on(table.action),
]);

// ─── Allowances (recurring funding config) ───
export const allowances = bw.table("allowances", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").references(() => agents.id).notNull(),
  amountCents: integer("amount_cents").notNull(),
  frequency: text("frequency").notNull(), // "daily" | "weekly" | "monthly"
  stripeSubscriptionId: text("stripe_subscription_id"),
  active: boolean("active").default(true).notNull(),
  nextCreditAt: timestamp("next_credit_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
