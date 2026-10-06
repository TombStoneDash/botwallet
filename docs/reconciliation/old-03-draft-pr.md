# Draft: reconcile funding authority with model A (fail closed)

Base: `main` (`fede67173a3466fac96d7d1b9a8c5a14598fe612`)
Branch: `codex/old-03-botwallet-fail-closed`
Publication: runner must commit/push this branch and open **one draft PR**. Do not merge.
This file is the prepared PR body; no replacement PR has been published locally.

## What changes for users

An agent API key cannot add money to any wallet, including its own. If a caller
sends an amount or claims to have a payment ID, we refuse the funding request
instead of treating that claim as proof of payment. A valid, active agent gets
`403 FUNDING_UNAVAILABLE`; a missing, invalid, or frozen key gets
`401 UNAUTHORIZED`. No funding body is consumed and no account, ledger, or audit
mutation occurs. Authentication still reads the agent record. An authentication
transport failure also stops the request; it cannot fall through to funding.

That is what **fail closed** means here: when verified funding authority is
unavailable, adding funds is unavailable too. There is no successful agent-key
funding path. Stripe checkout and gift-link payments are not implemented, and
the gift page disables its funding button. Demo credits are explicitly simulated.
A future verified payment authority requires a separate implementation and review.

Registration requires an existing active agent key and the caller's stored owner
record. It cannot register for another owner or overwrite the stored owner name
using request fields. First-agent onboarding needs operator provisioning.
Gift-link creation requires authentication and can target only the caller's own
agent; creating a link record does not grant permission to fund it.

## Reconciliation

Decision: model A under the soft-gate rule, per Hermes OLD_PENDING_RECONCILE row 3.
Read both PR bodies and their current changes. The old row's competing-model
summary does not describe the current heads: #7 now implements model A; #8 is
an independent gift-link authentication/ownership patch, not a verified-payment
implementation of model B.

- Reused #7 at `207ff086acf67b409879a5a326e6a2934a1a81de`: fail-closed funding,
  canonical-owner registration, funding UI/docs, and the same-owner funding-account
  uniqueness migration with its tests, rollback, and disposable database proof.
- Removed #7's obsolete self-funding authorization helper and tests expecting
  successful self-funding. Added tests executing the real funding handler and
  shared auth code with a stub database transport and framework JSON response.
- Reused #8 at `ced20262c9b5a68761b99b6d609785da1dfcfce2`: gift-link authentication,
  same-agent ownership checks, and all 14 applicable regression tests. Preserved
  main's `T.gift_links` table fix instead of reintroducing the obsolete schema.
- Updated the quickstart and demo to disclose the existing-key registration
  requirement and the unavailable funding flow.

**Close both #7 and #8 as superseded by this replacement once it is published.**
Neither old PR was closed by this work. Keep the replacement draft; do not merge.

## Verification (2026-10-06)

- PASS: `pnpm test:security` — 79 tests, 79 passed, zero failures/skips.
  Runtime coverage includes missing/invalid/frozen keys, identity lookup failures,
  forged payment IDs, self/cross-agent targets, repeated requests, malformed JSON,
  null and oversized bodies, no body consumption, and zero mutations.
- PASS: `git diff --check`.
- BLOCKED: `pnpm test` and `pnpm build` — `turbo: command not found`.
  Both offline and normal frozen-lockfile installs were attempted. The local store
  lacks packages and registry.npmjs.org cannot resolve (`ENOTFOUND`), so dependency
  installation, full build, and TypeScript verification remain outstanding.
- BLOCKED: disposable PostgreSQL proof. Local PostgreSQL 15 `initdb` fails with
  `could not create shared memory segment: Operation not permitted` (`shmget`).
  The CI workflow retains the PostgreSQL 17 proof steps; those must run before
  marking database verification complete. No live database was touched.

## Remaining limits

Main's separately documented gift-link `creator_id` foreign-key identity gap is
preserved. This PR secures the authorization boundary but does not claim a working
end-to-end gift-link creation/payment flow. Resolve that identity design separately.
The uniqueness migration refuses existing duplicate funding accounts; it does not
clean up production data. No production migration, credential rotation, deployment,
commit, push, merge, or remote PR state change was performed during this work.
