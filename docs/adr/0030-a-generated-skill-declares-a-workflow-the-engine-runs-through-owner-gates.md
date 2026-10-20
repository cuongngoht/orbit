# ADR 0030 — A generated skill declares a workflow the engine runs through owner gates

## Status

Accepted (0.0.4). Extends the second scoped exception (AGENTS.md, playbooks) and ADR 0017, 0022; nothing they hold is
weakened.

## Context

Until 0.0.4 a playbook the skill factory generated was an instruction file: a host printed it with
`skill-factory show <pin>` and followed it in its own session, and the coordinator could only ever record that it was
followed (REPORTED). Four things were missing for a skill to be reusable and governed as a unit of work:

1. **Planning read words.** A goal's work units came from English keywords in its objective
   (`/implement|fix|change|build|add|refactor/`), and each unit's workflow was classified again from its title. The same
   goal in Vietnamese planned differently, or not at all.
2. **Nothing ran the steps.** A playbook composing two provided capabilities still left every call to the host, so no
   receipt said which provider answered, with what, or whether the step's contract held.
3. **Reuse was by id, not by version.** A followed playbook was shown by its id at the moment the host asked, so a
   version registered while a workflow ran could change what it followed.
4. **No viewer could show a skill's own steps,** and Mission Control never received a plan at all.

The constraint every option had to keep: the factory still generates nothing EXECUTABLE (`allowExecutableCode =
false`), every call still goes through the gate its provider is behind (the MCP broker, the capability pipeline), the
resolver stays the only authority on who provides a capability, a viewer still writes nothing, and a call that answered
is still not an outcome.

## Decision

- **A goal is planned from a structured intent.** The host's model reads a goal into `intent` -- category, work kinds,
  capabilities, verification, dependencies, missing prerequisites -- which the engine validates as SENT
  (`src/goal/intent.mjs`). Units come from the `WORK_KINDS` table alone; each declares the routing intent its workflow is
  planned under (`automation start --intent=`, never classified again) and is started with `--goal=<goal>:<unit>`, which
  the coordinator links back. A unit a missing prerequisite blocks is UNRESOLVED and never started on a guess.
- **A playbook may DECLARE its workflow** (`workflow.json`, `orbit.skill-workflow/v1`, `src/skill-factory/workflow.mjs`):
  ordered, dependency-aware steps, each a capability the manifest needs; inputs that are a literal value or a lookup
  (`context.objective`, `context.ref`, `steps.<earlier step>.<output>`); typed outputs read by a dotted path of plain
  keys; an output contract over them; `evidence` (`report` | `owner-record`); `retries`, `timeoutMs`, `required`,
  `approval`. It is data: a field nobody declared is refused, so there is no command, script, expression or module; a
  cycle, an unsafe binding, recursion (a step asking what the playbook provides, or a playbook-provided capability),
  bounds past their limits and a step whose provider is neither a managed server nor a project capability are refused
  at registration, and a dry run carries the workflow over typed stand-ins with the same interpreter the runner uses.
  Putting a `workflow.json` into a draft is what makes it `runs: declared`.
- **The coordinator runs a declared playbook itself** (`src/automation/skill-run.mjs`), as the playbook step's engine
  step: the version is PINNED for the run -- a later attempt keeps it, a version registered meanwhile changes nothing, a
  playbook a person switched off runs no version -- every step is recorded before it is asked, the resolver picks its
  provider at that moment, an approval is checked and spent then, and the call goes through the existing door
  (`invokeBound`, refactored out of `src/work/invoke.mjs`; `invokeNeed` is now its wrapper): the MCP broker, narrowed to
  reading only (a write tool is refused before it is sent), or the capability pipeline with no case.
- **A call is never an outcome.** A step's words are its evidence's: CONTRACT_MET when it answered within its contract,
  VERIFIED only when the `record` it names (`task:…`, `investigation:…`, `requirement:…`) is read back from its owner and
  proves it. A run with only met contracts is REPORTED; the plan step is satisfied only by a VERIFIED run. Receipts keep
  the provider's key and digests of what was asked and answered, never either; a later step's inputs are read off the
  scrubbed answer and kept nowhere.
- **An interruption is closed, never replayed.** Reconcile marks an open step INTERRUPTED when it read (the next attempt
  asks again, keeping what settled) and AMBIGUOUS when it may have written (never asked again; a person decides).
- **A coordinator's journal is its engine's alone.** The receipt domains it reads its own state back from, verifications
  naming them, and every non-person line of an `automation` task need the coordinator's door (or Control's); a terminal
  can no longer forge a step, a pin, a child or an ending.
- **Discovery and review are readings.** `skill-factory discover` says what the resolver's answer is in one word
  (REUSABLE with its pin, APPROVAL_REQUIRED, WORKFLOW_GAP, POLICY_GAP, ENVIRONMENT_GAP, CAPABILITY_GAP, UNRESOLVED);
  `runs` and `review` read a skill's history from the project's coordinators, and a review proposes a successor and never
  writes one. One session's success is never called reliable.
- **One projection of a plan.** `src/live/plan.mjs` `planViewOf` is what the pane, the Plan view, `live status --json`
  and Mission Control's new plan route all draw; a pinned workflow reaches viewers as one `skill-view` per pin through
  `SKILL_SOURCE`, read through the factory's own pinned read.

## Consequences

- Goal analyses must carry `intent` (current-only: one without it is refused, and there is no fallback reading).
- Every step of a declared run is an action in the coordinator's task and spends its action budget.
- A host step that cannot run in the engine -- one served by a skill, an agent or a builtin -- cannot be a declared
  step; such a playbook stays a followed one.
- A declared run reads only. A workflow that needs a write is a person's to decide, as before.
- `automation settle` and `reconcile` now load the project's capabilities, as `step` does.
