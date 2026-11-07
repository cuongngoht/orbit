# ADR 0053 — A workflow benchmark holds one request to its code, its QA and its path

## Status

Accepted (0.5.0; backlog B1, "Code + QA in one workflow, through `/orbit-help`"). Built in part: what this pass built and
what it left are listed at the end, and nothing left is in the suite. Builds on ADR 0046 to 0048 (the benchmark, its QA
cases, its engineering cases and controls), ADR 0049 (a release qualifies on benchmark evidence), ADR 0051 (recorded
rows) and ADR 0054 (a kind that composes another kind's phases).

Additions to what a person can observe: a change's QA step is always in its workflow's plan, and SKIPPED with its reason
where nothing can be started (`automation.mjs` answers, its context and its ending; Orbit Live's plan); the benchmark's
`workflow` kind and its suite `orbit-workflow`; the release policy's `workflow` requirements and a third recorded suite.

## Context

1. The path the owner wants to use is `/orbit-help` with a change request: the `engineering` workflow
   (`src/automation/workflows.mjs`) takes it through requirement, context, runtime, an engineering task, QA of the running
   change, regression and review, each step settled on its owner's record.
2. 0.4.0 benchmarked the engineering task (the E2E cases, ADR 0048) and QA (the QA cases, ADR 0047) on their own. Nothing
   ran the chain, and nothing checked that the QA step ran on the CHANGE.
3. Where things run decides what can be held. An engineering task runs the code a host wrote (its declared checks run
   the host's tests): it must run in the runner container, whose only way out is the model's API. A QA sandbox needs
   Docker, and no container of the benchmark is ever given a socket: a QA case's engine runs beside the controller, and
   its host reaches the investigation only through a relay of the subcommands `RELAY` allows.
4. Designing the cases found a defect. The `engineering` workflow planned its QA step only when something the checkout
   declared could be started. With nothing to start, the step was simply not in the plan: the workflow completed, and
   nothing anywhere said that the change was never QA'd. The backlog asks for the opposite -- "QA must be reported as
   skipped, with its reason, never silently".

## Decision

### Part 1: a change's QA step is never left out silently (the engine)

The `engineering` workflow always plans its QA step. When its turn comes, the step reads whether anything the checkout
declares can be started (runtime understanding's memory, after the runtime step read the checkout):

- something can be: the step is the host's, as before -- an investigation of the running change;
- nothing can: the step is the engine's, and the engine settles it SKIPPED with its reason ("nothing this checkout
  declares can be started here, so there is no running change to investigate: QA was skipped, not passed"). Its
  verification row is `not-verified`, never satisfied. The step answer, the workflow's context and its ending name it, and
  Orbit Live's plan shows the reason where every other step shows why it is planned.

A host's word never skips a QA step: `skipped` is a verdict only the engine's own runner gives (`ENGINE.qa`,
`src/automation/dispatch.mjs`; the `skipped` row of `SETTLED`, `outcome.mjs`). An investigation's QA is the work itself
and is never skipped. A skipped step counts as done for what waits on it (`doneFor`, unchanged): whether a skipped QA
step should block a user-facing change is the owner's open question 4, and this decides only that it is never silent. A
plan an earlier release wrote with no QA step still gets one through `ENVIRONMENT_CHANGED` once discovery finds something
to start.

### Part 2: one request, three legs, all from records

A `workflow` case hands a coding host ONE request, in a person's words, to take through `/orbit-help`. It is graded on
three legs, each from records and never from the host's word:

| Leg | Holds when |
|---|---|
| **code** | the engineering kind's verifier holds what the workflow's engineering task delivered: hidden checks, the target's public tests as gates, the host's own regression test before and after, `SCOPE` -- and the engineering task completed on its own journal |
| **qa** | the QA step did what the case says it must: SKIPPED with its reason where nothing can be started; where the case's application starts, an investigation of the change found the planted defect, no false alarm on the clean application with the same change, and the change the workflow delivered is free of it (Part 4) |
| **path** | the workflow's own journal shows the request routed as the case says, one coordinated workflow, the engineering task that delivered the change its own child, every strict step SUCCEEDED on its owner's record (context reported or better) and the workflow COMPLETED |

Each record row names its leg (`benchmark/lib/workflow/judge.mjs`), so a failing run says which leg failed, and a
control says which legs it must fail on. A verdict is the engineering kind's: PASS only when the verifier passes the
delivered change AND every row holds.

### Part 3: where things run -- the change is carried, the store is never shared

- **The workflow runs in the runner**, as an engineering case's goal does: the host's plugin is the frozen Orbit beside
  the target, and `/orbit-help` (`cli/help.mjs`), the coordinator (`cli/automation.mjs`) and the engineering task
  (`cli/autonomous-engineering.mjs`) are Orbit's own, with the runner store. Every line of code the host writes runs
  there.
- **The QA leg runs beside the controller**, where Docker is. In the plugin a workflow host is handed,
  `cli/autonomous-qa.mjs` is the relay's client, as in a QA case. The relay admits ONE subcommand more in a workflow run:
  `plan` -- open the investigation of the running change. The controller then reads the change out of the runner store
  through an inspection container (no network, the store read-only), holds it to the case's `SCOPE` as a candidate whose
  every byte matches the digest the inspection reported, lays it over its own assembled application with the case's
  planted variant, and has its engine prepare that application's sandbox AS the engineering task's (the task id the
  workflow's own receipt names) and open one investigation on it. It answers the investigation's id. Never a path, never
  a sandbox the host names, never a second investigation of the same change; every other subcommand is the QA relay's own
  row.
- **The mirror.** The runner's coordinator settles its QA step on the investigation's record, and reads it from the
  runner store. Once the investigation settles, the controller copies that investigation's own journal, one way, into
  the runner store, where the coordinator reads it like any owner's record. The judge never reads the mirror: the qa leg
  reads the engine's journal beside the controller, and the path leg holds the coordinator's QA verdict to it -- a mirror
  the host rewrote is a path failure, never a pass.
- **Rejected:** the whole workflow beside the controller (its checks would run host-written code on the controller's
  machine); one store shared by the controller's engine and the runner (the engine would read settings and trust lists
  the host can write, and could be steered off isolation); a Docker socket, or a proxy of one, in the runner.

What this proves: the request entered `/orbit-help`; the coordinator routed it; the engineering task made the change in
its own workspace and its declared checks passed in the runner; the QA ran on exactly that change, in an isolated sandbox
Orbit's engine built; regression and review settled on their owners' records. What it does not prove: that the change's
sandbox was the one the engineering task would have prepared itself on a machine with Docker -- it is the controller's
engine preparing the same task's change, from the same commit, with the same isolation profile.

### Part 4: the qa leg's judge, where the application starts

The qa leg is the QA judge (ADR 0047) per investigation the coordinator's QA step settled on, with the planted
application and the clean one each carrying THAT investigation's change: a contradiction counts as found only when the
clean application with the same change satisfies the same design. One row more: the change the workflow finally
delivered is replayed against the planted application with acceptance's own reference design for the planted shape, and
must come to SATISFIED. A QA that found the defect and then passed a change that still holds it -- a second investigation
that simply did not look -- is held to have missed it.

### Part 5: the cases, the controls, the release

| Case | Request | Graded |
|---|---|---|
| `ORBIT-WF-001` | a change to the invoice application, a defect planted in the code it touches | code; qa found on the change, confirmed on clean, the delivered change free of it; path |
| `ORBIT-WF-002` | a change in the invoice application's async path, a defect planted beside it | as WF-001, on the worker |
| `ORBIT-WF-003` | a request to find out whether something works: no change | routed to `investigation`; qa found; no engineering task, nothing delivered |
| `ORBIT-WF-004` | a change to a project with nothing to start (the orders fixture) | code; qa SKIPPED with its reason, never silently; path |

Every case's controls are whole runs its scripted hosts carry in the runner, with no model and no network:

| Control | What it does | Must come to |
|---|---|---|
| `reference` | `/orbit-help` (`help.mjs --for`), the workflow it starts, every step decided in its plan's order, the engineering task driven with the control's edits | PASS |
| `idle` | nothing | NO_PROGRESS |
| `code-only` | the same entry, and stops once the engineering step settled: no QA, no regression, no review | FAIL, on the qa leg |
| `bypass` | no `/orbit-help` and no workflow: an engineering task started by hand, driven to a verified change | FAIL, on the path leg |

`orbit-workflow` is cataloged under a `workflow` requirement: its controls are required, and its model-carried rows are
recorded (ADR 0051) until the promotion rule moves them. The conformance tier runs its verifier controls in the matrix
and its scripted controls in the scripted job.

### Built in this pass, and left

Built: Part 1 with its regression tests; the `workflow` kind (`KINDS`, its flow composing the engineering kind's round,
inspection and verifier, the judge's record rows by leg, its report); the runner-side chain end to end; `ORBIT-WF-004`
with its four controls, proved without Docker over Orbit's real commands; the release policy, the conformance tier and
the docs.

Left, and not in the suite until each holds: the relayed QA leg -- the relay's `plan` row for a workflow run, the change
carried out of the runner store and laid over the controller's application, the sandbox prepared as the engineering
task's, the mirror, and Part 4's judge -- and the three cases that need it (`ORBIT-WF-001` to `003`). Their ground truth
on a CHANGED application can be settled only by running their controls in Docker, which this pass could not do; a case
whose truth no control has held is never shipped, so none of them is. The kind's schema admits only what is built
(`workflow.qa: "skipped"`, `workflow.route: "engineering"`): a case that asks for the relayed leg is refused when it is
loaded, never run on less than it claims.

## Consequences

- A change's QA is visible whatever the checkout: a person reading `/orbit-help`'s answers or Orbit Live sees a QA step
  that ran, or one the engine skipped with its reason -- never a plan quietly one step short.
- The workflow kind costs what an engineering case costs, plus the coordinator's steps. With the relayed leg, it will
  cost an investigation (and its confirmation) per QA attempt on top.
- The path leg reads the runner store, which the host can write: what makes it believable is that every strict step's
  success is the coordinator's own reading of its owner, and -- once the relayed leg exists -- that its QA verdict is held
  to the controller's own record of the investigation.
- `ORBIT-WF-004` reuses ORBIT-E2E-001's change and hidden checks on purpose: the code leg is the engineering kind's, and
  what this case adds is the path and the QA step's honesty.
