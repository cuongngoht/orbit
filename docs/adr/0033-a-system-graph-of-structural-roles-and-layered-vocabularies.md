# ADR 0033 — A system graph of structural roles and layered vocabularies

## Status

Proposed (0.1.0). Extends the architecture memory (README §4.4), ADR 0013, and the knowledge rule that an undeclared
relation is still legal.

## Context

1. **Architecture facts have no relations.** They know seven kinds: stack, module, boundary, capability, convention,
   extension-point, invariant (`src/architecture/vocab.mjs:24-32`). Calls, reads, writes, publishes, consumes and
   schedules exist nowhere as facts.
2. **Intelligence already knows half of it.** It keeps usage and integration facts per system and operation. The .NET
   pack recognises messaging clients and which side of the exchange the code is on, and says "unknown" when the code
   does not reveal a transport (`skills/orbit-dotnet/analyzers/messaging.mjs`).
3. **Targets without names.** A backend obligation needs a workload, a channel, a schedule or a store to point at, and
   nothing in the engine may name a product to get one.

## Decision

- **Structural roles are a leaf.** `src/topology/vocab.mjs` imports only `src/constraints.mjs`; architecture and qa
  both read it. It holds four tables:

  | Table | Contents |
  |---|---|
  | `NODE_ROLES` | component, workload, interface, principal, data-resource, channel, schedule, cursor, external, boundary |
  | `RELATION_ROLES` | invocation, data-read, data-write, identity, permission, boundary-crossing, time, activation, publish, consume, route, retry, terminal, progress, compensation |
  | `MEANINGS` | what an observed field means |
  | `BOUNDARIES` | publication, delivery, processing, state, scheduler-timing, chain |
- **Names are layered data.** `catalog/topology.json` starts the vocabulary: the workload, resource and transport kinds,
  and fifteen relations (calls, reads, writes, authenticates, authorizes, crosses-boundary, schedules, triggers,
  publishes-to, consumes-from, routes-to, retries-via, dead-letters-to, checkpoints-at, compensates). The
  organisation's and then the project's layers sit above it. An id nobody declared is kept, scoped, evidenced and
  shown, and derives nothing.
- **Two new fact kinds in the architecture room.**
  - `node` and `relation`, each with factRef and evidenceRef, the source revision, a scope, confidence and freshness. A
    dynamic target nobody resolved is `unknown`.
  - They arrive only through the existing door (`architecture record`, every cited path tracked) or through the
    `topology` analyzer, over canonical records that packs' extractors emit.
  - A framework extractor is pack or project data, never engine code. A domain payload never edits Orbit's lifecycle.
- **The graph is a projection, not a store.** `src/architecture/graph-view.mjs` joins, by id at the composition root:
  architecture facts, intelligence usage, runtime components, and the UI map's effects. It gives a digest, and an
  investigation freezes the graph it derived obligations from.
- **Discovered structure is never an oracle.** An endpoint, a schedule or a consumer found in source proves that
  something is declared. What it must do comes from an accepted contract (ADR 0031), and a disagreement between the two
  is a recorded conflict.

## Consequences

- Reverse Engineering is a role over the scanner agent and the architecture room. There is no second graph store.
- A stack nobody wrote an extractor for yields unknowns, questions and gaps, never guesses.
