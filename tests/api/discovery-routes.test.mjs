import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { compileFunction } from "node:vm";

const appRoot = new URL("../../apps/web/src/app/", import.meta.url);

// Execute the real discovery handler using the security suite's TypeScript
// stripping approach. Only NextResponse.json is stubbed; no server is started.
async function discovery() {
  const source = await readFile(new URL("api/v1/route.ts", appRoot), "utf8");
  const js = stripTypeScriptTypes(source)
    .replace(/^import .* from "([^"]+)";$/gm, (statement, module) => {
      assert.equal(module, "next/server", `Unexpected dependency: ${statement}`);
      return "";
    })
    .replace(/^export /gm, "");
  const { GET } = compileFunction(`${js}\nreturn { GET };`, ["NextResponse"])(
    { json: Response.json },
  );
  const response = await GET();
  assert.equal(response.status, 200);
  return response.json();
}

test("discovery does not advertise unavailable freeze, unfreeze, or audit operations", async () => {
  const { endpoints } = await discovery();
  const operations = Object.keys(endpoints).map((entry) => entry.trim().replace(/\s+/g, " "));
  for (const operation of ["POST /api/v1/freeze", "POST /api/v1/unfreeze", "GET /api/v1/audit"]) {
    assert.ok(!operations.includes(operation), `${operation} must not be advertised`);
  }
});

test("discovery preserves existing operations, descriptions, version, and response structure", async () => {
  const document = await discovery();
  assert.equal(document.version, "0.1.0");
  assert.deepEqual(Object.keys(document).sort(), [
    "auth", "base_url", "description", "endpoints", "links", "name", "part_of", "tagline", "version",
  ]);
  assert.deepEqual(document.auth, {
    agent: "Bearer bw_... (API key from /register)",
    human: "Session-based (coming) or system token",
  });
  assert.deepEqual(document.endpoints, {
    "GET  /api/v1": "This document",
    "POST /api/v1/register": "Register an additional agent for your own account, get API key + wallet (agent auth — requires an existing bw_... key; owner is bound to the bearer credential, not to the request body)",
    "GET  /api/v1/balance": "Check agent wallet balance (agent auth)",
    "POST /api/v1/spend": "Request a spend (agent auth, policy checked)",
    "GET  /api/v1/history": "Transaction history (agent auth)",
    "GET  /api/v1/policy": "View active policies (agent auth)",
    "POST /api/v1/fund": "Returns 403 FUNDING_UNAVAILABLE — no funding-authority principal is implemented.",
    "POST /api/v1/gift-link": "Create a link record for your own agent (agent auth); checkout and wallet credit are not implemented yet",
  });
});

test("every advertised method and path has a route file exporting that method", async () => {
  const { endpoints } = await discovery();
  for (const operation of Object.keys(endpoints)) {
    const match = operation.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/api\/v1(?:\/[\w-]+)*)$/);
    assert.ok(match, `Invalid discovery operation: ${operation}`);
    const [, method, pathname] = match;
    const source = await readFile(new URL(`${pathname.slice(1)}/route.ts`, appRoot), "utf8");
    assert.match(
      source,
      new RegExp(`^export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`, "m"),
      `${operation} must resolve to an exported ${method} handler`,
    );
  }
});
