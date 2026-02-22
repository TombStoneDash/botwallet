import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { giftLinks, agents } from "@botwallet/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const db = getDb();

    const [link] = await db
      .select({
        title: giftLinks.title,
        message: giftLinks.message,
        goalCents: giftLinks.goalCents,
        raisedCents: giftLinks.raisedCents,
        active: giftLinks.active,
        agentId: giftLinks.agentId,
      })
      .from(giftLinks)
      .where(eq(giftLinks.slug, slug))
      .limit(1);

    if (!link || !link.active) {
      return NextResponse.json(
        { error: true, code: "NOT_FOUND", message: "Gift link not found or inactive" },
        { status: 404 }
      );
    }

    // Get agent name
    const [agent] = await db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, link.agentId))
      .limit(1);

    return NextResponse.json({
      title: link.title,
      agent_name: agent?.name || "Agent",
      message: link.message,
      goal_cents: link.goalCents,
      raised_cents: link.raisedCents,
      active: link.active,
    });
  } catch {
    return NextResponse.json(
      { error: true, code: "NOT_FOUND", message: "Gift link not found" },
      { status: 404 }
    );
  }
}
