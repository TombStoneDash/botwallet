import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { authenticateAgent } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getHistory } from "@botwallet/ledger";
import { accounts } from "@botwallet/db";

export async function GET(request: Request) {
  const agent = await authenticateAgent(request);
  if (!agent) {
    return NextResponse.json(
      { error: true, code: "UNAUTHORIZED", message: "Invalid or missing API key" },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const db = getDb();

  // Get agent's credits account
  const [creditsAccount] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.agentId, agent.id), eq(accounts.type, "agent_credits")));

  if (!creditsAccount) {
    return NextResponse.json({ entries: [], total: 0 });
  }

  const entries = await getHistory(db, creditsAccount.id, { limit, offset });

  return NextResponse.json({
    agent: agent.name,
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      amount_cents: e.amountCents,
      amount: `${e.amountCents >= 0 ? "+" : ""}$${(Math.abs(e.amountCents) / 100).toFixed(2)}`,
      description: e.description,
      metadata: e.metadata,
      created_at: e.createdAt,
    })),
    limit,
    offset,
  });
}
