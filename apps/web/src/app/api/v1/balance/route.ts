import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getBalance } from "@botwallet/ledger";

export async function GET(request: Request) {
  const agent = await authenticateAgent(request);
  if (!agent) {
    return NextResponse.json(
      { error: true, code: "UNAUTHORIZED", message: "Invalid or missing API key" },
      { status: 401 }
    );
  }

  const db = getDb();
  const balance = await getBalance(db, agent.id);

  return NextResponse.json({
    agent: agent.name,
    available_cents: balance.availableCents,
    available: `$${(balance.availableCents / 100).toFixed(2)}`,
    held_cents: balance.heldCents,
    held: `$${(balance.heldCents / 100).toFixed(2)}`,
    total_cents: balance.totalCents,
    currency: balance.currency,
  });
}
