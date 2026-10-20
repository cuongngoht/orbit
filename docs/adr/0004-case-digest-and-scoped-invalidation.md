# ADR 0004 — A PASS is about a case as written; freshness is scoped, never HEAD

**Status:** accepted, 1.7.0 · **Audit rows:** A05 (and C06 beside it)

## Context
A PASS is a statement about three things: the case that ran, the build and the environment. The
ledger recorded only the last two. So a case edited after its PASS inherited the old verdict:
- a step removed,
- an `expect` loosened,
- a query pointed at another table.

Coverage called it verified. A case that no longer even validated kept its old PASS as well,
because `proven()` never looked at the build state.

## Decision
1. **`case_digest`.** Every run records the sha of the case **as written** in its log and in the
   ledger (`src/dsl/digest.mjs`). "As written" means every key the loader did not add; the
   loader's own keys are `_`-prefixed. A case moved to another folder is the same case, and an
   edited one is not.
2. **A fourth freshness reference.** `case` sits beside revision, build and environment
   (`src/qa/states.mjs`). A mismatch reads `stale`.
   - A run recorded before 1.7.0 has no digest, so it reads `unknown` until it runs again. That
     is the same answer a run with no `fe_commit` has always had: unknown is never fresh.
3. **"Verified" needs the current case to validate** with the project's **effective** vocabulary
   and validators, meaning extensions loaded (`src/qa/world.mjs`). `qa-plan`, `plan-check` and
   `help` now load extensions for this, as `run-case` already did. Otherwise a project's own
   verb would read as unvalidated.
4. **Manual checks gate "verified" too (C06).**
   - A scenario is verified only when every manual check it names is `done`.
   - A criterion is verified only when every manual check covering it is `done`.
5. **Receipt and claim freshness (1.7.0 Phase 4) is scoped to tracked paths:** the case file,
   the plan file, `graph/effects.json`, and the effect's `src` paths where they are tracked.
   It is scoped through `src/freshness.mjs`, never to HEAD, so an unrelated commit leaves a
   receipt fresh. The build (the frontend commit) is recorded as **context**, not as a
   freshness reference. A product whose backend lives in another checkout is only as current as
   the paths the map cites. That limitation is stated in the README.

## Consequences
- **Intended behaviour change:** after upgrading, a PASS recorded before 1.7.0 counts as unknown
  until its case runs again. The upgrade notes list this first.
- **Tests that meant "a fresh PASS"** now build their runs with the digest of the case they ran
  (`qa-coverage.test.mjs`, and `seedStore(…, { digests: true })` for the spawned CLI tests). The
  committed seed ledger stays digest-less on purpose, and one test holds that such a run reads
  unknown.
