import { NextResponse } from "next/server";
import { getClient, T } from "@botwallet/db";
import { authenticateAgent, generateApiKey } from "@/lib/auth";
import { authorizeRegister } from "@/lib/agent-authorization";

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/v1/register",
    method: "POST",
    description:
      "Register an additional agent under your own account and get an API key. Creates wallet accounts automatically. Requires an existing bw_... key — owner_email must match the authenticated caller's own account (owner_name is not editable here).",
    schema: {
      owner_email: "string (required) — must match the authenticated caller's own account email",
      owner_name: "string (optional, ignored) — the caller's stored owner name is used instead",
      agent_name: "string (required)",
      agent_description: "string (optional)",
    },
  });
}

export async function POST(request: Request) {
  // X7 / remediation 0.2b: this endpoint used to mint agents/accounts/API
  // keys for anyone, no auth required — fail closed the same way /spend,
  // /balance, /history, /policy already do (see lib/auth.ts). Registering
  // an additional agent now requires an existing bw_... key.
  const callerAgent = await authenticateAgent(request);
  if (!callerAgent) {
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

  // PR7-R3: bearer auth alone is not authorization — resolve the caller's
  // *canonical* owner record server-side via callerAgent.owner_id and bind
  // the new agent to it. A supplied owner_email that doesn't match, or a
  // caller whose owner record can't be resolved, fails closed before the
  // SECURITY DEFINER RPC ever runs (see lib/agent-authorization.ts). This is
  // the existing authenticated same-owner additional-agent flow — not a new
  // bootstrap path.
  const { data: canonicalOwner, error: ownerErr } = await client
    .from(T.users)
    .select("*")
    .eq("id", callerAgent.owner_id)
    .single();

  const authz = authorizeRegister(ownerErr ? null : canonicalOwner, ownerEmail);
  if (!authz.allowed) {
    return NextResponse.json(
      { error: true, code: "FORBIDDEN", message: "Not authorized to register an agent for this owner" },
      { status: 403 }
    );
  }

  const { key, hash, prefix } = generateApiKey();

  const { data, error } = await client.rpc("bw_register_agent", {
    p_owner_email: canonicalOwner.email,
    p_owner_name: canonicalOwner.name,
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
        fund_wallet: "POST /api/v1/fund { agent_id, amount } — agent_id must be your own agent's id",
        spend: "POST /api/v1/spend { amount, merchant, description }",
      },
    },
    { status: 201 }
  );
}
