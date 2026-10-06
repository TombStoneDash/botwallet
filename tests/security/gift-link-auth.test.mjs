import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { authorizeGiftLink } from "../../apps/web/src/lib/gift-link-authorization.ts";

// Source-contract + pure-decision-seam tests (same style as
// tests/security/rpc-lockdown.test.mjs and the fund/register auth tests
// added alongside PR #7): read the actual route source and assert on it
// textually, and exercise the extracted authorization decision directly at
// runtime with zero network/DB access.
//
// POST /api/v1/gift-link had NO auth check at all on main — anyone could
// mint a shareable funding link for ANY agent_id. This was flagged (and
// explicitly left out of scope) in the body of draft PR #7 ("security:
// require bearer auth on /api/v1/fund and /api/v1/register (X7)"), which
// names the same OPUS X7 finding class: unauthenticated money-surface
// routes. This file proves the follow-up fix: POST /api/v1/gift-link now
// fails closed via apps/web/src/lib/auth.ts#authenticateAgent (the exact
// pattern already protecting /spend, /balance, /history, /policy), *and*
// binds the created link's agent_id to the authenticated caller so bearer
// auth alone can't be used to create a link for someone else's wallet.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => readFile(path.join(ROOT, relativePath), "utf8");

const UNAUTHORIZED_RESPONSE =
  '{ error: true, code: "UNAUTHORIZED", message: "Invalid or missing API key" }';

const GIFT_LINK_ROUTE = "apps/web/src/app/api/v1/gift-link/route.ts";

// Routes already correct on main before this fix — the reference pattern
// gift-link is proven to match, not just "have some auth".
const REFERENCE_AUTHED_ROUTES = [
  "apps/web/src/app/api/v1/balance/route.ts",
  "apps/web/src/app/api/v1/history/route.ts",
  "apps/web/src/app/api/v1/policy/route.ts",
  "apps/web/src/app/api/v1/spend/route.ts",
];

test("reference routes (already correct) all use the same authenticateAgent + 401 UNAUTHORIZED pattern", async () => {
  for (const relativePath of REFERENCE_AUTHED_ROUTES) {
    const source = await read(relativePath);
    assert.match(
      source,
      /import\s*\{[^}]*\bauthenticateAgent\b[^}]*\}\s*from\s*["']@\/lib\/auth["']/,
      `${relativePath} does not import authenticateAgent from @/lib/auth`
    );
    assert.match(
      source,
      /await authenticateAgent\(request\)/,
      `${relativePath} does not call authenticateAgent(request)`
    );
    assert.ok(
      source.includes(UNAUTHORIZED_RESPONSE),
      `${relativePath} does not return the standard UNAUTHORIZED body`
    );
  }
});

test("gift-link imports authenticateAgent from the shared auth lib", async () => {
  const source = await read(GIFT_LINK_ROUTE);
  assert.match(
    source,
    /import\s*\{[^}]*\bauthenticateAgent\b[^}]*\}\s*from\s*["']@\/lib\/auth["']/,
    `${GIFT_LINK_ROUTE} does not import authenticateAgent from @/lib/auth`
  );
});

test("gift-link POST handler fails closed with the standard 401 UNAUTHORIZED body", async () => {
  const source = await read(GIFT_LINK_ROUTE);
  const postIndex = source.indexOf("export async function POST");
  assert.ok(postIndex !== -1, `${GIFT_LINK_ROUTE} has no exported POST handler`);
  const postSource = source.slice(postIndex);

  assert.match(
    postSource,
    /await authenticateAgent\(request\)/,
    `${GIFT_LINK_ROUTE} POST handler does not call authenticateAgent(request)`
  );
  assert.ok(
    postSource.includes(UNAUTHORIZED_RESPONSE),
    `${GIFT_LINK_ROUTE} POST handler does not return the standard UNAUTHORIZED body`
  );
  assert.match(
    postSource,
    /\{\s*status:\s*401\s*\}/,
    `${GIFT_LINK_ROUTE} POST handler does not respond with HTTP 401`
  );
});

test("gift-link checks auth before doing any body parsing or database work (fail closed, not fail late)", async () => {
  const source = await read(GIFT_LINK_ROUTE);
  const postIndex = source.indexOf("export async function POST");
  const postSource = source.slice(postIndex);

  const authCallIndex = postSource.indexOf("await authenticateAgent(request)");
  assert.ok(authCallIndex !== -1, `${GIFT_LINK_ROUTE} POST handler never calls authenticateAgent`);

  // Anything that touches the body, the ledger, or the DB must come after
  // the auth check — never before it.
  const laterOperations = ["request.json()", "getClient()", ".schema(", ".insert("];

  for (const op of laterOperations) {
    const opIndex = postSource.indexOf(op);
    if (opIndex === -1) continue; // not every op appears in every file
    assert.ok(
      authCallIndex < opIndex,
      `${GIFT_LINK_ROUTE}: "${op}" appears before the authenticateAgent(request) check (found at ${opIndex} vs ${authCallIndex}) — auth must run first so the endpoint fails closed`
    );
  }
});

