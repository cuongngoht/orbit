# ORBIT-SAT-003 — every consumer holds a handoff to what was published before it relies on it

`satellite/src/handoff/handoff.mjs` keeps a Satellite handoff: what one agent run hands to the units that depend on it.
It is published IMMUTABLY with a digest (`handoffDigest(record)`, taken over the handoff's own fields), and the
journal line that publishes it names that digest and the line it sits on. Every consumer validates a handoff before it
relies on it: `consumeFinding({ m, unit, record, tree, published })` answers the FIRST rule of an ordered table the
handoff breaks (`{ rule, say }`), or `null` when it breaks none. `record` is the handoff as it was read back now,
`published` its journal line (`{ id, digest, n }`), `unit` the consumer, `m.units` the mission's units by id (each with
the line `resetAt` of its last reset) and `tree` the checkout as it is now (`{ head }`).

The behaviour this source must have, in the table's order:

1. `HOF_MISSING` — the handoff could not be read back as an object.
2. `HOF_DIGEST` — the handoff is not what was published: its digest must be its own digest AND the digest its journal
   line names. A handoff changed after publishing is refused whether its digest was left as it was or computed again
   over the change; so is one that carries no digest.
3. `HOF_TARGET` — it was not handed to this consumer: it does not name the consumer among its targets, the consumer
   does not name it among its input artifacts, and the consumer does not depend on the unit it came from.
4. `HOF_SCOPE` — when the handoff covers paths, every path the consumer works on is one of them or lies under one of
   them as a directory. A path that only shares a prefix with a covered path (`web/uikit/x.mjs` and `web/ui`) is
   outside it, and a path under a covered directory is inside it whether that is written `web/ui` or `web/ui/`.
5. `HOF_COMPATIBILITY` — the consumer accepts certain shapes, and not the shape of the handoff's output contract. A
   consumer that names no shape takes any.
6. `HOF_FRESHNESS` — the unit it came from was reset after the handoff was published, or the checkout head it was
   made on and the head now are both known and differ.
7. `HOF_CONTRACT` — a field the handoff's own output contract names (`findings`, `evidenceRefs`, `artifacts`) is empty.

Make the smallest change in `satellite/src/` that gives this behaviour, and add a regression test under
`satellite/test/` that fails before your change and passes after it. Do not change or delete an existing test.
