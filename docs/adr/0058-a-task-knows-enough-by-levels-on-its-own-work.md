# ADR 0058 — A task knows enough by three levels, on its own work, and relations come from a pack

## Status

Accepted (0.6.0; backlog U1–U5), 2026-11-12. Extends ADR 0050 §5 (the context package's RELEVANT and SUFFICIENCY). No
new owner and no new room: everything here is a read of what the owners already keep, or a line of the work journal.
Additive contract: the package's `sufficiency.levels`, `cli/context.mjs --work=<w-…>`, `cli/work.mjs checkpoint
--asked=`, the checkpoint's `asked` and `gained`, and the skill `orbit-research`.

## Context

1. 0.5.0's SUFFICIENCY was one word, ENOUGH, DISCOVER or ASK, and it answered one question: can the task choose a scope.
   Nothing said whether the change could be made, or whether the task could be called done, and a host read ENOUGH as
   both.
2. Discovery had no bound. A host asked DISCOVER's targets, read, asked again, and nothing remembered what a round had
   asked or gained, so a later session -- or the same one -- read the same files again and found the same nothing.
3. Relations were module to module, from one regular expression in architecture's import scan. What a task touches
   lives in files, and one file's imports and importers are what a change can break; a language's import grammar is
   not something the engine may know (AGENTS.md: no stack is named under `src/`).
4. A fact whose scope was deleted or renamed away read as `unknown`, the word an uncommitted edit also gets, and a work
   need settled on a deleted file stayed settled.
5. A question about how a technology behaves was answered from the model's memory, with no source and no version.

## Decision

- **Three levels, each an ordered table over facts.** `sufficiencyOf` also answers `levels.{investigate,change,
  conclude}`, each `{ holds, row, because, missing }` (`src/context/sufficiency.mjs` `LEVELS`): the first unmet row is
  the level's row, every unmet row is in `missing` with the command that fills it, and the last row always holds.
  Investigate needs a direct item the tracked tree holds. Change needs the direct items CONFIRMED BY A READ (proposed
  by the host after reading, or cited by an owner's fresh record), their dependents known or said unknown, a done
  criterion (a `proof` need on the task's own work) and the check that would prove it. Conclude needs every proof
  need satisfied, nothing it rests on moved, and the work's evidence `verified` -- an owner's completed task with no
  edit after it, which a developer's own session never is. A count of search hits decides nothing: a name the task's
  words matched is a candidate, however many there are.
- **The bounded loop is the work journal.** Done criteria are `proof` needs, gaps `knowledge` needs (one that cannot be
  filled here is settled `blocked`), a ROUND is a `checkpoint`, which keeps what the round asked (the targets the
  package offered, `<source> · <target>`, at most six) and what it gained (the needs it settled anew).
  `src/work/rounds.mjs` is a pure fold: `ROUND_STOP` (budget after five rounds, no-gain after two in a row that settle
  nothing new, else go on), and `offered` never offers a target again while what answered it is settled and unmoved.
  `context --work=` reads it and withholds what was answered; a later session re-reads only what went stale. Writes
  stay at `work need | settle | checkpoint`.
- **Relations on demand, through a pack's adapters.** One hop out and one hop in from at most eight direct files,
  never a graph of the repository (`src/context/relations.mjs`): out by reading the file once, whole; in by one
  fixed-string search of the index, a hit kept only when the importer's own adapter resolves the name back -- or, when
  the line alone names nothing, that file's whole text; and the tests the language's convention pairs with it. The
  contract (`detects`, `specifiersOf`, `resolve`, `testsOf`, `importersPattern`) is in `src/context/`; the languages
  are adapters in a pack (`skills/orbit-develop/relations/`: JavaScript/TypeScript, Python), handed in by
  `cli/context-grounding.mjs`. A route-shaped literal another tracked file holds is a HYPOTHESIS the host verifies by
  reading both ends; a file no adapter reads, or a read that could not run, is a GAP, never "nothing relates to it".
- **A scope gone is GONE.** `src/freshness.mjs` answers a scope the index no longer holds as gone, with its own
  sentence; `src/work/freshness.mjs` invalidates a need settled on a path that is gone (`from: <path>#gone`).
- **Research is a playbook on existing doors.** `orbit-research` (instruction-only): the technology and version from
  the manifests (`intelligence`), a knowledge need on the task's work scoped to that manifest, the provider's answer
  through `work invoke` or the host's own sourced lookup, and a claim whose context is that version. A version bump
  moves the manifest's scope and makes the answer stale; asking again is the same need.

## Consequences

- A host reads ENOUGH as "enough to choose a scope" only; `levels.change` and `levels.conclude` say the rest, each with
  what it misses. No level is a verdict: concluding stays the owner's record.
- Discovery ends: five rounds, or two that gain nothing, and what a round answered is not asked again while it holds.
- `src/context/` names no language (`test/context-relations.test.mjs` greps it); a new language is a pack's adapter
  and its fixture, never an engine change.
- Tests: `test/context-sufficiency.test.mjs`, `test/context-grounding.test.mjs`, `test/work-rounds.test.mjs`,
  `test/context-relations.test.mjs`, `test/develop-relations.test.mjs`, `test/freshness-events.test.mjs` (edit, rename,
  delete and branch switch on a real repository, owner by owner), `test/work-research.test.mjs`.
- Known limits: architecture's own import scan (`src/architecture/analyzers/imports.mjs`) is still per line and misses
  an import whose specifier is on the next line; Python re-exports through `__init__` are not followed; a commented-out
  JavaScript import counts; at most 16 importer hit files per direct file are read whole. A host's own sourced lookup
  settles the knowledge need with its sources but records no claim, since a claim needs a receipt.
