# BotWallet isolated PostgreSQL RPC-lockdown proof — 2026-07-15

## Environment

- Disposable local PostgreSQL cluster initialized under `/tmp` with trust authentication and a Unix socket only.
- Repository branch: `security/issue-1-rpc-grant-lockdown-20260715`.
- No Supabase production or staging project was modified.
- No external network, secret value, payment, or production financial row was used.

## Executed

1. Applied `sql/001_schema.sql` and `sql/002_rpc_functions.sql` to an empty isolated database.
2. Confirmed the original posture reproduced the issue: all nine exact financial RPC signatures were executable by both `anon` and `authenticated`.
3. Applied `sql/003_lockdown_rpc_grants.sql`.
4. Ran `sql/003_verify_rpc_lockdown.sql` and an independent assertion block covering every signature.
5. Ran real negative execution probes as `anon` and `authenticated`; both were denied before function execution.
6. Ran a positive `service_role` call to the read-only balance RPC against empty isolated tables; it succeeded.
7. Applied the explicit rollback, proved client execution grants were restored, then reapplied the lockdown and re-ran verification.
8. Ran `pnpm test:security` and `pnpm build` from a fresh clone.

## Result

- Exact functions present: **9/9**.
- `anon EXECUTE` after lockdown: **0/9**.
- `authenticated EXECUTE` after lockdown: **0/9**.
- `service_role EXECUTE` after lockdown: **9/9**.
- Fixed function `search_path`: **9/9**.
- Negative client-role probes: **PASS**.
- Positive server-role read probe: **PASS**.
- Rollback and re-lock cycle: **PASS**.
- Focused Node security tests: **7 passed, 0 failed**.
- Production build/type validation: **PASS**.

## Remaining production gate

Production DDL remains unapplied. Before any production apply, re-read the current production catalog, back up function definitions/grants, apply the reviewed migration in a controlled window, run the non-invoking verification SQL, confirm application health, and retain the explicit rollback. Production application is outside this receipt.
