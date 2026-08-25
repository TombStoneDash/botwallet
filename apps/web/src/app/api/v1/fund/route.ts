import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/auth";

// BOTWALLET-FUNDING-AUTHORITY: model A (2026-08-24 decision, recorded in
// BOTWALLET_PR7_FUNDING_AUTHORITY_DECISION_GATE_20260729.md). An agent's own
// bearer credential proves the agent's identity, not funding authority — the
// prior caller-must-target-itself guard (agent-authorization.ts's now-unused
// fund seam) let any agent fund *itself* an arbitrary amount against a
// caller-supplied stripe_payment_id, minting ledger credit with no verified
// payment (a disposable review database accepted 100000000 cents this way).
// Fail closed here — after authentication, before body parsing or any funding,
// ledger, audit-log, or service-role mutation — until a separately verified
// funding-authority principal (decision option B) is implemented. This
// performs no funding RPC, ledger, or audit-log mutation for any request shape;
// authenticateAgent still performs its required read-only identity lookup.
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
