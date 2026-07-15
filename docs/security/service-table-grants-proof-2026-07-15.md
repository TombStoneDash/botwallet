# BotWall3t service-only table grant proof — 2026-07-15

## Scope

Read-only connected verification against the BotWallet Supabase project and current GitHub `main`. No application row was read, no application function was invoked, and no SQL/DDL/data mutation or secret access occurred during this investigation.

## State correction

GitHub issue #4 was filed from a transient earlier snapshot that said the six policies were still `TO PUBLIC` and client table grants were absent. The live catalog now proves the reverse layers:

1. Supabase migration history contains `scope_service_only_policies_20260715` (`20260715174931`).
2. All six named `ALL` policies are currently scoped to the single role `service_role`, with `USING (true)` and `WITH CHECK (true)` unchanged.
3. Each table has RLS enabled.
4. `anon` and `authenticated` still hold all seven direct table privileges: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER`.
5. `service_role` holds the same seven privileges.

The policy correction means the Supabase advisor no longer reports the six permissive-policy findings. The broad client table grants are nevertheless unnecessary for objects whose only application policy and intended caller are service-role-only. RLS currently provides the row-access barrier; revoking the grants adds the missing least-privilege layer and removes the tables from direct client capability.

## Target objects

| Table | Existing ALL policy | Current policy role | Client grants before this branch |
|---|---|---|---|
| `public.bazaar_disputes` | `service_role_disputes` | `service_role` | all seven table privileges |
| `public.bazaar_receipts` | `service_role_receipts` | `service_role` | all seven table privileges |
| `public.bot_captcha_challenges` | `Service role full access` | `service_role` | all seven table privileges |
| `public.bot_captcha_human_attempts` | `Service role full access` | `service_role` | all seven table privileges |
| `public.bot_captcha_leaderboard` | `Service role full access` | `service_role` | all seven table privileges |
| `public.bot_captcha_tokens` | `Service role full access` | `service_role` | all seven table privileges |

## Runtime evidence

The connected Supabase API log for the last 24 hours showed requests to `bazaar_tools`, but no request to any of the six target tables. This is supporting evidence only, not a claim that no historical caller exists. The migration therefore:

- fails closed unless every exact table and service-role-only policy exists with the expected command and expressions;
- changes grants only;
- preserves explicit full table privileges for `service_role`;
- changes no policy expression, command, RLS state, row, function, or schema shape.

## Branch remediation

Branch: `security/issue-4-client-table-grant-lockdown-20260715`

- `sql/005_revoke_service_table_client_grants.sql`
  - checks the six exact policy contracts;
  - revokes all table privileges from `PUBLIC`, `anon`, and `authenticated`;
  - explicitly preserves the seven required privileges for `service_role`.
- `sql/005_revoke_service_table_client_grants.rollback.sql`
  - restores only the immediate prior `anon`/`authenticated` table grants;
  - deliberately leaves the policies scoped to `service_role`.
- `sql/005_verify_service_table_client_grants.sql`
  - catalog-only verification of RLS, policy role/command/expressions, client denial, and service access.
- `scripts/test-service-table-grants-postgres.sh`
  - disposable PostgreSQL 17 fixture;
  - policy-definition before/after equivalence proof;
  - client-role denial probes;
  - service-role read/write transaction rolled back in the disposable database;
  - rollback and secure reapplication proof.
- `tests/security/service-table-grants.test.mjs`
  - exact-target and no-row-mutation source contract.

## Production gate

This branch does not apply production DDL. Production application occurs only after reviewed merge and green source, disposable-PostgreSQL, application-build, and preview proof. Post-apply acceptance is:

- `anon` and `authenticated` have no table privilege on all six objects;
- `service_role` retains the seven intended privileges;
- all six policies remain `TO service_role` with unchanged expressions;
- catalog verification passes;
- Supabase advisor remains free of the resolved policy findings;
- no live financial or application-row mutation is used as proof.