test("gift-link's GET handler (discovery/schema metadata only, no state change) is unchanged and stays public, matching the /register GET precedent from PR #7", async () => {
  const source = await read(GIFT_LINK_ROUTE);
  const getIndex = source.indexOf("export async function GET");
  const postIndex = source.indexOf("export async function POST");
  assert.ok(getIndex !== -1 && postIndex !== -1 && getIndex < postIndex);

  const getSource = source.slice(getIndex, postIndex);
  assert.doesNotMatch(
    getSource,
    /authenticateAgent/,
    "GET should remain the public schema/doc response (see /api/v1/spend's and /api/v1/register's GET for the existing precedent) — only POST mints state"
  );
});

test("gift-link/route.ts imports and calls authorizeGiftLink, gated before the gift_links insert", async () => {
  const source = await read(GIFT_LINK_ROUTE);

  assert.match(
    source,
    /import\s*\{[^}]*\bauthorizeGiftLink\b[^}]*\}\s*from\s*["']@\/lib\/gift-link-authorization["']/,
    "gift-link/route.ts does not import authorizeGiftLink from @/lib/gift-link-authorization"
  );

  const guardMatch = source.match(
    /if\s*\(\s*!authorizeGiftLink\([^)]*\)\.allowed\s*\)\s*\{[\s\S]*?status:\s*403[\s\S]*?\}/
  );
  assert.ok(
    guardMatch,
    "gift-link/route.ts does not gate on `if (!authorizeGiftLink(...).allowed)` with a 403 response"
  );

  const guardIndex = source.indexOf(guardMatch[0]);
  const insertIndex = source.indexOf(".insert(");
  assert.ok(insertIndex !== -1, "expected to find .insert( in gift-link/route.ts");
  assert.ok(
    guardIndex < insertIndex,
    `authorizeGiftLink guard (at ${guardIndex}) must appear before .insert( (at ${insertIndex})`
  );
});

test("gift-link/route.ts responds 403 with the repo's standard error shape on ownership mismatch", async () => {
  const source = await read(GIFT_LINK_ROUTE);
  assert.match(source, /code:\s*"FORBIDDEN"/);
  assert.match(source, /error:\s*true/);
});

// ─── authorizeGiftLink: self/cross-agent binding (pure, no I/O) ───────────

test("authorizeGiftLink allows an agent to create a gift link for exactly itself", () => {
  const callerAgent = { id: "agent-A" };
  assert.equal(authorizeGiftLink(callerAgent, "agent-A").allowed, true);
});

test("authorizeGiftLink denies a gift link requested for a different agent_id (the unauthenticated-gift-link exploit shape)", () => {
  const callerAgent = { id: "agent-A" };
  assert.equal(authorizeGiftLink(callerAgent, "agent-B").allowed, false);
});

test("authorizeGiftLink denies missing, empty, or non-string agent_id", () => {
  const callerAgent = { id: "agent-A" };
  for (const requested of [undefined, null, "", 42, {}, ["agent-A"]]) {
    assert.equal(
      authorizeGiftLink(callerAgent, requested).allowed,
      false,
      `expected denial for requested agent_id ${JSON.stringify(requested)}`
    );
  }
});

test("authorizeGiftLink is case-sensitive and does not treat prefix/substring ids as a match", () => {
  const callerAgent = { id: "agent-A" };
  assert.equal(authorizeGiftLink(callerAgent, "agent-A ").allowed, false);
  assert.equal(authorizeGiftLink(callerAgent, "AGENT-A").allowed, false);
  assert.equal(authorizeGiftLink(callerAgent, "agent-A-extra").allowed, false);
});

// ─── Runtime proof: a denied decision never reaches the guarded mutation,
// and an allowed (happy path) decision reaches it exactly once ───────────
//
// Mirrors gift-link/route.ts's control flow: authorize, then (only if
// allowed) insert. A spy effect stands in for the gift_links insert — no
// network or database is touched.

function makeSpy(returnValue) {
  const spy = (...args) => {
    spy.calls.push(args);
    return returnValue;
  };
  spy.calls = [];
  return spy;
}

function guardedGiftLink(callerAgent, requestedAgentId, effect) {
  const decision = authorizeGiftLink(callerAgent, requestedAgentId);
  if (!decision.allowed) return { status: 403 };
  effect(requestedAgentId);
  return { status: 201 };
}

test("proof: cross-agent gift-link request never invokes the gift_links insert effect", () => {
  const insertSpy = makeSpy({ id: "should-not-happen" });
  const callerAgent = { id: "agent-A" };

  const response = guardedGiftLink(callerAgent, "agent-B", insertSpy);

  assert.equal(response.status, 403);
  assert.equal(insertSpy.calls.length, 0, "gift_links insert must not be called for a cross-agent request");
});

test("proof: self gift-link request (happy path) does invoke the insert effect exactly once", () => {
  const insertSpy = makeSpy({ id: "gift-link-1" });
  const callerAgent = { id: "agent-A" };

  const response = guardedGiftLink(callerAgent, "agent-A", insertSpy);

  assert.equal(response.status, 201);
  assert.equal(insertSpy.calls.length, 1);
  assert.deepEqual(insertSpy.calls[0], ["agent-A"]);
});

test("this file's routes are covered by the existing rpc-security CI workflow path filters (no workflow changes needed)", async () => {
  const workflow = await read(".github/workflows/rpc-security.yml");
  assert.match(workflow, /apps\/web\/src\/app\/api\/v1\/\*\*/);
  assert.match(workflow, /tests\/security\/\*\*/);
  assert.match(workflow, /pnpm test:security/);
});
