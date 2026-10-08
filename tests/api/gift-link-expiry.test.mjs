import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { compileFunction } from "node:vm";

// Follow the runtime loader pattern in tests/security/funding-runtime.test.mjs.
// Execute the real handler with only its framework, database, and clock replaced.
async function loadHandler(client) {
  const source = await readFile(new URL(
    "../../apps/web/src/app/api/v1/gift-link/[slug]/route.ts", import.meta.url,
  ), "utf8");
  const js = stripTypeScriptTypes(source).replace(
    /^import .* from "([^"]+)";$/gm,
    (statement, module) => {
      assert.ok(["next/server", "@botwallet/db"].includes(module), `Unexpected dependency: ${statement}`);
      return "";
    },
  ).replace(/^export /gm, "");
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  }
  return compileFunction(`${js}\nreturn GET;`, ["NextResponse", "getClient", "T", "Date"])(
    { json: Response.json }, () => client,
    { gift_links: "bw_gift_links", agents: "bw_agents" }, FixedDate,
  );
}

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const fixture = {
  title: "A gift", message: "Thank you", goal_cents: 5000, raised_cents: 1200,
  active: true, agent_id: "agent-1", expires_at: null,
};

function readOnlyClient(link, error = null) {
  const reads = [];
  const mutations = [];
  const mutate = (...args) => {
    mutations.push(args);
    throw new Error("Unexpected mutation");
  };
  const client = {
    from(table) {
      const read = { table, columns: [], filters: [] };
      reads.push(read);
      return {
        select(columns) { read.columns = columns.split(",").map((column) => column.trim()); return this; },
        eq(column, value) { read.filters.push([column, value]); return this; },
        async single() {
          const record = table === "bw_gift_links" ? link : { name: "Gift Agent" };
          // Apply the real projection so an omitted expires_at cannot pass the test.
          return {
            data: record && Object.fromEntries(read.columns.map((column) => [column, record[column]])),
            error: table === "bw_gift_links" ? error : null,
          };
        },
        insert: mutate, update: mutate, delete: mutate, upsert: mutate,
      };
    },
    rpc: mutate,
  };
  return { client, reads, mutations };
}

for (const [label, link, status, error = null] of [
  ["past expiry", { ...fixture, expires_at: "2000-01-01T00:00:00.000Z" }, 404],
  ["exact-now expiry", { ...fixture, expires_at: new Date(NOW).toISOString() }, 404],
  ["future expiry", { ...fixture, expires_at: new Date(NOW + 1).toISOString() }, 200],
  ["null expiry", { ...fixture }, 200],
  ["inactive record", { ...fixture, active: false }, 404],
  ["missing record", null, 404],
  ["query error", { ...fixture }, 404, { message: "Lookup failed" }],
]) {
  test(`gift link display: ${label}`, async () => {
    const original = structuredClone(link);
    const { client, reads, mutations } = readOnlyClient(link, error);
    const GET = await loadHandler(client);
    const response = await GET(new Request("https://example.invalid/api/v1/gift-link/gift-slug"), {
      params: Promise.resolve({ slug: "gift-slug" }),
    });

    assert.equal(response.status, status);
    assert.deepEqual(mutations, [], "display must never write");
    assert.deepEqual(link, original, "stored record must remain unchanged");
    assert.equal(reads[0].table, "bw_gift_links");
    assert.ok(reads[0].columns.includes("expires_at"));
    assert.deepEqual(reads[0].filters, [["slug", "gift-slug"]]);
    if (status === 404) {
      assert.equal(reads.length, 1, "unavailable links must skip the agent query");
      assert.deepEqual(await response.json(), {
        error: true, code: "NOT_FOUND", message: "Gift link not found or inactive",
      });
    } else {
      assert.equal(reads.length, 2);
      assert.deepEqual(reads[1], {
        table: "bw_agents", columns: ["name"], filters: [["id", "agent-1"]],
      });
      assert.deepEqual(await response.json(), {
        title: fixture.title, agent_name: "Gift Agent", message: fixture.message,
        goal_cents: fixture.goal_cents, raised_cents: fixture.raised_cents, active: true,
      });
    }
  });
}
