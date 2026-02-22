import { eq, sql, and, gte, lte, desc } from "drizzle-orm";
import type { Database } from "@botwallet/db";
import {
  accounts,
  transactions,
  postings,
  spendRequests,
} from "@botwallet/db";

// ─── Types ───

export interface SpendRequest {
  agentId: string;
  amountCents: number;
  merchant: string;
  description?: string;
  category?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface FundRequest {
  fromAccountId: string; // user's funding account
  toAccountId: string;   // agent's credits account
  amountCents: number;
  description?: string;
  reference?: string;    // Stripe payment ID
  idempotencyKey?: string;
}

export interface LedgerResult {
  transactionId: string;
  success: boolean;
  error?: string;
}

export interface BalanceResult {
  availableCents: number;
  heldCents: number;
  totalCents: number;
  currency: string;
}

export interface HistoryEntry {
  id: string;
  type: string;
  amountCents: number;
  description: string | null;
  metadata: unknown;
  createdAt: Date;
}

// ─── Core Ledger Functions ───

/**
 * Get the balance of an account by summing all postings.
 * This is the source of truth — no stored balance field.
 */
export async function getBalance(
  db: Database,
  agentId: string
): Promise<BalanceResult> {
  // Get credits account balance
  const creditsResult = await db
    .select({
      total: sql<number>`COALESCE(SUM(${postings.amountCents}), 0)`,
    })
    .from(postings)
    .innerJoin(accounts, eq(postings.accountId, accounts.id))
    .where(
      and(eq(accounts.agentId, agentId), eq(accounts.type, "agent_credits"))
    );

  // Get holds account balance
  const holdsResult = await db
    .select({
      total: sql<number>`COALESCE(SUM(${postings.amountCents}), 0)`,
    })
    .from(postings)
    .innerJoin(accounts, eq(postings.accountId, accounts.id))
    .where(
      and(eq(accounts.agentId, agentId), eq(accounts.type, "agent_holds"))
    );

  const totalCents = Number(creditsResult[0]?.total ?? 0);
  const heldCents = Number(holdsResult[0]?.total ?? 0);

  return {
    availableCents: totalCents - heldCents,
    heldCents,
    totalCents,
    currency: "USD",
  };
}

/**
 * Fund an agent's wallet. Creates a double-entry transaction:
 * Debit: user's funding source
 * Credit: agent's credits account
 */
export async function fundAccount(
  db: Database,
  req: FundRequest
): Promise<LedgerResult> {
  if (req.amountCents <= 0) {
    return { transactionId: "", success: false, error: "Amount must be positive" };
  }

  // Create transaction
  const [tx] = await db
    .insert(transactions)
    .values({
      type: "fund",
      reference: req.reference,
      description: req.description || `Fund $${(req.amountCents / 100).toFixed(2)}`,
      idempotencyKey: req.idempotencyKey,
      metadata: { source: "stripe" },
    })
    .returning();

  // Double-entry: debit source, credit destination
  await db.insert(postings).values([
    {
      transactionId: tx.id,
      accountId: req.fromAccountId,
      amountCents: -req.amountCents, // debit (negative = money leaving)
    },
    {
      transactionId: tx.id,
      accountId: req.toAccountId,
      amountCents: req.amountCents, // credit (positive = money arriving)
    },
  ]);

  return { transactionId: tx.id, success: true };
}

/**
 * Place a hold on funds for a spend request.
 * Moves funds from credits → holds.
 */
export async function placeHold(
  db: Database,
  creditsAccountId: string,
  holdsAccountId: string,
  amountCents: number,
  description?: string,
  idempotencyKey?: string
): Promise<LedgerResult> {
  const [tx] = await db
    .insert(transactions)
    .values({
      type: "hold",
      description: description || `Hold $${(amountCents / 100).toFixed(2)}`,
      idempotencyKey,
    })
    .returning();

  await db.insert(postings).values([
    {
      transactionId: tx.id,
      accountId: creditsAccountId,
      amountCents: -amountCents, // remove from credits
    },
    {
      transactionId: tx.id,
      accountId: holdsAccountId,
      amountCents: amountCents, // add to holds
    },
  ]);

  return { transactionId: tx.id, success: true };
}

/**
 * Release a hold (return funds from holds → credits).
 */
export async function releaseHold(
  db: Database,
  creditsAccountId: string,
  holdsAccountId: string,
  amountCents: number,
  idempotencyKey?: string
): Promise<LedgerResult> {
  const [tx] = await db
    .insert(transactions)
    .values({
      type: "release",
      description: `Release hold $${(amountCents / 100).toFixed(2)}`,
      idempotencyKey,
    })
    .returning();

  await db.insert(postings).values([
    {
      transactionId: tx.id,
      accountId: holdsAccountId,
      amountCents: -amountCents, // remove from holds
    },
    {
      transactionId: tx.id,
      accountId: creditsAccountId,
      amountCents: amountCents, // return to credits
    },
  ]);

  return { transactionId: tx.id, success: true };
}

/**
 * Complete a spend (debit from holds → platform/merchant).
 * Called after a hold is approved.
 */
export async function completeSpend(
  db: Database,
  holdsAccountId: string,
  platformAccountId: string,
  amountCents: number,
  metadata?: Record<string, unknown>,
  idempotencyKey?: string
): Promise<LedgerResult> {
  const [tx] = await db
    .insert(transactions)
    .values({
      type: "spend",
      description: `Spend $${(amountCents / 100).toFixed(2)}`,
      metadata,
      idempotencyKey,
    })
    .returning();

  await db.insert(postings).values([
    {
      transactionId: tx.id,
      accountId: holdsAccountId,
      amountCents: -amountCents, // remove from holds (money leaves)
    },
    {
      transactionId: tx.id,
      accountId: platformAccountId,
      amountCents: amountCents, // arrives at platform/external
    },
  ]);

  return { transactionId: tx.id, success: true };
}

/**
 * Get transaction history for an account.
 */
export async function getHistory(
  db: Database,
  accountId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<HistoryEntry[]> {
  const { limit = 20, offset = 0 } = options;

  const results = await db
    .select({
      id: transactions.id,
      type: transactions.type,
      amountCents: postings.amountCents,
      description: transactions.description,
      metadata: transactions.metadata,
      createdAt: transactions.createdAt,
    })
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(eq(postings.accountId, accountId))
    .orderBy(desc(transactions.createdAt))
    .limit(limit)
    .offset(offset);

  return results;
}

/**
 * Verify ledger integrity: sum of all postings for a transaction must be 0.
 */
export async function verifyTransaction(
  db: Database,
  transactionId: string
): Promise<{ balanced: boolean; sum: number }> {
  const result = await db
    .select({
      sum: sql<number>`SUM(${postings.amountCents})`,
    })
    .from(postings)
    .where(eq(postings.transactionId, transactionId));

  const sum = Number(result[0]?.sum ?? 0);
  return { balanced: sum === 0, sum };
}
