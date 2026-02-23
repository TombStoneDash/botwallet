import { NextResponse } from "next/server";
import { getClient } from "@botwallet/db";
import { generateApiKey } from "@/lib/auth";

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/v1/register",
    method: "POST",
    description: "Register a new agent and get an API key. Creates wallet accounts automatically.",
    schema: {
      owner_email: "string (required)",
      owner_name: "string (optional)",
      agent_name: "string (required)",
      agent_description: "string (optional)",
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

  const client = getClient();
  const { key, hash, prefix } = generateApiKey();

  const { data, error } = await client.rpc("bw_register_agent", {
    p_owner_email: ownerEmail,
    p_owner_name: (body.owner_name as string) || null,
    p_agent_name: agentName,
    p_agent_description: (body.agent_description as string) || null,
    p_api_key_hash: hash,
    p_api_key_prefix: prefix,
  });

  if (error) {
    return NextResponse.json(
      { error: true, code: "INTERNAL_ERROR", message: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      registered: true,
      agent_id: data.agent_id,
      agent_name: agentName,
      api_key: key,
      api_key_prefix: prefix,
      accounts: data.accounts,
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
