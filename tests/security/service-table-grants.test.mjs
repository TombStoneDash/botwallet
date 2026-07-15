import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => readFile(path.join(ROOT, relativePath), "utf8");

const TARGETS = [
  ["bazaar_disputes", "service_role_disputes"],
  ["bazaar_receipts", "service_role_receipts"],
  ["bot_captcha_challenges", "Service role full access"],
  ["bot_captcha_human_attempts", "Service role full access"],
  ["bot_captcha_leaderboard", "Service role full access"],
  ["bot_captcha_tokens", "Service role full access"],
];

function compactSql(value) {
  return value.replace(/\s+/g, " ").trim();
}

function executableSql(value) {
  return compactSql(value.replace(/^\s*--.*$/gm, ""));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("migration fails closed on policy drift and revokes every client table grant", async () => {
  const raw = await read("sql/005_revoke_service_table_client_grants.sql");
  const sql = executableSql(raw);

  assert.match(raw, /Production prerequisite:/);
  assert.match(sql, /p\.roles = ARRAY\['service_role'\]::name\[\]/);
  assert.match(sql, /p\.cmd = 'ALL'/);
  assert.match(sql, /p\.qual = 'true'/);
  assert.match(sql, /p\.with_check = 'true'/);

  const revokedTables = [
    ...sql.matchAll(/REVOKE ALL PRIVILEGES ON TABLE public\.([a-z0-9_]+) FROM PUBLIC, anon, authenticated;/g),
  ].map((match) => match[1]);
  assert.deepEqual(revokedTables.sort(), TARGETS.map(([table]) => table).sort());

  for (const [table, policy] of TARGETS) {
    assert.match(sql, new RegExp(`'public', '${escapeRegExp(table)}', '${escapeRegExp(policy)}'`));
    assert.ok(
      sql.includes(
        `GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.${table} TO service_role;`,
      ),
      `missing explicit service_role grant for ${table}`,
    );
  }

  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+[^;]+\s+SET\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\s+TABLE\b/i);
});

test("rollback restores only the immediate prior client grants and leaves policies scoped", async () => {
  const raw = await read("sql/005_revoke_service_table_client_grants.rollback.sql");
  const sql = executableSql(raw);

  assert.match(raw, /^-- SECURITY ROLLBACK ONLY/);
  assert.doesNotMatch(sql, /ALTER\s+POLICY/i);
  assert.doesNotMatch(sql, /\bTO\s+PUBLIC\b/i);

  const restoredTables = [
    ...sql.matchAll(
      /GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public\.([a-z0-9_]+) TO anon, authenticated;/g,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(restoredTables.sort(), TARGETS.map(([table]) => table).sort());
});

test("catalog verification checks RLS, policy scope, all client privileges, and service access", async () => {
  const sql = executableSql(await read("sql/005_verify_service_table_client_grants.sql"));

  assert.match(sql, /c\.relrowsecurity/);
  assert.match(sql, /p\.roles = ARRAY\['service_role'\]::name\[\]/);
  assert.match(sql, /has_table_privilege\(client_role, qualified_name, privilege_name\)/);
  assert.match(sql, /NOT has_table_privilege\('service_role', qualified_name, privilege_name\)/);

  for (const [table, policy] of TARGETS) {
    assert.match(sql, new RegExp(`'public', '${escapeRegExp(table)}', '${escapeRegExp(policy)}'`));
  }

  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+[^;]+\s+SET\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\s+TABLE\b/i);
});

test("disposable PostgreSQL acceptance is wired into the security workflow", async () => {
  const workflow = await read(".github/workflows/rpc-security.yml");
  const script = await read("scripts/test-service-table-grants-postgres.sh");

  assert.match(workflow, /bash scripts\/test-service-table-grants-postgres\.sh/);
  assert.match(script, /005_revoke_service_table_client_grants\.sql/);
  assert.match(script, /005_verify_service_table_client_grants\.sql/);
  assert.match(script, /assert_client_denied anon/);
  assert.match(script, /assert_client_denied authenticated/);
  assert.match(script, /SET ROLE service_role/);
});
