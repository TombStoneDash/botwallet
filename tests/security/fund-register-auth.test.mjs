import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Source-contract tests (same style as rpc-lockdown.test.mjs and
// service-table-grants.test.mjs): read the actual route source and assert
// on it textually. No live DB/server is spun up here — the other tests in
// this suite already prove the SQL-side RPC lockdown; this file proves the
// HTTP-side companion fix from remediation 0.2b (OPUS security review,
// finding X7): /api/v1/fund and /api/v1/register must fail closed the same
// way /api/v1/spend, /api/v1/balance, /api/v1/history, and /api/v1/policy
// already do, via apps/web/src/lib/auth.ts#authenticateAgent.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => readFile(path.join(ROOT, relativePath), "utf8");

const UNAUTHORIZED_RESPONSE =
  '{ error: true, code: "UNAUTHORIZED", message: "Invalid or missing API key" }';

// Routes that were already correct before this fix — used as the reference
// pattern so the new routes are proven to match, not just "have some auth".
const REFERENCE_AUTHED_ROUTES = [
  "apps/web/src/app/api/v1/balance/route.ts",
  "apps/web/src/app/api/v1/history/route.ts",
  "apps/web/src/app/api/v1/policy/route.ts",
  "apps/web/src/app/api/v1/spend/route.ts",
];

// The two routes named in doc 05 (05_REMEDIATION_SEQUENCE.md) §0.2(b) and
// doc 04 (04_SECURITY_INCIDENTS_AND_RED_TEAM.md) finding X7 as the
// unauthenticated money-ledger HTTP surface.
const FIXED_ROUTES = [
  { file: "apps/web/src/app/api/v1/fund/route.ts", handler: "POST" },
  { file: "apps/web/src/app/api/v1/register/route.ts", handler: "POST" },
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

test("fund and register import authenticateAgent from the shared auth lib", async () => {
  for (const { file } of FIXED_ROUTES) {
    const source = await read(file);
    assert.match(
      source,
      /import\s*\{[^}]*\bauthenticateAgent\b[^}]*\}\s*from\s*["']@\/lib\/auth["']/,
      `${file} does not import authenticateAgent from @/lib/auth`
    );
  }
});

test("fund and register POST handlers fail closed with the standard 401 UNAUTHORIZED body", async () => {
  for (const { file } of FIXED_ROUTES) {
    const source = await read(file);
    const postIndex = source.indexOf("export async function POST");
    assert.ok(postIndex !== -1, `${file} has no exported POST handler`);
    const postSource = source.slice(postIndex);

    assert.match(
      postSource,
      /await authenticateAgent\(request\)/,
      `${file} POST handler does not call authenticateAgent(request)`
    );
    assert.ok(
      postSource.includes(UNAUTHORIZED_RESPONSE),
      `${file} POST handler does not return the standard UNAUTHORIZED body`
    );
    assert.match(
      postSource,
      /\{\s*status:\s*401\s*\}/,
      `${file} POST handler does not respond with HTTP 401`
    );
  }
});

test("fund and register check auth before doing any body parsing or database work (fail closed, not fail late)", async () => {
  for (const { file } of FIXED_ROUTES) {
    const source = await read(file);
    const postIndex = source.indexOf("export async function POST");
    const postSource = source.slice(postIndex);

    const authCallIndex = postSource.indexOf("await authenticateAgent(request)");
    assert.ok(authCallIndex !== -1, `${file} POST handler never calls authenticateAgent`);

    // Anything that touches the body, the ledger, or the DB must come after
    // the auth check — never before it.
    const laterOperations = [
      "request.json()",
      "getClient()",
      ".rpc(",
      "fundAccount(",
      ".insert(",
    ];

    for (const op of laterOperations) {
      const opIndex = postSource.indexOf(op);
      if (opIndex === -1) continue; // not every op appears in every file
      assert.ok(
        authCallIndex < opIndex,
        `${file}: "${op}" appears before the authenticateAgent(request) check (found at ${opIndex} vs ${authCallIndex}) — auth must run first so the endpoint fails closed`
      );
    }
  }
});

test("register's GET handler (self-documentation only, no state change) is unchanged and stays public, matching the /spend precedent", async () => {
  const source = await read("apps/web/src/app/api/v1/register/route.ts");
  const getIndex = source.indexOf("export async function GET");
  const postIndex = source.indexOf("export async function POST");
  assert.ok(getIndex !== -1 && postIndex !== -1 && getIndex < postIndex);

  const getSource = source.slice(getIndex, postIndex);
  assert.doesNotMatch(
    getSource,
    /authenticateAgent/,
    "GET should remain the public schema/doc response (see /api/v1/spend's GET for the existing precedent) — only POST mints state"
  );
});

test("this file's routes are covered by the existing rpc-security CI workflow path filters", async () => {
  const workflow = await read(".github/workflows/rpc-security.yml");
  assert.match(workflow, /apps\/web\/src\/app\/api\/v1\/\*\*/);
  assert.match(workflow, /tests\/security\/\*\*/);
  assert.match(workflow, /pnpm test:security/);
});
