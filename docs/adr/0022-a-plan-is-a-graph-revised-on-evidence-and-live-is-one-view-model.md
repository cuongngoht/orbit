# ADR 0022 — A plan is a graph the tables draw, revised only on evidence; a pulse is evidence; Live is one view model

**Status:** accepted, 1.8.6

## Context

Through 1.8.5 a coordinated workflow's plan was a chain: a table row listed step kinds and each waited for the one
before it, though the plan's own reader (`readyOf`) already handled any `after` list. A revision only spent a retry
and reset the steps from where a failure sent the workflow back; the steps themselves never changed. A capability an
objective needed beyond the first was never planned, the skill factory drafted at most the one playbook a workflow's
template had room for, and what a viewer knew of a plan was its receipt's summary sentence, cut at 240 characters.

Orbit Live called a task LIVE only on a journal line or a running action, so a twenty-minute test run with nothing
journaled read IDLE while its runner printed cases. The LIVE glyph pulsed by the wall clock. Claude Code's docked
pane had a view model of its own; Codex and Antigravity had no pane at all, and `live pane --host=codex` failed.

What the code forced (each verified before deciding):

- The engine calls no model (ADR 0017). Whatever revises a plan must be demonstrable from a journal or an owner's
  record; "new evidence" in general is not a fact a table can test.
- `FRESH.UNSETTLED`, the single `running.json`, six readers of `lw.open[0]` and the protocol text all assume one
  open step per workflow. Running steps in parallel is a different release.
- Executable generation is refused in four places (a fixed setting, a deny policy class, two validation rules) and
  held by a boundary test. The controls a generated executable would need -- isolation, a permission manifest,
  deterministic tests, rollback and quarantine of code -- do not exist yet.
- A task journal's kinds, fields, domains, stops and causes are pinned: the automation vocabulary is asserted equal to
  the task's, and the journal's `nextAction` is a 64-character slug with no `:`.
- The live core imports no subject; a source is handed in by a composition root. Codex CLI publishes hooks and plugins
  but no pane or sidebar API; the Antigravity CLI publishes no panel API either. An installed 1.8.5 VS Code companion
  accepts a viewer command of exactly `tui [task] [--lease=…|--until-done]`.

## Decision

1. **A plan is a graph two tables draw.** `WORKFLOWS` says which steps an objective gets; `DEPENDS`
   (`src/automation/graph.mjs`) says what each kind waits for, and an edge joins two steps only when both are in the
   plan. A step FOR a capability waits for its own capability's steps and the shared ones; a shared step waits for
   every step of a kind it names. The order is Kahn's, ties by kind then by where a step stood: deterministic and
   topological, so `NO_FORWARD_REF` holds by construction and a cycle is refused, never run. A step's id is its kind
   while the plan holds one of that kind -- every earlier plan keeps its ids -- else `<kind>.<capability>`, short
   enough for the journal's slug. Every step says why it is there (`because`, from a table, never a host's text) and
   what it must prove (its kind's obligation, evidence domains and strictness, exposed, never stored twice). The
   plan artifact is `schema: 2`; one with no schema is a chain and reads as it always did.
2. **Capabilities are planned, not only classified.** Every capability the router's table reads off the objective,
   and any a person or a host names (`--capability`, capability words only), is resolved; one no step kind provides
   gets a playbook step; one whose gap the skill factory may close gets its draft and register steps first, as many
   as `maxSkillsPerTask` allows. What the plan cannot know is listed with who finds it out -- a step, or a person --
   and an acceptance criterion is never invented.
3. **A plan is revised only by a trigger row.** `TRIGGERS` (`src/automation/replan.mjs`), by moment: blocked
   (`CAPABILITY_MISSING`, `DEPENDENCY_BLOCKED`), settled (`REQUIREMENT_CHANGED`, `ENVIRONMENT_CHANGED`, `NONE`), failed
   (`VERIFICATION_FAILED`, `TASK_FAILED`); each moment's last row always answers. `RESPONSES` insert the generation
   steps, insert a QA step, reset from the step that reads what changed, retry, or change nothing. A structural
   revision is bounded by `execution.maxReplans` and by the plan's own rules (`execution.maxPlanSteps`); past either
   the answer is `BUDGET_EXHAUSTED` with the trigger's fallback -- block, fail (never build on a requirement that
   moved), or nothing. Every revision is a new artifact naming the one it replaced and why; receipts are never
   rewritten. There is no "new evidence" row.
