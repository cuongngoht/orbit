# ADR 0059 — Proactive execution: facts declared once, advice from evidence, a turn not left unverified

## Status

Accepted (0.6.0; backlog P1–P7), 2026-11-12. Extends ADR 0050 (Claude Code uses Orbit by itself): 0.5.0 decided how
much Orbit a PROMPT needs; this decides what the session's WORK, as it goes, may bring in, and how a task's reasons are
read back. The host reasons; the engine derives the facts, bounds what is said and keeps the evidence. Additive
contract: `reactsTo` on catalog rows, the automation setting `trigger.holdUnverified`, the trail's `advice.given` and
`turn.held`'s `kind` and `check`, `cli/task.mjs why`, an engineering task's failure classes `DEPENDENCY` and `ACCESS`,
and its context's `do`.

## Context

1. A component was brought in only by the words of a prompt. A plain session whose test failed got no diagnosis line,
   and a check failing again and again with nothing changed was retried, because nothing said it was the same failure.
2. A turn could end with edits no check had touched; the Stop hold of ADR 0050 held only a session's own coordinated
   workflow.
3. Failure classification existed inside an engineering task alone, and it could not tell a check whose dependencies
   never installed, or whose target was unreachable, from one the change broke.
4. A task's decisions lived in its journal, and nothing joined a decision to the receipts that allowed its next step:
   "why did it do that" meant reading raw lines.
5. Lines a host read carried `<engine>` and `<plugin>` placeholders, and a resumed goal or task did not name the command
   that goes on (0.5.0 review, Q3 and Q7).

## Decision

- **Facts declared once.** `FACTS` (`src/routing/facts.mjs`, a leaf) is the closed vocabulary of what may bring a
  component in besides a prompt: `check.repeats`, `check.failed`, `knowledge.owed`, ordered, each with the requirement
  it adds, the sentence a line gives, and a deriver over what the composition root read of the session -- the working
  set's checks fold (the last check, a repeat count) and the tracked work's needs. Never a model, a context run inside a
  hook, the text of an error or a guessed cause. A catalog row names the facts its own playbook handles (`reactsTo`);
  a fact that holds counts for it as one of its signals would, and the EXISTING resolver chooses the provider, so no
  component is named beside a fact.
- **Advice from evidence, and its silence table.** After a tool call FAILS, `src/lifecycle/advice.mjs` says at most
  one line -- the fact, its subject, the provider the resolver chose and the call that brings it in -- only when every
  row of `SILENCE` lets it, cheapest first: the host can carry a line after a failed call; something is bound; the
  trail is on (without it nothing can tell what was said); no halt cue; a fact holds; not said this session about the
  same subject; this prompt has not had its line (`MAX_PER_PROMPT` 1); the governed work is not paused, cancelled,
  waiting for a person or blocked; a component here reacts. Nothing is said after a call that succeeded. The same facts
  reach the next prompt's routing decision. Repeats (`check.repeats`, three in a row with nothing changed) are said
  once as no progress, and every owner with a write door names its read-back.
