// Pure authorization seam for /api/v1/fund and /api/v1/register.
//
// PR7-R3: authentication (a valid bw_... key) was previously treated as
// authorization. Any authenticated agent could name *another* agent_id in
// /fund, or an arbitrary owner_email/owner_name in /register, and the
// handlers would act on it. These functions are the single place that
// decides whether a request's target/owner binds to the authenticated
// caller. They take no I/O (no Supabase client, no Next.js request/response)
// so the binding rules can be exercised directly in runtime tests without a
// network connection or a database.

export interface CallerAgent {
  id: string;
  owner_id: string | null | undefined;
}

export interface OwnerRecord {
  id: string;
  email: string;
  name: string | null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface FundAuthorization {
  allowed: boolean;
}

/**
 * /fund binds the funded agent to the authenticated caller: the caller may
 * only ever fund itself. `requestedAgentId` is attacker-controlled request
 * body input, so it's typed `unknown` — anything that isn't exactly the
 * caller's own id is denied.
 */
export function authorizeFund(callerAgent: CallerAgent, requestedAgentId: unknown): FundAuthorization {
  const allowed =
    typeof requestedAgentId === "string" &&
    requestedAgentId.length > 0 &&
    requestedAgentId === callerAgent.id;
  return { allowed };
}

export type RegisterDenialReason = "MISSING_OWNER" | "OWNER_MISMATCH";

export interface RegisterAuthorization {
  allowed: boolean;
  reason?: RegisterDenialReason;
}

/**
 * /register (additional-agent flow) binds the new agent to the caller's own
 * canonical owner record — resolved server-side via `callerAgent.owner_id`,
 * never trusted from the request body. `canonicalOwner` must be looked up
 * by the caller before calling this; if it can't be resolved, this fails
 * closed rather than assuming zero-to-one bootstrap is intended.
 * `suppliedOwnerEmail` is attacker-controlled request body input.
 */
export function authorizeRegister(
  canonicalOwner: OwnerRecord | null | undefined,
  suppliedOwnerEmail: unknown
): RegisterAuthorization {
  if (!canonicalOwner || !canonicalOwner.email) {
    return { allowed: false, reason: "MISSING_OWNER" };
  }
  if (
    typeof suppliedOwnerEmail !== "string" ||
    normalizeEmail(suppliedOwnerEmail) !== normalizeEmail(canonicalOwner.email)
  ) {
    return { allowed: false, reason: "OWNER_MISMATCH" };
  }
  return { allowed: true };
}
