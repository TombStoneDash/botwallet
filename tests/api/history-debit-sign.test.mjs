import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { compileFunction } from "node:vm";

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

// Execute the real route and ledger mapping, replacing only transport/framework
// dependencies and authentication with an already resolved agent fixture.
async function historyHandler(amountCents) {
  const agent = { id: "agent-fixture", name: "History fixture" };
  const T = { accounts: "bw_accounts", postings: "bw_postings", transactions: "bw_transactions" };
  const transaction = {
    id: "transaction-fixture",
    type: "spend",
    description: "History amount fixture",
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  };
  const client = {
    from(table) {
      assert.ok([T.accounts, T.postings].includes(table));
      return {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        async single() {
          assert.equal(table, T.accounts);
          return { data: { id: "credits-fixture" } };
        },
        async range() {
          assert.equal(table, T.postings);
          return {
            data: [{ amount_cents: amountCents, [T.transactions]: transaction }],
            error: null,
          };
        },
      };
    },
  };
  const { getHistory } = await loadFunctions("../../packages/ledger/src/index.ts", {
    modules: ["@botwallet/db"],
    values: { T },
  }, ["getHistory"]);
  return loadFunctions("../../apps/web/src/app/api/v1/history/route.ts", {
    modules: ["next/server", "@/lib/auth", "@botwallet/db", "@botwallet/ledger"],
    values: {
      NextResponse: { json: Response.json },
      authenticateAgent: async () => agent,
      getClient: () => client,
      T,
      getHistory,
    },
  }, ["GET"]);
}

for (const [amountCents, display] of [
  [-499, "-$4.99"],
  [499, "+$4.99"],
  [-1, "-$0.01"],
  [0, "+$0.00"],
]) {
  test(`history displays ${amountCents} cents as ${display} without changing the numeric amount`, async () => {
    const { GET } = await historyHandler(amountCents);
    const response = await GET(new Request("https://example.invalid/api/v1/history"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.entries.length, 1);
    assert.equal(body.entries[0].amount_cents, amountCents);
    assert.equal(body.entries[0].amount, display);
  });
}
