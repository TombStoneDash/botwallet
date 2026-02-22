import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { authenticateAgent } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getBalance, placeHold, completeSpend } from "@botwallet/ledger";
import { checkPolicies } from "@botwallet/policy";
import { accounts, spendRequests, auditLog } from "@botwallet/db";

export async function GET(request: Request) {
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
    example: {
      amount: 5.0,
      merchant: "openai.com",
      description: "GPT-4o API call for Scene Partner",
      category: "api",
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
  const db = getDb();

  // Check balance
  const balance = await getBalance(db, agent.id);
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
  const decision = await checkPolicies(db, {
    agentId: agent.id,
    amountCents,
    merchant,
    category: body.category as string | undefined,
  });

  // Get agent accounts
  const agentAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.agentId, agent.id));

  const creditsAccount = agentAccounts.find((a) => a.type === "agent_credits");
  const holdsAccount = agentAccounts.find((a) => a.type === "agent_holds");

  if (!creditsAccount || !holdsAccount) {
    return NextResponse.json(
      { error: true, code: "INTERNAL_ERROR", message: "Agent accounts not configured" },
      { status: 500 }
    );
  }

  // Create spend request
  const [spendRequest] = await db
    .insert(spendRequests)
    .values({
      agentId: agent.id,
      amountCents,
      merchant,
      description: (body.description as string) || null,
      category: (body.category as string) || null,
      status: decision.approved ? "approved" : decision.requiresHumanApproval ? "pending" : "denied",
      autoApproved: decision.autoApproved,
      denialReason: decision.reason && !decision.approved ? decision.reason : null,
      policyId: decision.policyId || null,
      metadata: (body.metadata as Record<string, unknown>) || null,
      expiresAt: decision.requiresHumanApproval
        ? new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h expiry
        : null,
    })
    .returning();

  // If approved, place hold and complete spend
  if (decision.approved) {
    // Get or create a system account for platform
    let platformAccount = agentAccounts.find((a) => a.type === "platform_fees");
    if (!platformAccount) {
      // Use a suspense account — we just need a destination for the double-entry
      const [sys] = await db
        .insert(accounts)
        .values({
          type: "platform_fees",
          name: "Platform (spend destination)",
          agentId: agent.id,
        })
        .returning();
      platformAccount = sys;
    }

    const holdResult = await placeHold(
      db,
      creditsAccount.id,
      holdsAccount.id,
      amountCents,
      `Hold for ${merchant}: ${body.description || ""}`,
      body.idempotency_key as string | undefined
    );

    const spendResult = await completeSpend(
      db,
      holdsAccount.id,
      platformAccount.id,
      amountCents,
      { merchant, description: body.description, ...(body.metadata as Record<string, unknown> || {}) }
    );

    // Mark spend as completed
    await db
      .update(spendRequests)
      .set({ status: "completed", completedAt: new Date(), transactionId: spendResult.transactionId })
      .where(eq(spendRequests.id, spendRequest.id));

    // Audit log
    await db.insert(auditLog).values({
      actorType: "agent",
      actorId: agent.id,
      action: "spend_completed",
      target: merchant,
      details: { amountCents, merchant, autoApproved: true, spendRequestId: spendRequest.id },
    });

    const newBalance = await getBalance(db, agent.id);

    return NextResponse.json(
      {
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
      },
      { status: 200 }
    );
  }

  // If denied or pending
  // Audit log
  await db.insert(auditLog).values({
    actorType: "system",
    actorId: "policy-engine",
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
      expires_at: spendRequest.expiresAt?.toISOString(),
    },
    { status: decision.requiresHumanApproval ? 202 : 403 }
  );
}
