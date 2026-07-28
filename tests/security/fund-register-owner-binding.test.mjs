import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  authorizeFund,
  authorizeRegister,
  normalizeEmail,
} from "../../apps/web/src/lib/agent-authorization.ts";

// PR7-R3 (BOTWALLET-PR7-CALLER-OWNER-BINDING): PR #7 (X7) added bearer auth
// to POST /api/v1/fund and POST /api/v1/register, but neither handler bound
// the authenticated `callerAgent` to the resource the request targeted:
//   - /fund accepted any body.agent_id and funded that account, regardless
//     of who the bearer key belonged to.
//   - /register accepted any body.owner_email/owner_name and passed it
//     straight to the SECURITY DEFINER bw_register_agent RPC, regardless of
//     the caller's actual owner.
// "Authenticated" is not "authorized" — this file exercises the pure
// decision seam (apps/web/src/lib/agent-authorization.ts) that both routes
// now gate on, at runtime, with zero network/DB access. It's a companion to
// (not a replacement for) the source-order checks at the bottom of this
// file, which prove the routes actually call this seam before touching
// fundAccount / bw_register_agent.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => readFile(path.join(ROOT, relativePath), "utf8");

// ─── authorizeFund: self/cross-agent binding ───────────────────────────────

test("authorizeFund allows an agent to fund exactly itself", () => {
  const callerAgent = { id: "agent-A", owner_id: "owner-1" };
  assert.equal(authorizeFund(callerAgent, "agent-A").allowed, true);
});

test("authorizeFund denies funding a different agent_id (the X7 cross-agent exploit shape)", () => {
  const callerAgent = { id: "agent-A", owner_id: "owner-1" };
  assert.equal(authorizeFund(callerAgent, "agent-B").allowed, false);
});

test("authorizeFund denies missing, empty, or non-string agent_id", () => {
  const callerAgent = { id: "agent-A", owner_id: "owner-1" };
  for (const requested of [undefined, null, "", 42, {}, ["agent-A"]]) {
    assert.equal(
      authorizeFund(callerAgent, requested).allowed,
      false,
      `expected denial for requested agent_id ${JSON.stringify(requested)}`
    );
  }
});

test("authorizeFund is case-sensitive and does not treat prefix/substring ids as a match", () => {
  const callerAgent = { id: "agent-A", owner_id: "owner-1" };
  assert.equal(authorizeFund(callerAgent, "agent-A ").allowed, false);
  assert.equal(authorizeFund(callerAgent, "AGENT-A").allowed, false);
  assert.equal(authorizeFund(callerAgent, "agent-A-extra").allowed, false);
});

// ─── authorizeRegister: canonical-owner binding ────────────────────────────

test("authorizeRegister allows a supplied owner_email that exactly matches the caller's canonical owner", () => {
  const canonicalOwner = { id: "owner-1", email: "real@owner.com", name: "Real Owner" };
  const result = authorizeRegister(canonicalOwner, "real@owner.com");
  assert.equal(result.allowed, true);
  assert.equal(result.reason, undefined);
});

test("authorizeRegister allows a case- and whitespace-normalized same-email match", () => {
  const canonicalOwner = { id: "owner-1", email: "real@owner.com", name: "Real Owner" };
  assert.equal(authorizeRegister(canonicalOwner, "  Real@Owner.COM \t").allowed, true);
  assert.equal(normalizeEmail("  Real@Owner.COM \t"), "real@owner.com");
});

test("authorizeRegister denies a supplied owner_email belonging to another owner (cross-owner exploit shape)", () => {
  const canonicalOwner = { id: "owner-1", email: "real@owner.com", name: "Real Owner" };
  const result = authorizeRegister(canonicalOwner, "someone-else@owner.com");
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "OWNER_MISMATCH");
});

test("authorizeRegister fails closed when the caller's canonical owner cannot be resolved", () => {
  for (const canonicalOwner of [null, undefined, { id: "owner-1", email: "", name: null }]) {
    const result = authorizeRegister(canonicalOwner, "anything@owner.com");
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "MISSING_OWNER");
  }
});

test("authorizeRegister denies a non-string owner_email even if it would coincidentally loosely match", () => {
  const canonicalOwner = { id: "owner-1", email: "real@owner.com", name: "Real Owner" };
  assert.equal(authorizeRegister(canonicalOwner, undefined).allowed, false);
  assert.equal(authorizeRegister(canonicalOwner, null).allowed, false);
  assert.equal(authorizeRegister(canonicalOwner, 12345).allowed, false);
});

