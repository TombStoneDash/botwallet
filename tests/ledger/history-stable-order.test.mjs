import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { compileFunction } from "node:vm";

const T = { postings: "bw_postings", transactions: "bw_transactions" };
const source = await readFile(new URL("../../packages/ledger/src/index.ts", import.meta.url), "utf8");
const js = stripTypeScriptTypes(source)
  .replace(/^import .* from "([^"]+)";$/gm, (statement, module) => {
    assert.equal(module, "@botwallet/db", `Unexpected dependency: ${statement}`);
    return "";
  })
  .replace(/^export /gm, "");
const getHistory = compileFunction(`${js}\nreturn getHistory;`, ["T"])(T);

function posting(number, createdAt, accountId = "account-a") {
  return {
    id: `00000000-0000-0000-0000-${String(number).padStart(12, "0")}`,
    account_id: accountId,
    created_at: createdAt,
    amount_cents: number * 100,
    [T.transactions]: {
      id: `transaction-${100 - number}`,
      type: "fund",
      description: number % 2 ? null : `Fixture ${number}`,
      metadata: { fixture: number },
      created_at: "2026-01-01T00:00:00.000Z",
    },
  };
}

// Only database transport is replaced. Incoming ties vary on every call;
// requested filters and ordering are evaluated before the inclusive range.
function queryStub(fixtures, { error = null, nullData = false } = {}) {
  const calls = [];
  const mutate = () => assert.fail("Unexpected database mutation");
  const client = {
    rpc: mutate,
    from(table) {
      assert.equal(table, T.postings);
      const shift = calls.length % Math.max(fixtures.length, 1);
      let incoming = [...fixtures.slice(shift), ...fixtures.slice(0, shift)];
      if (calls.length % 2) incoming.reverse();
      const call = { incoming: incoming.map((row) => row.id), filters: [], orders: [] };
      calls.push(call);
      return {
        insert: mutate, update: mutate, delete: mutate, upsert: mutate,
        select(selection) { call.selection = selection.replace(/\s+/g, " ").trim(); return this; },
        eq(column, value) { call.filters.push([column, value]); return this; },
        order(column, options) { call.orders.push([column, options]); return this; },
        async range(start, end) {
          call.range = [start, end];
          const rows = incoming.filter((row) => call.filters.every(([column, value]) => row[column] === value));
          rows.sort((a, b) => {
            for (const [column, { ascending }] of call.orders) {
              const comparison = a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0;
              if (comparison) return ascending ? comparison : -comparison;
            }
            return 0;
          });
          return { data: nullData ? null : rows.slice(start, end + 1), error };
        },
      };
    },
  };
  return { client, calls };
}

const tied = [1, 2, 3, 4, 5].map((number) => posting(number, "2026-02-02T00:00:00.000Z"));
const transactionIds = (entries) => entries.map((entry) => entry.id);

test("repeated and adjacent pages stay stable across permuted timestamp ties", async () => {
  const { client, calls } = queryStub(tied);
  const expected = [...tied].reverse().map((row) => row[T.transactions].id);
  for (const limit of [1, 2, 3]) {
    for (let repeat = 0; repeat < 3; repeat++) {
      const collected = [];
      for (let offset = 0; offset < tied.length; offset += limit) {
        const page = await getHistory(client, "account-a", { limit, offset });
        assert.deepEqual(transactionIds(page), expected.slice(offset, offset + limit));
        assert.deepEqual(await getHistory(client, "account-a", { limit, offset }), page);
        collected.push(...transactionIds(page));
      }
      assert.deepEqual(collected, expected);
      assert.equal(new Set(collected).size, tied.length);
    }
  }
  assert.ok(new Set(calls.map((call) => call.incoming.join(","))).size > 1);
  for (const call of calls) {
    assert.deepEqual(call.orders, [["created_at", { ascending: false }], ["id", { ascending: false }]]);
  }
});

test("mixed timestamps stay newest-first and accounts are filtered before pagination", async () => {
  const newest = posting(0, "2026-03-01T00:00:00.000Z");
  const oldest = posting(99, "2026-01-01T00:00:00.000Z");
  const foreign = posting(50, "2026-04-01T00:00:00.000Z", "account-b");
  const { client, calls } = queryStub([oldest, ...tied, foreign, newest]);
  const expected = [newest, ...[...tied].reverse(), oldest];
  for (let repeat = 0; repeat < 3; repeat++) {
    const pages = [];
    for (let offset = 0; offset < expected.length; offset += 2) {
      pages.push(...await getHistory(client, "account-a", { limit: 2, offset }));
      assert.deepEqual(calls.at(-1).range, [offset, offset + 1]);
    }
    assert.deepEqual(transactionIds(pages), expected.map((row) => row[T.transactions].id));
  }
  const all = await getHistory(client, "account-a");
  assert.deepEqual(calls.at(-1).range, [0, 19]);
  assert.deepEqual(all, expected.map((row) => ({
    id: row[T.transactions].id,
    type: row[T.transactions].type,
    amountCents: row.amount_cents,
    description: row[T.transactions].description,
    metadata: row[T.transactions].metadata,
    createdAt: row[T.transactions].created_at,
  })));
  for (const call of calls) {
    assert.deepEqual(call.filters, [["account_id", "account-a"]]);
    assert.equal(call.selection, "amount_cents, created_at, bw_transactions:transaction_id ( id, type, description, metadata, created_at )");
  }
  assert.deepEqual(transactionIds(await getHistory(client, "account-b")), [foreign[T.transactions].id]);
  assert.deepEqual(await getHistory(client, "missing-account"), []);
  assert.deepEqual(await getHistory(client, "account-a", { offset: expected.length, limit: 2 }), []);
});

test("history preserves database error handling and null-data fallback", async () => {
  const { client } = queryStub(tied, { error: { message: "query failed" } });
  await assert.rejects(getHistory(client, "account-a"), { message: "History error: query failed" });
  assert.deepEqual(await getHistory(queryStub([], { nullData: true }).client, "account-a"), []);
});
