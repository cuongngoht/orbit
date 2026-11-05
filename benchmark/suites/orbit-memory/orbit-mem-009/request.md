# ORBIT-MEM-009 — a knowledge recall measures freshness once, now, and reads no file

`node cli/knowledge.mjs claims` is the read side of project knowledge (`src/knowledge/views/claims.mjs`): it answers a
task from the claims already recorded, each with its authority, and it writes nothing. A claim's freshness is MEASURED
for the answer, now -- never taken from the stamp it was recorded with, and never stamped back -- in one look at the
index for every scope the claims watch (`src/knowledge/query.mjs`), keyed to each claim's own scope, never to HEAD.

The behaviour this source must have, for a git checkout with claims recorded about its folders:

- A recall over an unchanged checkout calls every claim it answers fresh. It reads no file, lists nothing and searches
  nothing; it asks the index for its entries once, however many claims it answers -- a few git calls in all, at most
  three -- and it writes nothing: the store holds the same bytes after it as before it.
- A commit under one claim's scope makes that claim stale -- it needs revalidation, it is not false -- and leaves every
  other claim fresh. A recall never re-records what it measured, so the claim is stale on every recall after.
- An uncommitted edit under a claim's scope makes it unknown, never fresh; once the edit is committed, it is stale.
- A commit that only touches a note no claim watches leaves every claim fresh.

Make the smallest change under `src/knowledge/` or `src/freshness.mjs` that gives this behaviour, and add a regression
test under `test/` that fails before your change and passes after it. Do not change or delete an existing test.
