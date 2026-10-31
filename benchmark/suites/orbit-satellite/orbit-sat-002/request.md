# ORBIT-SAT-002 — a work graph is refused whole on the first rule it breaks

`satellite/src/planning/graph.mjs` judges a work graph the host proposes before any of it is accepted, so a graph is
never half accepted. `graphFinding(c)` answers the FIRST rule of an ordered table the proposal breaks
(`{ rule, say }`), or `null` when it breaks none. `c` is `{ m, states, limits, spent, units, cancel, reset }`:

- `m.units` — every unit the mission already holds, by id (a Map), each with its `key`, `dependencyIds` and, when it
  was delegated, the `parentUnit` id it nests under;
- `states` — each held unit's state, by id (a Map);
- `limits` — `maxUnits`, `maxDepth` and `maxAgentRuns`; `spent.agentRuns` — the agent runs already started;
- `units` — the units the plan adds, each with an `id`, a `key`, its `dependencyIds` (a dependency nobody could
  resolve is `null`) and, when delegated, a `parentUnit` id;
- `cancel` and `reset` — the ids of held units the plan cancels and resets.

`topo(nodes)` orders `{ id, deps }` nodes so every node comes after the nodes it depends on, or answers `null` when
they hold a cycle. A dependency on an id that is not among the nodes is no edge.

The behaviour this source must have, in the table's order:

1. `PLAN_EMPTY` — a plan adds, cancels or resets at least one unit.
2. `PLAN_DUPLICATE_KEY` — every unit key is unique in the mission, across every revision (a cancelled unit's key stays
   taken).
3. `PLAN_UNKNOWN_DEPENDENCY` — a new unit depends on something the mission does not have.
4. `PLAN_CANCELLED_DEPENDENCY` — a new unit depends on a unit that is cancelled, or that this plan cancels.
5. `PLAN_CANCEL_STATE` — cancel names a unit that exists and is not running, done, cancelled or skipped.
6. `PLAN_RESET_STATE` — reset names a unit that failed, is blocked, unresolved or done.
7. `PLAN_BOUNDED` — the live units (every held unit that is not cancelled or skipped and that this plan does not
   cancel) and the new ones together are at most `maxUnits`.
8. `PLAN_CYCLE` — the dependencies among the live units and the new ones hold no cycle: no two units waiting for each
   other, no longer ring, no unit waiting for itself. A dependency on a cancelled or skipped unit is no edge.
9. `PLAN_DEPTH` — delegation nests at most `maxDepth` deep: a new unit that names no `parentUnit` is 0 deep, and each
   `parentUnit` above it, new or already held, adds one.
10. `PLAN_BUDGET` — the new units and the resets together need no more agent runs than are left (`maxAgentRuns` less
    the agent runs already spent).

Every limit is inclusive: exactly `maxUnits` live units, exactly `maxDepth` deep and exactly the agent runs that are
left are all allowed. The policy's defaults are 12 agent runs, delegation 2 deep and 12 units.

Make the smallest change in `satellite/src/` that gives this behaviour, and add a regression test under
`satellite/test/` that fails before your change and passes after it. Do not change or delete an existing test.
