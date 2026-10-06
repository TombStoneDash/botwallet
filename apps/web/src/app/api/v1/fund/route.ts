import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/auth";

// An agent key proves identity, not payment or funding authority. Model A
// rejects all funding after the read-only authentication lookup, before
// parsing the body or making any ledger, account, RPC, or audit mutation.
// A verified payment/funding authority must be designed before enabling this.
export async function POST(request: Request) {
  const callerAgent = await authenticateAgent(request);
  if (!callerAgent) {
    return NextResponse.json(
      { error: true, code: "UNAUTHORIZED", message: "Invalid or missing API key" },
      { status: 401 }
    );
  }

  return NextResponse.json(
    {
      error: true,
      code: "FUNDING_UNAVAILABLE",
      message:
        "Agent-initiated funding is not available. An agent's own API key cannot add funds to any wallet, including its own.",
    },
    { status: 403 }
  );
}
