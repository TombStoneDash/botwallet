import { NextResponse } from "next/server";
import { getClient } from "@botwallet/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const client = getClient();

    const { data: link, error } = await client
      .schema("botwallet")
      .from("gift_links")
      .select("title, message, goal_cents, raised_cents, active, agent_id")
      .eq("slug", slug)
      .single();

    if (error || !link || !link.active) {
      return NextResponse.json(
        { error: true, code: "NOT_FOUND", message: "Gift link not found or inactive" },
        { status: 404 }
      );
    }

    // Get agent name
    const { data: agent } = await client
      .schema("botwallet")
      .from("agents")
      .select("name")
      .eq("id", link.agent_id)
      .single();

    return NextResponse.json({
      title: link.title,
      agent_name: agent?.name || "Agent",
      message: link.message,
      goal_cents: link.goal_cents,
      raised_cents: link.raised_cents,
      active: link.active,
    });
  } catch {
    return NextResponse.json(
      { error: true, code: "NOT_FOUND", message: "Gift link not found" },
      { status: 404 }
    );
  }
}
