import { NextResponse } from "next/server";
import { getClient, T } from "@botwallet/db";
import { fundAccount } from "@botwallet/ledger";

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

  const client = getClient();
  const amountCents = Math.round(amountDollars * 100);

  const { data: agent, error: agentErr } = await client
    .from(T.agents)
    .select("*")
    .eq("id", agentId)
    .single();

  if (agentErr || !agent) {
    return NextResponse.json(
      { error: true, code: "NOT_FOUND", message: "Agent not found" },
      { status: 404 }
    );
  }

  const { data: creditsAccount } = await client
    .from(T.accounts)
    .select("*")
    .eq("agent_id", agentId)
    .eq("type", "agent_credits")
    .single();

  if (!creditsAccount) {
    return NextResponse.json(
      { error: true, code: "INTERNAL_ERROR", message: "Agent accounts not configured" },
      { status: 500 }
    );
  }

  let { data: fundingAccount } = await client
    .from(T.accounts)
    .select("*")
    .eq("user_id", agent.owner_id)
    .eq("type", "user_funding")
    .single();

  if (!fundingAccount) {
    const { data: newFunding } = await client
      .from(T.accounts)
      .insert({ user_id: agent.owner_id, type: "user_funding", name: "User Funding Source" })
      .select()
      .single();
    fundingAccount = newFunding;
  }

  if (!fundingAccount) {
    return NextResponse.json(
      { error: true, code: "INTERNAL_ERROR", message: "Could not create funding account" },
      { status: 500 }
    );
  }

  const result = await fundAccount(client, {
    fromAccountId: fundingAccount.id,
    toAccountId: creditsAccount.id,
    amountCents,
    description: `Fund ${agent.name} $${amountDollars.toFixed(2)}`,
    reference,
    idempotencyKey: body.idempotency_key as string | undefined,
  });

  await client.from(T.audit_log).insert({
    actor_type: "human",
    actor_id: agent.owner_id,
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
