import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const read = (relativePath) => readFile(path.join(ROOT, relativePath), "utf8");

const FUNCTIONS = [
  ["bw_fund_account", "uuid, uuid, integer, text, text, text"],
  ["bw_place_hold", "uuid, uuid, integer, text, text"],
  ["bw_release_hold", "uuid, uuid, integer, text"],
  ["bw_complete_spend", "uuid, uuid, integer, jsonb, text"],
  ["bw_get_agent_balance", "uuid"],
  ["bw_register_agent", "text, text, text, text, text, text"],
  ["bw_get_daily_spend", "uuid"],
  ["bw_get_monthly_spend", "uuid"],
  ["bw_verify_transaction", "uuid"],
];

const RPC_NAMES = FUNCTIONS.map(([name]) => name).sort();

function compactSql(value) {
  return value.replace(/\s+/g, " ").trim();
}

test("lockdown migration fixes search_path and restricts every financial RPC", async () => {
  const sql = compactSql(await read("sql/003_lockdown_rpc_grants.sql"));

  for (const [name, args] of FUNCTIONS) {
    const signature = `public.${name}(${args})`;
    assert.ok(
      sql.includes(
        `ALTER FUNCTION ${signature} SET search_path = pg_catalog, public, extensions, pg_temp;`,
      ),
      `missing fixed extensions-aware search_path for ${signature}`,
    );
    assert.ok(
      sql.includes(`REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`),
      `missing client-role revoke for ${signature}`,
    );
    assert.ok(
      sql.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`),
      `missing service_role grant for ${signature}`,
    );
  }

  assert.match(sql, /^-- BotWall3t SECURITY P0/);
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;$/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
});

test("fixed search_path preserves the live Supabase extension dependency", async () => {
  const original = compactSql(await read("sql/002_rpc_functions.sql"));
  const migration = compactSql(await read("sql/003_lockdown_rpc_grants.sql"));
  const verify = compactSql(await read("sql/003_verify_rpc_lockdown.sql"));

  assert.match(original, /gen_random_bytes\(32\)/);
  assert.match(migration, /search_path = pg_catalog, public, extensions, pg_temp/);
  assert.match(verify, /extensions\.gen_random_bytes\(integer\)/);
});

test("rollback is explicit, complete, and not wired to an automatic script", async () => {
  const rollback = compactSql(await read("sql/003_lockdown_rpc_grants.rollback.sql"));
  const packageJson = JSON.parse(await read("package.json"));

  assert.match(rollback, /^-- SECURITY ROLLBACK ONLY/);
  assert.match(rollback, /reopens direct execution to public client roles/i);

  for (const [name, args] of FUNCTIONS) {
    const signature = `public.${name}(${args})`;
    assert.ok(
      rollback.includes(`ALTER FUNCTION ${signature} RESET search_path;`),
      `missing search_path rollback for ${signature}`,
    );
    assert.ok(
      rollback.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO PUBLIC, anon, authenticated;`),
      `missing privilege rollback for ${signature}`,
    );
  }

  assert.doesNotMatch(JSON.stringify(packageJson.scripts), /003_lockdown_rpc_grants\.rollback\.sql/);
});

test("verification SQL checks exact privileges without invoking a financial RPC", async () => {
  const verify = compactSql(await read("sql/003_verify_rpc_lockdown.sql"));

  for (const [name] of FUNCTIONS) {
    assert.match(verify, new RegExp(`public\\.${name}\\(`));
  }

  assert.match(verify, /has_function_privilege\('anon'/);
  assert.match(verify, /has_function_privilege\('authenticated'/);
  assert.match(verify, /has_function_privilege\('service_role'/);
  assert.match(verify, /p\.prosecdef/);
  assert.match(verify, /p\.proconfig/);
  assert.doesNotMatch(verify, /SELECT\s+(?:public\.)?bw_[a-z0-9_]+\s*\(/i);
  assert.doesNotMatch(verify, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
});

test("the original SQL defines all nine functions as SECURITY DEFINER", async () => {
  const original = await read("sql/002_rpc_functions.sql");

  for (const [name] of FUNCTIONS) {
    const definition = new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+${name}\\s*\\([\\s\\S]*?SECURITY\\s+DEFINER`,
      "i",
    );
    assert.match(original, definition, `${name} is not proven SECURITY DEFINER in source SQL`);
  }
});

test("all application RPC callers use only the inventoried server-side functions", async () => {
  const callerPaths = [
    "packages/ledger/src/index.ts",
    "packages/policy/src/index.ts",
    "apps/web/src/app/api/v1/register/route.ts",
  ];

  const callers = (await Promise.all(callerPaths.map(read))).join("\n");
  const discovered = [...callers.matchAll(/\.rpc\(["'](bw_[a-z0-9_]+)["']/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual([...new Set(discovered)], RPC_NAMES);
});

test("the shared database client keeps service_role credentials server-only", async () => {
  const dbClient = await read("packages/db/src/index.ts");

  assert.match(dbClient, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(dbClient, /NEXT_PUBLIC_SUPABASE_SERVICE/);
  assert.match(dbClient, /auth:\s*\{\s*autoRefreshToken:\s*false,\s*persistSession:\s*false\s*\}/);
});

test("the focused security test command is registered", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(packageJson.scripts["test:security"], "node --test tests/security/*.test.mjs");
});
