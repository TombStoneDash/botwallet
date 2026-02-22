import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { generateApiKey } from "@/lib/auth";
import { users, agents, accounts } from "@botwallet/db";

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/v1/register",
    method: "POST",
    description: "Register a new agent and get an API key. Creates wallet accounts automatically.",
    schema: {
      owner_email: "string (required) — your email",
      owner_name: "string (optional) — your name",
      agent_name: "string (required) — name for your agent",
      agent_description: "string (optional) — what your agent does",
    },
    example: {
      owner_email: "hudson@tombstonedash.com",
      owner_name: "Hudson Taylor",
      agent_name: "Daisy",
      agent_description: "AI Chief of Staff — ops, content, deploys, email management",
    },
  });
}

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

  const ownerEmail = (body.owner_email as string)?.trim();
  const agentName = (body.agent_name as string)?.trim();

  if (!ownerEmail || !agentName) {
    return NextResponse.json(
      { error: true, code: "VALIDATION_ERROR", message: "owner_email and agent_name are required" },
      { status: 422 }
    );
  }

  const db = getDb();

  // Find or create user
  let [user] = await db.select().from(users).where(eq(users.email, ownerEmail));
  if (!user) {
    [user] = await db
      .insert(users)
      .values({
        email: ownerEmail,
        name: (body.owner_name as string) || null,
      })
      .returning();
  }

  // Generate API key
  const { key, hash, prefix } = generateApiKey();

  // Create agent
  const [agent] = await db
    .insert(agents)
    .values({
      ownerId: user.id,
      name: agentName,
      description: (body.agent_description as string) || null,
      apiKeyHash: hash,
      apiKeyPrefix: prefix,
    })
    .returning();

  // Create agent accounts (credits + holds)
  await db.insert(accounts).values([
    {
      agentId: agent.id,
      type: "agent_credits",
      name: `${agentName} Credits`,
    },
    {
      agentId: agent.id,
      type: "agent_holds",
      name: `${agentName} Holds`,
    },
  ]);

  return NextResponse.json(
    {
      registered: true,
      agent_id: agent.id,
      agent_name: agentName,
      api_key: key,
      api_key_prefix: prefix,
      message: `${agentName} is registered! Save this API key — it won't be shown again.`,
      next_steps: {
        check_balance: "GET /api/v1/balance (Authorization: Bearer bw_...)",
        fund_wallet: "POST /api/v1/fund { agent_id, amount }",
        spend: "POST /api/v1/spend { amount, merchant, description }",
      },
    },
    { status: 201 }
  );
}
