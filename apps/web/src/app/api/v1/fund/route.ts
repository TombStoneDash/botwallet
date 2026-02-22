import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { fundAccount } from "@botwallet/ledger";
import { accounts, agents, auditLog } from "@botwallet/db";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: true, code: "BAD_REQUEST", message: "Invalid JSON" },
      { status: 400 }
    );
  }

  const agentId = body.agent_id as string;
  const amountDollars = body.amount as number;
  const reference = body.stripe_payment_id as string | undefined;

  if (!agentId || !amountDollars) {
    return NextResponse.json(
      { error: true, code: "VALIDATION_ERROR", message: "agent_id and amount are required" },
      { status: 422 }
    );
  }

  if (amountDollars <= 0) {
    return NextResponse.json(
      { error: true, code: "VALIDATION_ERROR", message: "amount must be positive" },
      { status: 422 }
    );
  }

  const db = getDb();
  const amountCents = Math.round(amountDollars * 100);

  // Verify agent exists
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) {
    return NextResponse.json(
      { error: true, code: "NOT_FOUND", message: "Agent not found" },
      { status: 404 }
    );
  }

  // Get agent's credits account
  const [creditsAccount] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.agentId, agentId), eq(accounts.type, "agent_credits")));

  if (!creditsAccount) {
    return NextResponse.json(
      { error: true, code: "INTERNAL_ERROR", message: "Agent accounts not configured" },
      { status: 500 }
    );
  }

  // Get or create user funding source account
  let [fundingAccount] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, agent.ownerId), eq(accounts.type, "user_funding")));

  if (!fundingAccount) {
    [fundingAccount] = await db
      .insert(accounts)
      .values({
        userId: agent.ownerId,
        type: "user_funding",
        name: "User Funding Source",
      })
      .returning();
  }

  // Fund the agent
  const result = await fundAccount(db, {
    fromAccountId: fundingAccount.id,
    toAccountId: creditsAccount.id,
    amountCents,
    description: `Fund ${agent.name} $${amountDollars.toFixed(2)}`,
    reference,
    idempotencyKey: body.idempotency_key as string | undefined,
  });

  // Audit log
  await db.insert(auditLog).values({
    actorType: "human",
    actorId: agent.ownerId,
    action: "agent_funded",
    target: agentId,
    details: { amountCents, reference },
  });

  return NextResponse.json(
    {
      funded: true,
      agent: agent.name,
      amount: `$${amountDollars.toFixed(2)}`,
      amount_cents: amountCents,
      transaction_id: result.transactionId,
      message: `${agent.name}'s wallet has been funded.`,
    },
    { status: 201 }
  );
}
