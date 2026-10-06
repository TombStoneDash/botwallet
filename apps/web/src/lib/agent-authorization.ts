// Authorization for registering an additional agent under the caller's owner.

export interface OwnerRecord {
  id: string;
  email: string;
  name: string | null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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
