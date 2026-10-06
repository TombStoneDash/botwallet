import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  authorizeRegister,
  normalizeEmail,
} from "../../apps/web/src/lib/agent-authorization.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => readFile(path.join(ROOT, relativePath), "utf8");

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

// Exercise the registration decision with a spy mutation. The funding
// handler itself is executed in funding-runtime.test.mjs.

function makeSpy(returnValue) {
  const spy = (...args) => {
    spy.calls.push(args);
    return returnValue;
  };
  spy.calls = [];
  return spy;
}

// Models registration: authorize, then (only if allowed) act.
function guardedRegister(canonicalOwner, suppliedOwnerEmail, suppliedOwnerName, effect) {
  const decision = authorizeRegister(canonicalOwner, suppliedOwnerEmail);
  if (!decision.allowed) return { status: 403 };
  effect({ p_owner_email: canonicalOwner.email, p_owner_name: canonicalOwner.name });
  return { status: 201 };
}

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

// The obsolete self-funding authorization helper is intentionally removed.
test("fund/route.ts no longer imports or calls authorizeFund (superseded by the model-A fail-closed response)", async () => {
  const source = await read("apps/web/src/app/api/v1/fund/route.ts");
  // Match actual usage (an import or a call), not the identifier appearing
  // anywhere in the file — the route's explanatory comment legitimately
  // names the superseded function when describing why it was removed.
  assert.doesNotMatch(
    source,
    /import\s*\{[^}]*\bauthorizeFund\b[^}]*\}\s*from\s*["']@\/lib\/agent-authorization["']/,
    "fund/route.ts must not import authorizeFund — funding is fail-closed before any target-binding decision, see fund-register-auth.test.mjs"
  );
  assert.doesNotMatch(
    source,
    /authorizeFund\s*\(/,
    "fund/route.ts must not call authorizeFund(...) — funding is fail-closed before any target-binding decision, see fund-register-auth.test.mjs"
  );
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
