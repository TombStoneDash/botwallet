import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/auth";
import { getClient, T } from "@botwallet/db";
import { getHistory } from "@botwallet/ledger";

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

  const client = getClient();

  const { data: creditsAccount } = await client
    .from(T.accounts)
    .select("*")
    .eq("agent_id", agent.id)
    .eq("type", "agent_credits")
    .single();

  if (!creditsAccount) {
    return NextResponse.json({ entries: [], total: 0 });
  }

  const entries = await getHistory(client, creditsAccount.id, { limit, offset });

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
