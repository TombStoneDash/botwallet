import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    name: "BotWall3t",
    version: "0.1.0",
    tagline: "Give your bot its own money. Don't share your CC.",
    description: "Agent Wallet & Spend Control — Venmo for AI agents. Fund wallets, set policies, full audit trail.",
    base_url: "/api/v1",
    endpoints: {
      "GET  /api/v1": "This document",
      "POST /api/v1/register": "Register an additional agent for your own account, get API key + wallet (agent auth — requires an existing bw_... key; owner is bound to the bearer credential, not to the request body)",
      "GET  /api/v1/balance": "Check agent wallet balance (agent auth)",
      "POST /api/v1/spend": "Request a spend (agent auth, policy checked)",
      "GET  /api/v1/history": "Transaction history (agent auth)",
      "GET  /api/v1/policy": "View active policies (agent auth)",
      "POST /api/v1/fund": "Add funds to your own agent wallet (agent auth; target agent is bound to the bearer credential — you cannot fund another agent)",
      "POST /api/v1/gift-link": "Create shareable funding link",
      "POST /api/v1/freeze": "Freeze agent spending",
      "POST /api/v1/unfreeze": "Unfreeze agent spending",
      "GET  /api/v1/audit": "Full audit trail",
    },
    auth: {
      agent: "Bearer bw_... (API key from /register)",
      human: "Session-based (coming) or system token",
    },
    part_of: {
      platform: "noui.bot",
      description: "Agent-first infrastructure",
      other_services: ["Deploy Rail (shiprail.dev)", "Agent Feedback", "Builder Applications"],
    },
    links: {
      noui_bot: "https://noui.bot",
      github: "https://github.com/TombStoneDash/botwallet",
      docs: "/docs",
    },
  });
}
