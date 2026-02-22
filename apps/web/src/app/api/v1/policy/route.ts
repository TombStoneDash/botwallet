import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getPolicySummary } from "@botwallet/policy";

export async function GET(request: Request) {
  const agent = await authenticateAgent(request);
  if (!agent) {
    return NextResponse.json(
      { error: true, code: "UNAUTHORIZED", message: "Invalid or missing API key" },
      { status: 401 }
    );
  }

  const db = getDb();
  const activePolicies = await getPolicySummary(db, agent.id);

  return NextResponse.json({
    agent: agent.name,
    policies: activePolicies.map((p) => ({
      id: p.id,
      type: p.type,
      config: p.config,
      active: p.active,
    })),
    total: activePolicies.length,
  });
}
