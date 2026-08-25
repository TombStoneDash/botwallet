import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Source-contract tests (same style as tests/security/rpc-lockdown.test.mjs
// and tests/security/service-table-grants.test.mjs): read the actual SQL
// and route source and assert on it textually. No live database — proves
// the persistence *contract* (table names / schema the client targets)
// matches what sql/001_schema.sql actually creates.
//
// Bug: sql/001_schema.sql creates `bw_gift_links` in the default (public)
// schema (commit e987dfb: "Tables use bw_ prefix in public schema for
// Supabase compatibility"). packages/db/src/index.ts's `T` map already
// encodes that: T.gift_links === "bw_gift_links". Every other route
// touched by that same commit (fund, history, balance, policy, register)
// queries via `client.from(T.<name>)` with no `.schema()` call and works.
// Only the two gift-link routes deviated: they called
// `client.schema("botwallet").from("gift_links")` — a schema that is never
// created anywhere in sql/, and a bare table name that doesn't exist
// either way. Every gift-link persistence call was therefore guaranteed to
// fail (relation/schema not found) from the moment that commit landed.
//
// This fix makes the two gift-link routes match the reference pattern
// every other route already uses. It intentionally does NOT touch the
// separate, pre-existing creator_id identity gap (bw_gift_links.creator_id
// references bw_users(id), but the route still assigns the caller's
// bw_agents(id) to it) — that requires a product decision about how an
// agent's owning human is resolved, which is out of scope here and is
// called out as a standalone blocker in the code.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => readFile(path.join(ROOT, relativePath), "utf8");

const GIFT_LINK_POST_ROUTE = "apps/web/src/app/api/v1/gift-link/route.ts";
const GIFT_LINK_SLUG_ROUTE = "apps/web/src/app/api/v1/gift-link/[slug]/route.ts";
const DB_INDEX = "packages/db/src/index.ts";
const SCHEMA_SQL = "sql/001_schema.sql";

// Reference routes from the same 2026-02-22 Supabase pivot commit that were
// wired up correctly from day one — proves gift-link now matches, not just
// "uses some table name".
const REFERENCE_ROUTES_USING_T_MAP = [
  "apps/web/src/app/api/v1/fund/route.ts",
  "apps/web/src/app/api/v1/history/route.ts",
  "apps/web/src/lib/auth.ts",
];

test("sql/001_schema.sql defines bw_gift_links (bw_-prefixed, public schema), not a bare gift_links table", async () => {
  const sql = await read(SCHEMA_SQL);
  assert.match(
    sql,
    /CREATE TABLE IF NOT EXISTS bw_gift_links\s*\(/,
    "expected sql/001_schema.sql to create bw_gift_links"
  );
  assert.doesNotMatch(
    sql,
    /CREATE (TABLE|SCHEMA)[^\n]*\bgift_links\b/i,
    "sql/001_schema.sql must not define a bare (unprefixed) gift_links table or schema"
  );
  assert.doesNotMatch(
    sql,
    /CREATE SCHEMA[^\n]*\bbotwallet\b/i,
    "sql/001_schema.sql must not define a 'botwallet' schema — tables live in the public schema"
  );
});

test("packages/db/src/index.ts's T map resolves gift_links and agents to their real bw_-prefixed tables", async () => {
  const source = await read(DB_INDEX);
  assert.match(source, /gift_links:\s*"bw_gift_links"/);
  assert.match(source, /agents:\s*"bw_agents"/);
});

for (const routePath of [GIFT_LINK_POST_ROUTE, GIFT_LINK_SLUG_ROUTE]) {
  test(`${routePath} imports the T table-name map from @botwallet/db`, async () => {
    const source = await read(routePath);
    assert.match(
      source,
      /import\s*\{[^}]*\bT\b[^}]*\}\s*from\s*["']@botwallet\/db["']/,
      `${routePath} does not import T from @botwallet/db`
    );
  });

  test(`${routePath} does not call .schema("botwallet") — that schema is never created`, async () => {
    const source = await read(routePath);
    assert.doesNotMatch(
      source,
      /\.schema\(\s*["']botwallet["']\s*\)/,
      `${routePath} still calls .schema("botwallet")`
    );
  });

  test(`${routePath} never references the bare table names as string literals in a .from() call`, async () => {
    const source = await read(routePath);
    assert.doesNotMatch(
      source,
      /\.from\(\s*["']gift_links["']\s*\)/,
      `${routePath} still calls .from("gift_links") instead of .from(T.gift_links)`
    );
    assert.doesNotMatch(
      source,
      /\.from\(\s*["']agents["']\s*\)/,
      `${routePath} still calls .from("agents") instead of .from(T.agents)`
    );
  });
}

test("gift-link/route.ts persists gift links to T.gift_links", async () => {
  const source = await read(GIFT_LINK_POST_ROUTE);
  assert.match(
    source,
    /\.from\(T\.gift_links\)/,
    "expected the POST handler to insert via .from(T.gift_links)"
  );
});

test("gift-link/[slug]/route.ts reads the link via T.gift_links and the agent name via T.agents", async () => {
  const source = await read(GIFT_LINK_SLUG_ROUTE);
  assert.match(source, /\.from\(T\.gift_links\)/);
  assert.match(source, /\.from\(T\.agents\)/);
});

for (const referencePath of REFERENCE_ROUTES_USING_T_MAP) {
  test(`gift-link routes now match the working .from(T.*) pattern already used by ${referencePath}`, async () => {
    const reference = await read(referencePath);
    assert.match(
      reference,
      /\.from\(T\.\w+\)/,
      `sanity check: ${referencePath} itself uses .from(T.<name>)`
    );
    assert.doesNotMatch(
      reference,
      /\.schema\(\s*["']botwallet["']\s*\)/,
      `sanity check: ${referencePath} itself never called .schema("botwallet")`
    );
  });
}

test("creator_id identity gap is left untouched and explicitly flagged as a separate blocker, not silently resolved", async () => {
  const source = await read(GIFT_LINK_POST_ROUTE);

  // Behavior must be unchanged: still assigns the caller-supplied agentId,
  // not some newly-invented "resolved" user id.
  assert.match(
    source,
    /creator_id:\s*agentId,\s*\/\/\s*TODO: use actual user ID/,
    "creator_id assignment must remain exactly as-is — no identity resolution invented by this fix"
  );

  // Must be called out as a known, separate blocker so it isn't lost.
  assert.match(
    source,
    /BLOCKER/,
    "expected an explicit BLOCKER comment documenting the unresolved creator_id identity gap"
  );
  assert.match(
    source,
    /bw_users/,
    "expected the blocker comment to explain creator_id's actual FK target (bw_users)"
  );
});