// ─── Runtime proof: denied decisions never reach the guarded mutation ──────
//
// These tests wire authorizeFund/authorizeRegister into the exact
// "decide, then act" shape the routes use (guard first, mutate only on
// allow) with spy effects standing in for fundAccount / the
// bw_register_agent RPC. No network or database is touched. This proves the
// *decision* the routes depend on — combined with the source-order tests
// below, which prove the routes are wired to that decision — that neither
// endpoint's mutation can be reached by a denied request.

function makeSpy(returnValue) {
  const spy = (...args) => {
    spy.calls.push(args);
    return returnValue;
  };
  spy.calls = [];
  return spy;
}

// Mirrors fund/route.ts's control flow: authorize, then (only if allowed) act.
function guardedFund(callerAgent, requestedAgentId, effect) {
  const decision = authorizeFund(callerAgent, requestedAgentId);
  if (!decision.allowed) return { status: 403 };
  effect(requestedAgentId);
  return { status: 201 };
}

// Mirrors register/route.ts's control flow: resolve canonical owner
// (already done by the caller, as in the real route), authorize, then
// (only if allowed) act using ONLY canonical fields — never the supplied
// owner_email/owner_name.
function guardedRegister(canonicalOwner, suppliedOwnerEmail, suppliedOwnerName, effect) {
  const decision = authorizeRegister(canonicalOwner, suppliedOwnerEmail);
  if (!decision.allowed) return { status: 403 };
  effect({ p_owner_email: canonicalOwner.email, p_owner_name: canonicalOwner.name });
  return { status: 201 };
}

test("proof: cross-agent /fund request never invokes the ledger fund effect", () => {
  const fundAccountSpy = makeSpy({ transactionId: "should-not-happen" });
  const callerAgent = { id: "agent-A", owner_id: "owner-1" };

  const response = guardedFund(callerAgent, "agent-B", fundAccountSpy);

  assert.equal(response.status, 403);
  assert.equal(fundAccountSpy.calls.length, 0, "fundAccount must not be called for a cross-agent request");
});

test("proof: self /fund request does invoke the ledger fund effect exactly once", () => {
  const fundAccountSpy = makeSpy({ transactionId: "tx_1" });
  const callerAgent = { id: "agent-A", owner_id: "owner-1" };

  const response = guardedFund(callerAgent, "agent-A", fundAccountSpy);

  assert.equal(response.status, 201);
  assert.equal(fundAccountSpy.calls.length, 1);
  assert.deepEqual(fundAccountSpy.calls[0], ["agent-A"]);
});

test("proof: cross-owner /register request never invokes bw_register_agent", () => {
  const rpcSpy = makeSpy({ data: { agent_id: "should-not-happen" }, error: null });
  const canonicalOwner = { id: "owner-1", email: "real@owner.com", name: "Real Owner" };

  const response = guardedRegister(canonicalOwner, "someone-else@owner.com", "Attacker Name", rpcSpy);

  assert.equal(response.status, 403);
  assert.equal(rpcSpy.calls.length, 0, "bw_register_agent must not be called for a cross-owner request");
});

test("proof: missing-owner /register request never invokes bw_register_agent", () => {
  const rpcSpy = makeSpy({ data: { agent_id: "should-not-happen" }, error: null });

  const response = guardedRegister(null, "anything@owner.com", "Attacker Name", rpcSpy);

  assert.equal(response.status, 403);
  assert.equal(rpcSpy.calls.length, 0, "bw_register_agent must not be called when the owner can't be resolved");
});

test("proof: same-owner /register request invokes bw_register_agent with canonical fields only, ignoring a spoofed owner_name", () => {
  const rpcSpy = makeSpy({ data: { agent_id: "agent-new" }, error: null });
  const canonicalOwner = { id: "owner-1", email: "real@owner.com", name: "Real Owner" };

  // Attacker-controlled body: correct (normalized) email, but a spoofed name
  // trying to rewrite the owner record.
  const response = guardedRegister(canonicalOwner, "Real@Owner.com", "Attacker Name", rpcSpy);

  assert.equal(response.status, 201);
  assert.equal(rpcSpy.calls.length, 1);
  assert.deepEqual(rpcSpy.calls[0][0], { p_owner_email: "real@owner.com", p_owner_name: "Real Owner" });
});

