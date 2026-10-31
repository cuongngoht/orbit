# ORBIT-GOV-001 — autonomous by default: an action stops for a person only at one of five protected boundaries

`src/protected/authorize.mjs` answers the one question every executable side effect asks -- may this action cross,
now? -- from the rows in `src/protected/boundaries.mjs`. An action is the structured intent an executor describes about
itself (`{ kind, …fields }`), never a command line. `authorize(action)` returns `{ decision: "auto" }`, or the boundary
the action meets: `{ decision, boundary, kind, person, destructive, … }`, where `kind` is the protected kind an
approval of it would be bound to.

The behaviour this source must have:

- Everything is AUTO unless it crosses one of five boundaries: reading, planning, a task's own workspace, the store,
  building, testing, QA, a local commit, a sandbox, acquiring a tool, signing in -- and an action kind nobody has seen
  before, because there is no allow-list. Nothing described (no action, `null`, an empty object, a command string, a
  list) is nothing protected.
- A write into the developer's own checkout (`repository.write` with `home: "primary-checkout"`) is `deny` at
  `PRIMARY_CHECKOUT_WRITE`, kind `repository.primary_checkout.write`, a DENY only a person's own act may cross
  (`person: true`), wherever it is said to land. The same write into a task's own workspace or the store is AUTO: the
  home decides.
- Every push (`repository.push`) is `approve_once` at `GIT_PUSH`, kind `repository.push`, forced or not.
- A deployment to a target declared production is `approve_once` at `PRODUCTION_DEPLOY`, kind `deployment.production`.
  A schema migration on a database declared production is `approve_once` at `PRODUCTION_DB_MIGRATION`, kind
  `database.production.migrate`.
- Deleting, truncating, dropping, purging or resetting production data (`database.delete`, `database.truncate`,
  `database.drop`, `database.purge`, `database.reset`) is `approve_once_destructive` at `PRODUCTION_DESTRUCTIVE_DATA`,
  kind `database.production.<operation>`, marked `destructive` -- and so is a production write nobody declared the
  meaning of (`data.mutate`), kind `database.production.mutate`. A declared additive write (`data.write`) or a read
  (`data.read`) on production is AUTO.
- Production is only what was declared production. Staging, preview, development, test, local, a sandbox, and any word
  nobody listed (`prod`, `live`, an empty or missing environment) are not production, so the same deployment,
  migration or data change there is AUTO.
- An identity, a mode or an approval word riding on an action (`agentRunId`, `attribution`, `role`, `approved`,
  `door`, …) changes no verdict.

Make the smallest change in `src/protected/` that gives this behaviour, and add a regression test under `test/` that
fails before your change and passes after it. Do not change or delete an existing test.
