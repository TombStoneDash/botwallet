import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/auth";
import { getClient } from "@botwallet/db";
import { getBalance, placeHold, completeSpend } from "@botwallet/ledger";
import { checkPolicies } from "@botwallet/policy";

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/v1/spend",
    method: "POST",
    auth: "Bearer bw_...",
    description: "Request a spend from your wallet. Subject to policy checks.",
    schema: {
      amount: "number (required) — dollars, e.g. 5.00",
      merchant: "string (required) — e.g. 'openai.com'",
      description: "string (optional) — what this is for",
      category: "string (optional) — api | image_gen | tools | comms | other",
      metadata: "object (optional) — custom metadata",
      idempotency_key: "string (optional) — prevent double-processing",
    },
  });
}

export async function POST(request: Request) {
  const agent = await authenticateAgent(request);
  if (!agent) {
    return NextResponse.json(
      { error: true, code: "UNAUTHORIZED", message: "Invalid or missing API key" },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: true, code: "BAD_REQUEST", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const amountDollars = body.amount as number;
  const merchant = body.merchant as string;

  if (!amountDollars || !merchant) {
    return NextResponse.json(
      { error: true, code: "VALIDATION_ERROR", message: "amount and merchant are required" },
      { status: 422 }
    );
  }

  if (amountDollars <= 0) {
    return NextResponse.json(
      { error: true, code: "VALIDATION_ERROR", message: "amount must be positive" },
      { status: 422 }
    );
  }

  const amountCents = Math.round(amountDollars * 100);
  const client = getClient();

  // Check balance
  const balance = await getBalance(client, agent.id);
  if (balance.availableCents < amountCents) {
    return NextResponse.json(
      {
        error: true,
        code: "INSUFFICIENT_FUNDS",
        message: `Insufficient funds. Available: $${(balance.availableCents / 100).toFixed(2)}, requested: $${amountDollars.toFixed(2)}`,
        available_cents: balance.availableCents,
      },
      { status: 402 }
    );
  }

  // Check policies
  const decision = await checkPolicies(client, {
    agentId: agent.id,
    amountCents,
    merchant,
    category: body.category as string | undefined,
  });

  // Get agent accounts
  const { data: agentAccounts } = await client
    .schema("botwallet")
    .from("accounts")
    .select("*")
    .eq("agent_id", agent.id);

  const creditsAccount = agentAccounts?.find((a: any) => a.type === "agent_credits");
  const holdsAccount = agentAccounts?.find((a: any) => a.type === "agent_holds");

  if (!creditsAccount || !holdsAccount) {
    return NextResponse.json(
      { error: true, code: "INTERNAL_ERROR", message: "Agent accounts not configured" },
      { status: 500 }
    );
  }

  // Create spend request
  const { data: spendRequest, error: spendErr } = await client
    .schema("botwallet")
    .from("spend_requests")
    .insert({
      agent_id: agent.id,
      amount_cents: amountCents,
      merchant,
      description: (body.description as string) || null,
      category: (body.category as string) || null,
      status: decision.approved ? "approved" : decision.requiresHumanApproval ? "pending" : "denied",
      auto_approved: decision.autoApproved,
      denial_reason: decision.reason && !decision.approved ? decision.reason : null,
      policy_id: decision.policyId || null,
      metadata: (body.metadata as Record<string, unknown>) || null,
      expires_at: decision.requiresHumanApproval
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : null,
    })
    .select()
    .single();

  if (spendErr || !spendRequest) {
    return NextResponse.json(
      { error: true, code: "INTERNAL_ERROR", message: "Failed to create spend request" },
      { status: 500 }
    );
  }

  // If approved, place hold and complete spend
  if (decision.approved) {
    // Get or create platform fees account
    let platformAccount = agentAccounts?.find((a: any) => a.type === "platform_fees");
    if (!platformAccount) {
      const { data: newPlatform } = await client
        .schema("botwallet")
        .from("accounts")
        .insert({
          type: "platform_fees",
          name: "Platform (spend destination)",
          agent_id: agent.id,
        })
        .select()
        .single();
      platformAccount = newPlatform;
    }

    if (!platformAccount) {
      return NextResponse.json(
        { error: true, code: "INTERNAL_ERROR", message: "Failed to create platform account" },
        { status: 500 }
      );
    }

    await placeHold(
      client,
      creditsAccount.id,
      holdsAccount.id,
      amountCents,
      `Hold for ${merchant}: ${body.description || ""}`,
      body.idempotency_key as string | undefined
    );

    const spendResult = await completeSpend(
      client,
      holdsAccount.id,
      platformAccount.id,
      amountCents,
      { merchant, description: body.description, ...(body.metadata as Record<string, unknown> || {}) }
    );

    // Mark spend as completed
    await client
      .schema("botwallet")
      .from("spend_requests")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        transaction_id: spendResult.transactionId,
      })
      .eq("id", spendRequest.id);

    // Audit log
    await client.schema("botwallet").from("audit_log").insert({
      actor_type: "agent",
      actor_id: agent.id,
      action: "spend_completed",
      target: merchant,
      details: { amountCents, merchant, autoApproved: true, spendRequestId: spendRequest.id },
    });

    const newBalance = await getBalance(client, agent.id);

    return NextResponse.json({
      request_id: spendRequest.id,
      status: "completed",
      amount: `$${amountDollars.toFixed(2)}`,
      amount_cents: amountCents,
      merchant,
      auto_approved: decision.autoApproved,
      policy_reason: decision.reason,
      remaining_cents: newBalance.availableCents,
      remaining: `$${(newBalance.availableCents / 100).toFixed(2)}`,
      transaction_id: spendResult.transactionId,
    });
  }

  // Denied or pending
  await client.schema("botwallet").from("audit_log").insert({
    actor_type: "system",
    actor_id: "policy-engine",
    action: decision.requiresHumanApproval ? "spend_pending_approval" : "spend_denied",
    target: merchant,
    details: { amountCents, merchant, reason: decision.reason, policyId: decision.policyId },
  });

  return NextResponse.json(
    {
      request_id: spendRequest.id,
      status: spendRequest.status,
      amount: `$${amountDollars.toFixed(2)}`,
      merchant,
      denial_reason: decision.reason,
      requires_human_approval: decision.requiresHumanApproval || false,
      expires_at: spendRequest.expires_at,
    },
    { status: decision.requiresHumanApproval ? 202 : 403 }
  );
}
