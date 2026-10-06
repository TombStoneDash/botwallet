import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// BOTWALLET-FUNDING-AUTHORITY: same-owner account repair. bw_register_agent
// previously inserted a brand new `user_funding` account on every call, even
// when the owner (matched by email via the bw_users upsert) already had one
// from an earlier registration — so two registrations for the same owner
// silently produced two `user_funding` accounts. This file proves the
// 004 migration makes that deterministic (create-or-reuse exactly one) and
// fails closed on unexplained pre-existing multiplicity, same style as
// rpc-lockdown.test.mjs and service-table-grants.test.mjs. The live
// create-or-reuse behavior itself is proven against a disposable PostgreSQL
// instance by scripts/test-user-funding-uniqueness-postgres.sh (see the CI
// workflow); this file is the static source-contract companion.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => readFile(path.join(ROOT, relativePath), "utf8");

function compactSql(value) {
  return value.replace(/\s+/g, " ").trim();
}

test("004 migration fails closed on pre-existing user_funding multiplicity before adding the constraint", async () => {
  const sql = compactSql(await read("sql/004_fix_user_funding_account_uniqueness.sql"));

  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;$/);
  assert.match(sql, /RAISE EXCEPTION/);
  assert.match(sql, /HAVING COUNT\(\*\) > 1/);
  assert.match(sql, /unexplained pre-existing multiplicity/);
  assert.match(sql, /same-named index has unexpected definition/);
  assert.match(sql, /same-named relation is not an index/);
  assert.match(sql, /existing_relation_kind NOT IN \('i', 'I'\)/);
  assert.match(sql, /pg_get_indexdef\(existing_index_oid\)/);
  assert.match(sql, /JOIN pg_index i ON i\.indexrelid = c\.oid/);
  assert.match(sql, /SELECT c\.oid, i\.indrelid,/);
  assert.match(sql, /INTO existing_index_oid, existing_table_oid,/);
  assert.match(sql, /existing_table_oid = 'public\.bw_accounts'::regclass/);
});

test("004 migration adds a partial unique index scoping exactly one user_funding account per owner", async () => {
  const sql = compactSql(await read("sql/004_fix_user_funding_account_uniqueness.sql"));

  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_bw_accounts_user_funding_unique ON bw_accounts \(user_id\) WHERE type = 'user_funding';/
  );
});

test("004 migration's bw_register_agent creates-or-reuses the owner's user_funding account instead of always inserting", async () => {
  const sql = compactSql(await read("sql/004_fix_user_funding_account_uniqueness.sql"));

  assert.match(
    sql,
    /ON CONFLICT \(user_id\) WHERE type = 'user_funding' DO NOTHING RETURNING id INTO v_funding_id;/
  );
  assert.match(
    sql,
    /ALTER FUNCTION bw_register_agent\(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\) SET search_path = pg_catalog, public, extensions, pg_temp;/
  );
  assert.match(
    sql,
    /IF v_funding_id IS NULL THEN SELECT id INTO v_funding_id FROM bw_accounts WHERE user_id = v_user_id AND type = 'user_funding' LIMIT 1;\s*END IF;/
  );
});

test("004 migration does not delete, update, or truncate any existing row (no live duplicate cleanup)", async () => {
  const sql = compactSql(await read("sql/004_fix_user_funding_account_uniqueness.sql"));

  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+bw_/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
});

