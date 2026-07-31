import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/auth";
import { authorizeGiftLink } from "@/lib/gift-link-authorization";
import { getClient } from "@botwallet/db";

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/v1/gift-link",
    method: "POST",
    auth: "Bearer bw_...",
    description: "Create a shareable funding link for your own agent.",
    schema: {
      agent_id: "string (required) — must match the authenticated caller's own agent id",
      slug: "string (optional) — custom URL slug",
      title: "string (optional)",
      message: "string (optional)",
      amount_cents: "number (optional) — fixed amount, null for any",
      goal_cents: "number (optional) — funding goal for progress bar",
    },
  });
}

export async function POST(request: Request) {
  // Previously unauthenticated: anyone could mint a shareable funding link
  // for any agent_id. Flagged (and explicitly left out of scope) in PR #7
  // alongside the OPUS X7 finding class — unauthenticated money-surface
  // routes. Fail closed the same way /api/v1/spend, /api/v1/balance,
  // /api/v1/history, and /api/v1/policy already do (see lib/auth.ts),
  // and check auth *before* parsing the body or touching the DB.
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

  const requestedAgentId = body.agent_id as string;
  if (!requestedAgentId) {
    return NextResponse.json(
      { error: true, code: "VALIDATION_ERROR", message: "agent_id is required" },
      { status: 422 }
    );
  }

  // Bearer auth alone is not authorization — a caller may only create a
  // gift link for itself. Fail closed with a generic 403 before any DB
  // insert, so the response can't be used to enumerate other agents
  // (mirrors the caller/target ownership binding on /api/v1/fund).
  if (!authorizeGiftLink(callerAgent, requestedAgentId).allowed) {
    return NextResponse.json(
      { error: true, code: "FORBIDDEN", message: "Not authorized to create a gift link for this agent" },
      { status: 403 }
    );
  }

  // Proven equal to requestedAgentId by the check above — use the
  // authenticated identity, not the request-body-echoed value, for
  // everything downstream.
  const agentId = callerAgent.id;

  const slug = (body.slug as string) || `gift-${Date.now().toString(36)}`;
  const client = getClient();

  const { data: link, error } = await client
    .schema("botwallet")
    .from("gift_links")
    .insert({
      creator_id: agentId, // TODO: use actual user ID
      agent_id: agentId,
      slug,
      title: (body.title as string) || null,
      message: (body.message as string) || null,
      amount_cents: (body.amount_cents as number) || null,
      goal_cents: (body.goal_cents as number) || null,
      expires_at: body.expires_at ? new Date(body.expires_at as string).toISOString() : null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: true, code: "INTERNAL_ERROR", message: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      created: true,
      gift_link_id: link.id,
      slug: link.slug,
      url: `/gift/${link.slug}`,
      full_url: `https://botwallet-three.vercel.app/gift/${link.slug}`,
    },
    { status: 201 }
  );
}
