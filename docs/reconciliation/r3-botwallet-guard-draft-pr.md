# Draft: reject absent predicates in the funding-index guard

Prepared PR body for the runner; keep PR #11 draft and do not merge.
Requested base: `codex/fix-botwallet-10-index-owner`, `0936208c`.
Working branch: `codex/r3-botwallet-guard`.

A same-named unique index on `bw_accounts(user_id)` without a WHERE clause
previously bypassed the guard: `pg_get_expr` returned NULL and the negated
conjunction stayed NULL. Use `IS NOT DISTINCT FROM` for the predicate comparison
so a missing predicate causes the migration to raise.

## Exact class rule

For an existing public index named `idx_bw_accounts_user_funding_unique`, the
guard permits reuse only when it belongs to `public.bw_accounts`, is unique,
valid and ready, has exactly one key (`user_id`) and no additional included
columns, and its catalog-rendered predicate equals
`(type = 'user_funding'::text)`. Any mismatch in table, columns, uniqueness or
predicate, including an absent (NULL) predicate, raises the definition error.
An exact match reuses the same index without replacing it. A same-named non-index
relation is rejected; no same-named relation allows normal index creation.

## Coverage and verification

- PASS: `pnpm test:security`: 80/80, including all original 79 tests.
- Added a PostgreSQL Cartesian matrix of 72 candidates: two tables, two
  uniqueness states, six column shapes (correct, wrong, extra, reordered,
  included and expression), and three predicates (exact, absent and wrong).
  Only the exact match may succeed; all other candidates must raise the specific
  guard error. Every case checks index OID preservation. The existing CI proof
  invokes this matrix, plus decoy-table, relation, duplicate-data, registration,
  idempotence and rollback checks.
- PASS: shell syntax and whitespace checks. Compared every requested-base file
  directly with `0936208c`: only the migration and its two test files differ
  before adding this prepared body.
- BLOCKED: live PostgreSQL proof. `initdb` fails with `shmget: Operation not
  permitted`; invoking the proof script also fails at the database connection
  with `Operation not permitted`. The 72 SQL cases have not executed here.
- BLOCKED: `pnpm test` and `pnpm build`: `turbo: command not found`.
  Offline installation lacks cached packages; normal frozen-lockfile installation
  fails with `ENOTFOUND registry.npmjs.org`.
- BLOCKED: remote PR body update and draft-state verification: `gh pr view 11`
  cannot connect to `api.github.com`. This file is prepared for publication by
  the runner; no remote PR state was changed.

## Worktree handoff

The supplied branch actually started at `fede671`, not `0936208c`. Restored the
requested base's files in this worktree using `git archive` after `git restore`
was denied access to the external worktree index lock. Consequently the working
changes also contain the requested base's changes relative to `fede671`.
No branch switch, commit, push, merge or production database action occurred.
The runner must complete database/repo verification and publish this body while
keeping the PR draft.
