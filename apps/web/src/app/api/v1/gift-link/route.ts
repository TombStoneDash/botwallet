import { NextResponse } from "next/server";
import { getClient } from "@botwallet/db";

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/v1/gift-link",
    method: "POST",
    description: "Create a shareable funding link for an agent.",
    schema: {
      agent_id: "string (required)",
      slug: "string (optional) — custom URL slug",
      title: "string (optional)",
      message: "string (optional)",
      amount_cents: "number (optional) — fixed amount, null for any",
      goal_cents: "number (optional) — funding goal for progress bar",
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

  const agentId = body.agent_id as string;
  if (!agentId) {
    return NextResponse.json(
      { error: true, code: "VALIDATION_ERROR", message: "agent_id is required" },
      { status: 422 }
    );
  }

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