- **The unverified hold.** At Stop, `src/lifecycle/subscribers/owed.mjs` holds a turn ONCE per prompt when it edited
  code a component of runtime understanding's graph owns and no check passed after the edit, naming the SAFE check that
  component, or one depending on it, declares and its command -- by the ordered `OWED` rows after the `GUARDS` every
  Stop hold shares (`MAX_HOLDS`, the halt cue, a turn a Stop hook already kept going). It runs nothing, never speaks
  beside the workflow hold, never past a person's pause, cancel or question, never for a path no component owns and
  never on a guess about an edit whose write has not landed. The cheap trail row runs first; the working set keeps
  `unverified.changed`. `trigger.holdUnverified`, on by default, is a person's, written only through Control's door.
  With no declared check for the edited paths, it names instead the tracked test files the relation adapters link to
  them (`src/context/relations.mjs` `testsWith`, the pack bound once in `cli/relations-port.mjs` for the context package
  and `cli/governed.mjs` alike; which tests go with a file is what the checkout declares for its test runner -- for
  Python, pytest's `python_files` and `testpaths` -- and the adapter's convention only when it declares nothing) -- the
  files and never a command, asking for a regression test where no existing test
  covers the change -- and a path neither speaks for stays silent; the trail keeps how many (`turn.held` `tests`), and a
  program named for testing (the executable, or what a launcher is told to run) is a test run in the one `CLASSES` table.
  What clears it is evidence the change WORKS: a passing run of a class `WORKS` names (a generic class whose
  `CHECK_PURPOSES` purpose verifies and builds nothing: a test, held equal by `test/working-set.test.mjs`), or of a
  component's own DECLARED verifying check (its command's class and executable among the working set's
  `unverified.ran`) -- never a lint, a build or a manual run alone; `since.checked` and the observer's milestone are
  unchanged.
- **What stopped a check, from facts.** `src/orchestration/failure.mjs` gains `DEPENDENCY` (the sandbox's restore
  receipt for the check's component says it ran and failed) and `ACCESS` (a fresh reach answer for a target a person
  said the component requires is unreachable) ahead of `ENVIRONMENT`, and reads the Process port's `code` for a child
  that never started and exit 126 and 127 as the shell's own. A class chooses what to look at next; it is never a
  verdict.
- **Research on existing doors.** `orbit-research` reacts to `knowledge.owed` (ADR 0058): it adds no door, only a
  playbook over `intelligence`, `work` and `knowledge`.
- **Explainable.** `advice.given` on the trail keeps a line as table words (fact, subject, provider, kind) and the
  activation fold counts it as suggested, so a suggestion that advice made is followed like one the router made.
  `task why <task>` (`src/task/why.mjs`, pure over the task's fold) says, per decision, what it observed and cited, how
  it settled -- a receipt, or REPORTED and never proven; OPEN for reconcile; AMBIGUOUS read back, never resent -- and
  which receipt moved the task next.
- **No placeholder, and every resume names its command.** CLIs and hooks write the plugin's own path
  (`src/engined.mjs`); a goal's resume says NEXT (`src/goal/resume.mjs` `RESUME_NEXT`) and an engineering task's context
  `do` (`step`, or `reconcile` for what did not settle).

## Consequences

- A simple change whose check passed hears nothing; a failure hears one line at most, once per fact and subject a
  session. A person who said stop hears nothing at all.
- A turn that edits owned code and stops unchecked is held once, and the trail says for which check
  (`turn.held` `kind: "unverified"`, `check`) -- or, with no declared check, for how many linked test files (`tests`).
- Tests: `test/routing-facts.test.mjs`, `test/activation-catalog.test.mjs`, `test/advice.test.mjs` (every silence row
  alone, and through the real hooks), `test/lifecycle.test.mjs` (every owner's read-back), `test/stop-hold.test.mjs`,
  `test/automation-settings.test.mjs`, `test/trace.test.mjs`, `test/task-why.test.mjs`,
  `test/orchestration-failure.test.mjs`, `test/orchestration-check-facts.test.mjs`, `test/no-placeholder.test.mjs`,
  `test/resume-command.test.mjs`, `test/work-research.test.mjs`.
- Known limits: a declared check whose command does not classify as a test, lint or build never clears the cheap trail
  row, and a test runner named for something else (`tox`, `jest`) is said only by the words it runs with; `unverified` is session-wide, so a later turn can be held for an earlier one's edit. The router hook and every
  failed call scan up to 64 work journals (measured: about 40-50 ms on the router hook, 55 ms on a failed call). The
  failure classes are proven on the module and its fakes, not end to end through the CLI. The plan markdown banner and
  `skill-factory show` keep their placeholder on purpose: one is written into a project's test data, the other is text
  a host edits and puts back.
