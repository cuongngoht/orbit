# ORBIT-ORC-002 — a task completes only when every completion row holds

`src/orchestration/obligations.mjs` derives, on every read, the declared checks a task's change is held to and the
STATE of each, and `src/orchestration/verification.mjs` says what the journal must show before the task may complete:
one row each in `COMPLETION`, and `unmet(lw)` lists every row that does not hold. "The model says it is done" is not a
row, and neither is a build that passed.

The behaviour this source must have:

- A required check's state is read from its latest run that started after the code last changed and, when
  `record-changes` recorded a tree, ran on that tree: `passed` when it succeeded; `failed-as-before` when it failed
  exactly as at its baseline (the check's receipt says `failed-as-before`); `regressed` when it failed in any other
  way; `running` while it runs; `owed` when nothing counts. A run before the last change, or on a tree nobody
  recorded, counts for nothing.
- `passed` and `failed-as-before` settle a check; nothing else does. A failure as before stays visible and is never a
  pass.
- `unmet` reports every row that does not hold, and only those: every required build and verify command settled
  (`BUILD`); every required test settled (`TESTS`); at least one required test or verify command PASSED since the
  last change (`VERIFIED`) -- a build that passed, or a failure as before, is not one; nothing the change reaches is
  without a declared check that verifies it (`COVERED`); a review since the last change succeeded (`REVIEWED`); no
  action is still open (`NO_OPEN_ACTION`); and the task is in REVIEWING, not held, holds a recorded change, ended its
  last attempt succeeded, has no verification violated or blocked, no linked investigation with a defect, and no
  stale live evidence.
- A declared check of a component the change does not reach is excluded, and how it ran never matters. With no
  component graph, every declared check is required and the plan says `WIDENED`. A changed path no component holds,
  or a changed component nothing declared verifies, is missing, and the plan says `MISSING`.

Make the smallest change in `src/orchestration/` that gives this behaviour, and add a regression test under `test/`
that fails before your change and passes after it. Do not change or delete an existing test.
