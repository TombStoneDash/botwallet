/**
 * BotWall3t SDK — TypeScript client for AI agents.
 *
 * Usage:
 *   import { BotWallet } from '@botwallet/sdk';
 *   const wallet = new BotWallet({ apiKey: 'bw_...' });
 *   const balance = await wallet.balance();
 *   const result = await wallet.spend({ amount: 5.00, merchant: 'openai.com' });
 */

export interface BotWalletConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface BalanceResponse {
  agent: string;
  available_cents: number;
  available: string;
  held_cents: number;
  held: string;
  total_cents: number;
  currency: string;
}

export interface SpendRequest {
  amount: number;
  merchant: string;
  description?: string;
  category?: string;
  metadata?: Record<string, unknown>;
  idempotency_key?: string;
}

export interface SpendResponse {
  request_id: string;
  status: "completed" | "pending" | "denied";
  amount: string;
  amount_cents: number;
  merchant: string;
  auto_approved?: boolean;
  remaining_cents?: number;
  remaining?: string;
  denial_reason?: string;
  transaction_id?: string;
}

export interface HistoryEntry {
  id: string;
  type: string;
  amount_cents: number;
  amount: string;
  description: string | null;
  metadata: unknown;
  created_at: string;
}

export interface PolicyEntry {
  id: string;
  type: string;
  config: unknown;
  active: boolean;
}

export class BotWallet {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: BotWalletConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://botwallet-three.vercel.app";
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    const data = await res.json();

    if (!res.ok) {
      const error = data as { code?: string; message?: string };
      throw new BotWalletError(
        error.message || `Request failed with ${res.status}`,
        error.code || "UNKNOWN",
        res.status
      );
    }

    return data as T;
  }

  /** Check wallet balance */
  async balance(): Promise<BalanceResponse> {
    return this.request<BalanceResponse>("/balance");
  }

  /** Request a spend (subject to policy checks) */
  async spend(req: SpendRequest): Promise<SpendResponse> {
    return this.request<SpendResponse>("/spend", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  /** Get transaction history */
  async history(options?: { limit?: number; offset?: number }): Promise<{ entries: HistoryEntry[] }> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    const qs = params.toString();
    return this.request(`/history${qs ? `?${qs}` : ""}`);
  }

  /** View active spending policies */
  async policies(): Promise<{ policies: PolicyEntry[] }> {
    return this.request("/policy");
  }
}

export class BotWalletError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "BotWalletError";
    this.code = code;
    this.status = status;
  }
}

export default BotWallet;
