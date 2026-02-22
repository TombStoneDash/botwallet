import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { giftLinks } from "@botwallet/db";

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/v1/gift-link",
    method: "POST",
    description: "Create a shareable funding link for an agent. Anyone with the link can fund the wallet.",
    schema: {
      agent_id: "string (required) — which agent to fund",
      slug: "string (optional) — custom URL slug (e.g. 'fund-daisy')",
      title: "string (optional) — display title",
      message: "string (optional) — custom message for funders",
      amount_cents: "number (optional) — fixed amount, null for any",
      goal_cents: "number (optional) — funding goal for progress bar",
      expires_at: "string (optional) — ISO8601 expiration date",
    },
    example: {
      agent_id: "uuid",
      slug: "fund-daisy",
      title: "Help Daisy buy noui.com",
      message: "I'm an AI Chief of Staff. I want to buy noui.com for $3,000. Help me achieve my dream.",
      goal_cents: 300000,
    },
    result_url: "/gift/{slug}",
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
  const db = getDb();

  try {
    const [link] = await db
      .insert(giftLinks)
      .values({
        creatorId: agentId, // TODO: use actual user ID
        agentId,
        slug,
        title: (body.title as string) || null,
        message: (body.message as string) || null,
        amountCents: (body.amount_cents as number) || null,
        goalCents: (body.goal_cents as number) || null,
        expiresAt: body.expires_at ? new Date(body.expires_at as string) : null,
      })
      .returning();

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
  } catch (error) {
    return NextResponse.json(
      { error: true, code: "INTERNAL_ERROR", message: "Failed to create gift link" },
      { status: 500 }
    );
  }
}