test("004 rollback fully restores the pre-migration bw_register_agent body and drops the unique index", async () => {
  const rollback = compactSql(await read("sql/004_fix_user_funding_account_uniqueness.rollback.sql"));
  const original = compactSql(await read("sql/002_rpc_functions.sql"));

  assert.match(rollback, /^-- DATA-INTEGRITY ROLLBACK ONLY/);
  assert.match(rollback, /DROP INDEX IF EXISTS idx_bw_accounts_user_funding_unique;/);
  assert.doesNotMatch(rollback, /ON CONFLICT \(user_id\)/);
  assert.match(
    rollback,
    /ALTER FUNCTION bw_register_agent\(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\) SET search_path = pg_catalog, public, extensions, pg_temp;/
  );

  // The restored function body must match the original unconditional insert,
  // proving the rollback is exact and not a partial/approximate revert.
  const originalFundingInsert =
    "INSERT INTO bw_accounts (user_id, type, name) VALUES (v_user_id, 'user_funding', p_owner_name || ' Funding') RETURNING id INTO v_funding_id;";
  assert.ok(original.includes(originalFundingInsert), "sql/002_rpc_functions.sql no longer matches the expected pre-fix insert — update this test's expected string");
  assert.ok(rollback.includes(originalFundingInsert), "rollback does not restore the exact pre-004 unconditional user_funding insert");
});

test("004 verification checks the index, the function body, and remaining multiplicity without invoking bw_register_agent", async () => {
  const verify = compactSql(await read("sql/004_verify_user_funding_account_uniqueness.sql"));

  assert.match(verify, /idx_bw_accounts_user_funding_unique/);
  assert.match(verify, /i\.indisunique/);
  assert.match(verify, /i\.indisvalid/);
  assert.match(verify, /i\.indisready/);
  assert.match(verify, /i\.indkey::text = expected_user_id_attnum::text/);
  assert.match(verify, /pg_get_expr\(i\.indpred, i\.indrelid\)/);
  assert.match(verify, /pg_get_functiondef\(p\.oid\)/);
  assert.match(verify, /HAVING COUNT\(\*\) > 1/);
  assert.match(verify, /search_path=pg_catalog, public, extensions, pg_temp/);
  assert.doesNotMatch(verify, /SELECT\s+(?:public\.)?bw_[a-z0-9_]+\s*\(/i);
  assert.doesNotMatch(verify, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
});

test("disposable-PostgreSQL proof script exists, requires DATABASE_URL, and proves both the guard and the create-or-reuse behavior", async () => {
  const script = await read("scripts/test-user-funding-uniqueness-postgres.sh");

  assert.match(script, /: "\$\{DATABASE_URL:\?DATABASE_URL is required\}"/);
  assert.match(script, /sql\/004_fix_user_funding_account_uniqueness\.sql/);
  assert.match(script, /sql\/004_verify_user_funding_account_uniqueness\.sql/);
  assert.match(script, /unexplained pre-existing multiplicity/);
  assert.match(script, /wrong same-named index/);
  assert.match(script, /same-named non-index relation/);
  assert.match(script, /CREATE TABLE public\.funding_index_decoy \(LIKE public\.bw_accounts\)/);
  assert.match(script, /same-named index on another table/);
  assert.match(script, /funding index was not created on bw_accounts/);
  assert.match(script, /i\.indrelid = 'public\.bw_accounts'::regclass/);
  assert.match(script, /exactly one canonical user_funding account/);
  assert.match(script, /004 rollback executes and preserves RPC lockdown/);
});

test("the CI workflow runs the disposable-PostgreSQL user-funding-uniqueness proof", async () => {
  const workflow = await read(".github/workflows/rpc-security.yml");

  assert.match(workflow, /scripts\/test-user-funding-uniqueness-postgres\.sh/);
});


test("004 index guard rejects a NULL predicate and exercises the definition cross-product in PostgreSQL", async () => {
  const sql = compactSql(await read("sql/004_fix_user_funding_account_uniqueness.sql"));
  assert.match(sql, /existing_predicate IS NOT DISTINCT FROM '\(type = ''user_funding''::text\)'/);
  const script = await read("scripts/test-user-funding-uniqueness-postgres.sh");
  assert.match(script, /for probe_table in bw_accounts funding_matrix_decoy/);
  assert.match(script, /for probe_unique in unique nonunique/);
  assert.match(script, /for probe_columns in user_id created_at/);
  assert.match(script, /for probe_predicate in exact absent wrong/);
  assert.match(script, /before_oid/);
  assert.match(script, /after_oid/);
});
