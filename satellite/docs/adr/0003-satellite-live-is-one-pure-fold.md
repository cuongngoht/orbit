# ADR 0003 — Satellite Live is one pure fold of the journal

## Status

Proposed (Orbit 0.1.1). Follows Orbit Live (ADR 0015, 0016, 0022, 0029).

## Context

1. **A viewer that keeps its own state disagrees with the engine.** Two folds of one journal drift the day a line kind
   is added.
2. **Modes, statuses and lifecycles are different axes.** A mission can be RUNNING while one run EXPLORES, another
   DIAGNOSES, an action waits PROVIDER_ACCEPTED and the viewer itself is IDLE.

## Decision

- Satellite Live reads the mission journal through Orbit Live's own follower and the journal's one keep-rule, and names
  every line as an `orbit.satellite.event/v1` event through the same fold the engine decides with. A replay and an
  incremental read give the same events at every cursor.
- The view is a pure function of the model and the events; nothing in it reads a clock. The viewer's own state
  (ORBITING, IDLE, FINISHED …) comes from Orbit Live's presentation table and is never a mission's lifecycle; the orbit
  in the header is motion, never progress.
- A mode belongs to an action or a run; a nested action shows its mode on top of its run's and the run's mode shows
  again when it closes. There is no global mode.
- No viewer writes anything a mission reads. The full screen writes only to its terminal and runs one teardown.

## Consequences

- `live watch --since=o=<n>` resumes without a duplicate line, because a line's number is its place in the journal.
- What the hooks see of the host's tool calls is shown beside the mission, attributed to no agent run, until something
  can prove which run made a call.
