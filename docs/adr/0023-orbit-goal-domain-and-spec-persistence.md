# ADR 0023 — Orbit: a goal is a journal above work and automation; user specs persist locally

**Status:** accepted, 1.9.0 (Orbit 2.0)

## Context

Orbit already coordinates one objective through one automation workflow (ADR 0017): requirement,
context, runtime, engineering, QA, regression, review. A person with a full PBI, bug report or
large feature still must choose skills, carry state between sessions, and fit the whole
specification into a 240-character task objective. External work-item sources keep metadata only
(ADR 0007, `orbit.source/v1`); they never store retrieved text in the machine store.

Orbit is the public product name for the same engine. It must accept full-text goals, decompose
them into work units, coordinate existing automation and task runtimes, verify acceptance criteria
on evidence, and resume across sessions — without a second orchestration engine or a second task
journal for child workflows.

## Decision

1. **A goal is its own room** in the machine store: `<store>/goals/<goal-id>/journal.jsonl`,
   `spec.json`, and immutable `plan-<n>.json` artifacts. State is derived from the journal only.
2. **User-submitted goal specifications** use contract `orbit.goal/v1`: canonical text in
   `spec.json` (scrubbed, bounded), digest recorded, never mirrored into a consuming repository.
   This is explicit submission via `--stdin`, `--file` or a host skill — not general prompt capture.
3. **Short title for UI and child tasks** stays within `TEXT_LIMIT` (240); the full spec is never
   truncated into a task objective.
4. **Semantic analysis is the host's; structure is the engine's.** The engine validates analysis
   JSON (traceability, no stamped authority), records it in the journal, and plans from it. The
   engine calls no model.
5. **Execution reuses automation** (`cli/automation.mjs`) per ready work unit; the goal coordinator
   records links and evidence digests, never re-judges child verdicts.
6. **Completion is evidence-gated** on an acceptance matrix; model assertion alone never marks an AC
   verified.
7. **Current Orbit contracts only:** the `orbit` CLI, `ORBIT_*` configuration and layout 3 store are the sole product contract. Unsupported payloads are refused without conversion.

## Consequences

- Goals have a dedicated room in the current project store.
- Live may follow a goal journal via a dedicated source alongside task and plan sources.
- Parallel work units default off until isolation is proven in tests.
