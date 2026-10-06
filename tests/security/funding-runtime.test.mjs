import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { compileFunction } from "node:vm";
import { createHash } from "node:crypto";

// Execute the actual route and auth code. Only framework response creation and
// the database transport are replaced; authorization is not reimplemented.
async function loadFunctions(file, dependencies, exports) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const js = stripTypeScriptTypes(source).replace(
    /^import .* from "([^"]+)";$/gm,
    (statement, module) => {
      assert.ok(dependencies.modules.includes(module), `Unexpected dependency: ${statement}`);
      return "";
    },
  ).replace(/^export /gm, "");
  return compileFunction(`${js}\nreturn { ${exports.join(", ")} };`, Object.keys(dependencies.values))(
    ...Object.values(dependencies.values),
  );
}

async function fundingHandler({ agent = null, error = null, lookupThrows = false } = {}) {
  const reads = [];
  const mutations = [];
  const mutate = (...args) => { mutations.push(args); throw new Error("Unexpected mutation"); };
  const query = {
    select() { return this; },
    eq(column, value) { reads.push([column, value]); return this; },
    limit() { return this; },
    async single() {
      if (lookupThrows) throw new Error("Identity service unavailable");
      return { data: agent, error };
    },
    insert: mutate, update: mutate, delete: mutate, upsert: mutate,
  };
  const client = {
    from(table) { assert.equal(table, "bw_agents"); return query; },
    rpc: mutate,
  };
  const { authenticateAgent } = await loadFunctions("../../apps/web/src/lib/auth.ts", {
    modules: ["crypto", "@botwallet/db"],
    values: { createHash, getClient: () => client, T: { agents: "bw_agents" } },
  }, ["authenticateAgent"]);
  const { POST } = await loadFunctions("../../apps/web/src/app/api/v1/fund/route.ts", {
    modules: ["next/server", "@/lib/auth"],
    values: { NextResponse: { json: Response.json }, authenticateAgent },
  }, ["POST"]);
  return { POST, reads, mutations };
}

for (const [label, header, agent, error] of [
  ["missing key", null, null, null],
  ["wrong key format", "Bearer invalid", null, null],
  ["unknown key", "Bearer bw_unknown", null, null],
  ["frozen agent", "Bearer bw_frozen", { id: "A", frozen: true }, null],
  ["identity lookup error", "Bearer bw_error", { id: "A", frozen: false }, { message: "unavailable" }],
]) {
  test(`fund rejects ${label} with 401 without reading a body or mutating`, async () => {
    const { POST, mutations } = await fundingHandler({ agent, error });
    const response = await POST({
      headers: new Headers(header ? { authorization: header } : {}),
      json() { assert.fail("Must not parse body"); },
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "UNAUTHORIZED");
    assert.deepEqual(mutations, []);
  });
}

for (const body of [
  { agent_id: "A", amount: 1000000, stripe_payment_id: "forged", idempotency_key: "replay" },
  { agent_id: "B", amount: 20 },
  {}, null, "{malformed", "x".repeat(1000000),
]) {
  test(`fund denies authenticated payload (${typeof body}, ${JSON.stringify(body).length} bytes)`, async () => {
    const { POST, reads, mutations } = await fundingHandler({ agent: { id: "A", owner_id: "owner", frozen: false } });
    const request = new Request("https://example.invalid/api/v1/fund", {
      method: "POST",
      headers: { authorization: "Bearer bw_valid" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    // Repeat the request: neither a claimed payment nor replay can create credit.
    for (let i = 0; i < 2; i++) {
      const response = await POST(request);
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "FUNDING_UNAVAILABLE");
      assert.equal(request.bodyUsed, false);
    }
    assert.equal(reads.length, 2);
    assert.deepEqual(reads[0], ["api_key_hash", createHash("sha256").update("bw_valid").digest("hex")]);
    assert.deepEqual(mutations, []);
  });
}

test("identity transport failure cannot fall through to funding", async () => {
  const { POST, mutations } = await fundingHandler({ lookupThrows: true });
  await assert.rejects(POST(new Request("https://example.invalid", {
    headers: { authorization: "Bearer bw_valid" },
  })), /Identity service unavailable/);
  assert.deepEqual(mutations, []);
});
