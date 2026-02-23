import type { SupabaseClient } from "@supabase/supabase-js";
import { T } from "@botwallet/db";

// ─── Types ───

export interface FundRequest {
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  description?: string;
  reference?: string;
  idempotencyKey?: string;
}

export interface LedgerResult {
  transactionId: string;
  success: boolean;
  error?: string;
  idempotent?: boolean;
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
  createdAt: string;
}

// ─── Core Ledger Functions (via Supabase RPC) ───

export async function getBalance(
  client: SupabaseClient,
  agentId: string
): Promise<BalanceResult> {
  const { data, error } = await client.rpc("bw_get_agent_balance", {
    p_agent_id: agentId,
  });

  if (error) throw new Error(`Balance error: ${error.message}`);

  return {
    availableCents: data.available_cents,
    heldCents: data.held_cents,
    totalCents: data.total_cents,
    currency: data.currency,
  };
}

export async function fundAccount(
  client: SupabaseClient,
  req: FundRequest
): Promise<LedgerResult> {
  const { data, error } = await client.rpc("bw_fund_account", {
    p_from_account_id: req.fromAccountId,
    p_to_account_id: req.toAccountId,
    p_amount_cents: req.amountCents,
    p_description: req.description || null,
    p_reference: req.reference || null,
    p_idempotency_key: req.idempotencyKey || null,
  });

  if (error) throw new Error(`Fund error: ${error.message}`);

  return {
    transactionId: data.transaction_id || "",
    success: data.success,
    error: data.error,
    idempotent: data.idempotent,
  };
}

export async function placeHold(
  client: SupabaseClient,
  creditsAccountId: string,
  holdsAccountId: string,
  amountCents: number,
  description?: string,
  idempotencyKey?: string
): Promise<LedgerResult> {
  const { data, error } = await client.rpc("bw_place_hold", {
    p_credits_account_id: creditsAccountId,
    p_holds_account_id: holdsAccountId,
    p_amount_cents: amountCents,
    p_description: description || null,
    p_idempotency_key: idempotencyKey || null,
  });

  if (error) throw new Error(`Hold error: ${error.message}`);

  return {
    transactionId: data.transaction_id || "",
    success: data.success,
    error: data.error,
  };
}

export async function releaseHold(
  client: SupabaseClient,
  creditsAccountId: string,
  holdsAccountId: string,
  amountCents: number,
  idempotencyKey?: string
): Promise<LedgerResult> {
  const { data, error } = await client.rpc("bw_release_hold", {
    p_credits_account_id: creditsAccountId,
    p_holds_account_id: holdsAccountId,
    p_amount_cents: amountCents,
    p_idempotency_key: idempotencyKey || null,
  });

  if (error) throw new Error(`Release error: ${error.message}`);

  return {
    transactionId: data.transaction_id || "",
    success: data.success,
    error: data.error,
  };
}

export async function completeSpend(
  client: SupabaseClient,
  holdsAccountId: string,
  platformAccountId: string,
  amountCents: number,
  metadata?: Record<string, unknown>,
  idempotencyKey?: string
): Promise<LedgerResult> {
  const { data, error } = await client.rpc("bw_complete_spend", {
    p_holds_account_id: holdsAccountId,
    p_platform_account_id: platformAccountId,
    p_amount_cents: amountCents,
    p_metadata: metadata || null,
    p_idempotency_key: idempotencyKey || null,
  });

  if (error) throw new Error(`Spend error: ${error.message}`);

  return {
    transactionId: data.transaction_id || "",
    success: data.success,
    error: data.error,
  };
}

export async function getHistory(
  client: SupabaseClient,
  accountId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<HistoryEntry[]> {
  const { limit = 20, offset = 0 } = options;

  const { data, error } = await client
    .from(T.postings)
    .select(`
      amount_cents,
      created_at,
      ${T.transactions}:transaction_id (
        id,
        type,
        description,
        metadata,
        created_at
      )
    `)
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(`History error: ${error.message}`);

  return (data || []).map((row: any) => ({
    id: row[T.transactions].id,
    type: row[T.transactions].type,
    amountCents: row.amount_cents,
    description: row[T.transactions].description,
    metadata: row[T.transactions].metadata,
    createdAt: row[T.transactions].created_at,
  }));
}

export async function verifyTransaction(
  client: SupabaseClient,
  transactionId: string
): Promise<{ balanced: boolean; sum: number }> {
  const { data, error } = await client.rpc("bw_verify_transaction", {
    p_transaction_id: transactionId,
  });

  if (error) throw new Error(`Verify error: ${error.message}`);

  return { balanced: data.balanced, sum: data.sum };
}
