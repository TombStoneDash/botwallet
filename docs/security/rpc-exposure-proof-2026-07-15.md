# BotWall3t financial RPC exposure proof — 2026-07-15

## Scope

Read-only PostgreSQL catalog verification against the connected Supabase project for BotWallet. The query joined only `pg_proc` and privilege helpers for the nine exact application RPC signatures.

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

## Grounded application caller

The repository's shared database client reads `SUPABASE_SERVICE_ROLE_KEY` on the server. The ledger, policy engine, and registration route call these nine RPCs through that client. No browser-side RPC caller was identified or authorized.

## Intended post-migration posture

After `sql/003_lockdown_rpc_grants.sql` is separately approved and applied:

- `anon EXECUTE`: false for every listed signature;
- `authenticated EXECUTE`: false for every listed signature;
- `service_role EXECUTE`: true for every listed signature;
- function `search_path`: `pg_catalog, public, pg_temp`;
- function behavior and table data: unchanged by the grant migration.

`sql/003_verify_rpc_lockdown.sql` checks this posture without invoking any financial function.

## Remaining gate

This branch is preparation only. Production DDL is not authorized by the PR. Before production application: run focused tests/build, apply on an isolated or staging database, perform negative client-role probes and positive server-role proof, run the verification SQL, and capture the Supabase advisor delta.

References: GitHub issue #1 and draft PR #2.
