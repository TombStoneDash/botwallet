// Pure authorization seam for POST /api/v1/gift-link.
//
// Authentication (a valid bw_... key) is not authorization. Before this
// fix, POST /api/v1/gift-link had no auth check at all: any caller could
// mint a shareable funding link for *any* agent_id. This function is the
// single place that decides whether a request's target agent_id binds to
// the authenticated caller. It takes no I/O (no Supabase client, no
// Next.js request/response) so the binding rule can be exercised directly
// in tests without a network connection or a database — same shape as the
// caller/target binding added to /api/v1/fund (see the sibling
// authorizeFund seam referenced in PR #7).

export interface CallerAgent {
  id: string;
}

export interface GiftLinkAuthorization {
  allowed: boolean;
}

/**
 * A gift link may only be created for the authenticated caller's own
 * agent_id — the caller cannot mint a shareable funding link for someone
 * else's wallet. `requestedAgentId` is attacker-controlled request body
 * input, so it's typed `unknown`: anything that isn't exactly the caller's
 * own id is denied.
 */
export function authorizeGiftLink(
  callerAgent: CallerAgent,
  requestedAgentId: unknown
): GiftLinkAuthorization {
  const allowed =
    typeof requestedAgentId === "string" &&
    requestedAgentId.length > 0 &&
    requestedAgentId === callerAgent.id;
  return { allowed };
}
