# BotWallet financial RPC lockdown — isolated database proof

**Verified:** 2026-07-15  
**Scope:** `TombStoneDash/botwallet`, branch `security/issue-1-rpc-grant-lockdown-20260715`

## Result

The proposed grant migration was exercised against a disposable PostgreSQL 17 database. The connected BotWallet Supabase project was not modified.

A fresh branch clone also passed:

- `pnpm install --frozen-lockfile`;
- `pnpm test:security` — 7 passed, 0 failed;
- `pnpm build` — production build and type validation passed.

## Isolated database procedure

1. Started a disposable PostgreSQL 17 instance.
2. Created test-only `anon`, `authenticated`, and `service_role` roles.
3. Enabled `pgcrypto` and loaded `sql/001_schema.sql` plus `sql/002_rpc_functions.sql`.
4. Confirmed the original posture allowed all three roles to execute the representative financial RPC.
5. Applied `sql/003_lockdown_rpc_grants.sql`.
6. Ran `sql/003_verify_rpc_lockdown.sql` successfully.
7. Confirmed `anon` and `authenticated` no longer had `EXECUTE` on all nine exact RPC signatures.
8. Confirmed `service_role` retained `EXECUTE`.
9. Performed one read-only `bw_get_agent_balance` call as `service_role`; it succeeded against the empty disposable database.
10. Performed the same read-only call as `anon` and `authenticated`; both failed with permission denied as intended.

## Safety receipt

- Production database touched: **no**
- Production DDL applied: **no**
- Financial row/account/hold/spend mutation: **no**
- Secret read or output: **no**
- History rewrite: **no**

## Remaining gate

This proves the SQL and application build in an isolated environment. Production application remains a separate explicit operation. Before applying there, preserve the rollback, execute the verification SQL, run client-role denial and server-role positive probes, and capture the Supabase advisor delta. No production financial function should be used for a write-path smoke.

Refs: issue #1 and PR #2.
