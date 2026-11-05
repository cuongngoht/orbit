# ORBIT-MEM-008 — after a scoped change, only that scope is read again

`node cli/architecture.mjs ensure` keeps a snapshot of a project's architecture outside the repository and decides, on
every look, whether the repository has to be read again (`src/architecture/ensure.mjs`). Freshness is keyed to each
fact's own SCOPE -- the paths it is about (`src/architecture/fields.mjs`) -- and never to HEAD: a tool whose answer is
"re-do everything" on every commit is one people learn to ignore.

The behaviour this source must have, for a git checkout that changes between looks:

- A commit that only touches a note no fact is about leaves the next look CURRENT: it reads no file and writes nothing.
- A commit to a declaration -- a package's manifest, the root's manifest or README, a decision record -- makes the next
  look INCREMENTAL. It re-reads the file that moved; it reads no file that another top-level folder holds, and none of
  the root's own files when the change was elsewhere (a change to a root file re-reads that file and no other); it lists
  the tree once; and it records where the scopes stand now, so the look after it is CURRENT again.
- An uncommitted edit is unknown -- neither fresh nor stale -- so every look re-reads its scope, and nothing outside its
  folder, until the edit is committed. Then the index has moved from what was recorded: one more look re-reads it, and
  the next is CURRENT.

Make the smallest change under `src/architecture/`, `src/freshness.mjs` or `src/frontend/` that gives this behaviour,
and add a regression test under `test/` that fails before your change and passes after it. Do not change or delete an
existing test.