// ─── Source-order companions: prove the routes are actually wired to the
// seam above, and that the guard sits strictly before the mutation call
// sites. Regex/text-order checks alone can't prove the *decision logic* is
// correct (that's what the runtime tests above are for) — they can only
// prove the route *shape*, so this section is a companion, not the proof.

test("fund/route.ts imports and calls authorizeFund, gated before any ledger mutation", async () => {
  const source = await read("apps/web/src/app/api/v1/fund/route.ts");

  assert.match(
    source,
    /import\s*\{[^}]*\bauthorizeFund\b[^}]*\}\s*from\s*["']@\/lib\/agent-authorization["']/,
    "fund/route.ts does not import authorizeFund from @/lib/agent-authorization"
  );

  const guardMatch = source.match(/if\s*\(\s*!authorizeFund\([^)]*\)\.allowed\s*\)\s*\{[\s\S]*?status:\s*403[\s\S]*?\}/);
  assert.ok(guardMatch, "fund/route.ts does not gate on `if (!authorizeFund(...).allowed)` with a 403 response");

  const guardIndex = source.indexOf(guardMatch[0]);
  for (const mutationToken of [".from(T.accounts)", "fundAccount(", ".insert("]) {
    const tokenIndex = source.indexOf(mutationToken);
    assert.ok(tokenIndex !== -1, `expected to find ${mutationToken} in fund/route.ts`);
    assert.ok(
      guardIndex < tokenIndex,
      `authorizeFund guard (at ${guardIndex}) must appear before ${mutationToken} (at ${tokenIndex})`
    );
  }
});

test("register/route.ts imports and calls authorizeRegister, gated before the bw_register_agent RPC", async () => {
  const source = await read("apps/web/src/app/api/v1/register/route.ts");

  assert.match(
    source,
    /import\s*\{[^}]*\bauthorizeRegister\b[^}]*\}\s*from\s*["']@\/lib\/agent-authorization["']/,
    "register/route.ts does not import authorizeRegister from @/lib/agent-authorization"
  );

  const guardMatch = source.match(/if\s*\(\s*!authz\.allowed\s*\)\s*\{[\s\S]*?status:\s*403[\s\S]*?\}/);
  assert.ok(guardMatch, "register/route.ts does not gate on the authorizeRegister decision with a 403 response");

  const guardIndex = source.indexOf(guardMatch[0]);
  const rpcIndex = source.indexOf('.rpc("bw_register_agent"');
  assert.ok(rpcIndex !== -1, "expected to find the bw_register_agent RPC call in register/route.ts");
  assert.ok(
    guardIndex < rpcIndex,
    `authorizeRegister guard (at ${guardIndex}) must appear before the bw_register_agent RPC call (at ${rpcIndex})`
  );
});

test("register/route.ts resolves the canonical owner via callerAgent.owner_id, not from the request body", async () => {
  const source = await read("apps/web/src/app/api/v1/register/route.ts");

  assert.match(
    source,
    /\.eq\(\s*"id"\s*,\s*callerAgent\.owner_id\s*\)/,
    "register/route.ts does not resolve the owner row by callerAgent.owner_id"
  );
});

test("register/route.ts passes only the canonical stored owner email/name to bw_register_agent, never body.owner_name", async () => {
  const source = await read("apps/web/src/app/api/v1/register/route.ts");
  const rpcCallMatch = source.match(/client\.rpc\(\s*"bw_register_agent",\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(rpcCallMatch, "could not find the bw_register_agent rpc call block");
  const rpcCallSource = rpcCallMatch[0];

  assert.match(rpcCallSource, /p_owner_email:\s*canonicalOwner\.email/);
  assert.match(rpcCallSource, /p_owner_name:\s*canonicalOwner\.name/);
  assert.doesNotMatch(
    rpcCallSource,
    /body\.owner_name/,
    "register/route.ts must not forward the request body's owner_name to bw_register_agent"
  );
  assert.doesNotMatch(
    rpcCallSource,
    /\bownerEmail\b/,
    "register/route.ts must not forward the raw (unverified) request body owner_email to bw_register_agent"
  );
});
