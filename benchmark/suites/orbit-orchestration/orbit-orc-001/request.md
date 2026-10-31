# ORBIT-ORC-001 — a change is held to what it reaches

`src/orchestration/impact.mjs` derives which components of a checkout a set of changed paths REACHES, and why, from
the paths and the component graph runtime understanding hands in (ADR 0019). `src/orchestration/obligations.mjs`
turns that into the declared checks a change is held to. Declared is not required: a change is held to the checks of
what it reaches, and only those.

A graph is `{ components: [{ key, dir, dependsOn: [key], inherits: [path], unresolved: [ref] }] }`.

The behaviour this source must have:

- A path belongs to the nearest component at or above it: the deepest component whose directory holds it. A directory
  holds itself and what lies under it (`lib` holds `lib/math/round.ts`), never a sibling whose name only starts with
  the same letters (`lib` does not hold `library/old.ts`). A component whose directory is `.` holds everything.
- `impactOf(paths, graph)` reaches a component for the first of these reasons that holds, and reports it once:
  `MODIFIED` (a changed path belongs to it), `SHARED` (it inherits a changed file), `DEPENDENT` (it depends on a
  component already reached by one of those two, directly or through others), `UNRESOLVED` (it names a unit nothing
  resolves, and something is reached -- what it depends on is unknown, and unknown is never unrelated).
- A changed path that no component holds and none inherits is reported in `unowned`, once each, sorted -- never
  quietly dropped. A component the change does not reach is not reported, and a change of nothing reaches nothing.
- `dependentsOf(components, key)` names every component that depends on `key`, directly or through others, and never
  `key` itself, cycles included.
- `planOf` holds a change to the declared checks of every component it reaches (`required`) and excludes every other
  declared check. Its scope is the change's own files once it has some, the plan's scope before that, and nothing
  before a plan.
- With no component graph to read, every component that holds a check is held to it once anything is in scope, and
  the plan says `WIDENED`. With a graph, a component holding a check that the graph does not know is held to its
  checks once anything is in scope.

Make the smallest change in `src/orchestration/` that gives this behaviour, and add a regression test under `test/`
that fails before your change and passes after it. Do not change or delete an existing test.
