# BotWall3t financial RPC exposure proof — 2026-07-15

## Scope

Read-only PostgreSQL catalog verification against the connected Supabase project for BotWallet. The queries joined only PostgreSQL catalogs and privilege helpers for the nine exact application RPC signatures and their extension dependency.

No financial RPC was invoked. No application table was scanned. No SQL/DDL/data mutation or secret read occurred.

## Current live posture

All nine functions are owned by `postgres`, run as `SECURITY DEFINER`, have no function-level `search_path` configuration, and are executable by `anon`, `authenticated`, and `service_role`.

| Function | SECURITY DEFINER | Fixed search_path | anon EXECUTE | authenticated EXECUTE | service_role EXECUTE |
|---|---:|---:|---:|---:|---:|
| `bw_fund_account(uuid,uuid,integer,text,text,text)` | yes | no | yes | yes | yes |
| `bw_place_hold(uuid,uuid,integer,text,text)` | yes | no | yes | yes | yes |
| `bw_release_hold(uuid,uuid,integer,text)` | yes | no | yes | yes | yes |
| `bw_complete_spend(uuid,uuid,integer,jsonb,text)` | yes | no | yes | yes | yes |
| `bw_get_agent_balance(uuid)` | yes | no | yes | yes | yes |
| `bw_register_agent(text,text,text,text,text,text)` | yes | no | yes | yes | yes |
| `bw_get_daily_spend(uuid)` | yes | no | yes | yes | yes |
| `bw_get_monthly_spend(uuid)` | yes | no | yes | yes | yes |
| `bw_verify_transaction(uuid)` | yes | no | yes | yes | yes |

This confirms the Supabase advisor finding is current rather than historical.

## Production-specific extension dependency

A second read-only catalog query confirmed that both `gen_random_bytes(integer)` and `uuid_generate_v4()` live in the Supabase `extensions` schema. The current `bw_register_agent` source calls `gen_random_bytes(32)` without schema qualification.

The first draft search path (`pg_catalog, public, pg_temp`) would therefore have denied client roles but broken service-side registration at runtime. The migration and verification contract were corrected before merge to use:

`pg_catalog, public, extensions, pg_temp`

The disposable PostgreSQL acceptance test installs `pgcrypto` into an `extensions` schema and must successfully execute `bw_register_agent` as `service_role`, so this dependency is no longer covered by source inspection alone.

## Grounded application caller

The repository's shared database client reads `SUPABASE_SERVICE_ROLE_KEY` on the server. The ledger, policy engine, and registration route call these nine RPCs through that client. No browser-side RPC caller was identified or authorized.

## Intended post-migration posture

After `sql/003_lockdown_rpc_grants.sql` is separately approved and applied:

- `anon EXECUTE`: false for every listed signature;
- `authenticated EXECUTE`: false for every listed signature;
- `service_role EXECUTE`: true for every listed signature;
- function `search_path`: `pg_catalog, public, extensions, pg_temp`;
- service-side registration continues to resolve `extensions.gen_random_bytes`;
- function behavior and table data remain unchanged by the grant migration.

`sql/003_verify_rpc_lockdown.sql` checks the privileges, fixed path, and required extension function without invoking a financial RPC.

## Remaining gate

This branch is preparation only. Production DDL is not authorized by the PR. Before production application: run focused tests/build, complete the disposable PostgreSQL client-denial and service-role probes, run the verification SQL, and capture the production Supabase advisor delta after a separately approved application.

References: GitHub issue #1 and draft PR #2.