4. **One step at a time stays.** The graph says what MAY run next; the protocol, the lock and the running marker are
   unchanged, and the host picks one ready step.
5. **A playbook has a shape and a phase; executable generation stays off.** A gap is read as one WORD per row of the
   one generating kind's table: no second generating row, so `skill-factory-boundary` holds unchanged. A draft's
   SHAPE (verification · composition · procedure) is read off its capability's words and what it composes; the
   engine writes its contract into the manifest (shape, inputs, outputs, evidence, restrictions -- optional, schema
   still 1) and the host writes only the text. A PHASE is derived from what is kept on every read and never stored.
   Registration counts its attempt, verifies and places under one hold of the room's lock. A generated executable
   stays refused: the controls it would need are not shipped, and the limit is said, not loosened.
6. **A pulse is evidence (amends ADR 0016 §4).** LIVE needs evidence that the TASK moved: a journal line written within
   `idleAfterSec`, an action started and not ended, or a line of a running check's observation written within it --
   what its command printed, stamped by the check runner as it read it (ADR 0020). A viewer's refresh, a repaint, a
   lease heartbeat or a stream heartbeat never moves a viewer there. The LIVE glyph's phase is the newest evidence's
   second, never the clock that redraws; a person may ask for no motion (`pane.animation: off`). One INDICATOR table
   reads the viewer's state and the task's lifecycle together, the first row deciding, the last always answering.
7. **Live is one view model.** What a docked pane draws -- the checklist, NOW, six views, task and test progress, the
   status bar ending in the indicator -- is `paneOf` (`src/live/tui/`), and the terminal draws the same parts as a
   layout of its own (`live tui --layout=pane`). A viewer an opener started beside an AI CLI (it carries a lease or
   `--until-done`, which only an opener passes) starts in it, so an installed companion's command is unchanged. A
   plan reaches a viewer as a SOURCE (`PLAN_SOURCE`, read by digest from the coordinator's room, never drawn when its
   digest does not hold) the composition root hands the feed, sent once per artifact as a frame a viewer replaces.
   The timeline is a pure fold over the sources a viewer already follows, each event saying whether it was
   `observed`, `reported` or `inferred`. Task progress counts a denominator an owner recorded and nothing else; a task
   with none is indeterminate. `live pane` is version 2, additive; every string of its data is cleaned like a row.
8. **Every host says where it can show Live.** A matrix of five surfaces (docked pane, companion, terminal split,
   window, CLI) per host, true of the host and never assumed of it; `live doctor --host=<name>` prints it and the
   surface `live open` reaches from here. Codex and Antigravity get adapters so `live pane|statusline|doctor` answer
   for their sessions; neither gets a native dock, because neither has one.

## Consequences

- `context.ready` may list several steps; a host that took the first one keeps working. Tests that held the chain's
  single ready step changed with it, on purpose.
- A requirement that moves under a running workflow plans again everything built on it; with no revision left, the
  workflow fails rather than verify a change against a snapshot nobody holds any more.
- A viewer of a 1.8.5 task reads its steps from the receipt sentence, as before; the Plan view says so.
- A pane change now changes the source digest native acceptance names (`hooks/*.tsx`, `types/`): the three hosts are
  accepted again before a release.
- Parallel execution of independent steps, a model-judged "new evidence" trigger, generated executables and a native
  pane on Codex or Antigravity are not in 1.8.6. Each is a decision of its own, and each is said in the README.

## Since 0.0.1

The ACTIVE indicator reads ORBITING, the header shows this table's word as a pill, and an orbit replaced the starship
lane (ADR 0027). The rule above is unchanged: the phase is the newest evidence's, and a tick moves nothing.
