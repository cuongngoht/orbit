---
name: orbit-engineer
description: >
  Take a requirement or an engineering objective to a VERIFIED change, autonomously and inside
  Orbit's governance: the requirement and its frozen snapshot first, then the project's context,
  whether the project's declared checks can run here, a task-owned isolated workspace, the smallest
  planned change, the builds and tests of what the change actually reaches (never every check the
  repository declares), a diagnosis and a fix when something fails,
  regression, a review against the plan, and completion only when the task's journal proves it.
  Every step is one decision the engine judges, records before it runs and settles with receipts,
  and Mission Control shows it as a task. Use when asked to implement, fix or finish a PBI, work
  item or change autonomously, to continue one ("continue PBI-482"), or to drive a change through
  build and test until it is verified. It never pushes, merges, deploys, writes the developer's
  checkout, runs a shell line, grants an approval or resumes a paused task.
argument-hint: '"PBI-482" | "continue PBI-482" | "<one sentence: the change to make>"'
allowed-tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - AskUserQuestion
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/autonomous-engineering.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/context.mjs*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/task.mjs show*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/task.mjs events*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/requirements.mjs status*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/requirements.mjs show*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/runtime.mjs status*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/runtime.mjs discover*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/live.mjs status*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/live.mjs doctor*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/live.mjs open*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/track.mjs status*)
user-invocable: true
---

**Host binding:** On protocol v2, resolve the plugin root from this SKILL.md’s actual location and bind the host/protocol/hashed session supplied at startup on every Orbit shell invocation. Resolve command examples against that root; do not assume hook exports persist. Follow [the shared host contract](../../docs/hosts.md) for task stdin, runtime isolation and unavailable native capabilities. Use the supported native protocol for the selected host. On Codex and Antigravity there is no native subagent: run this loop in the main session.

# Take a change to verified, one decided step at a time

**Shared references, the same for every `orbit-*` playbook.** Read the one you need; do not
re-derive what is in them:

- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/tools.md` — which host tool does which
  job, and the lines that do not move (a denied permission is reported, never routed around).
- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/storage.md` — where everything lives.
- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-engineer/protocol.md` — the decision you send
  each step and what comes back. The fields themselves: `autonomous-engineering.mjs protocol`.

You are the reasoning; `cli/autonomous-engineering.mjs` keeps the state, in a TASK. You choose
the next step; the engine judges it, writes it down before it runs, runs it through the owner of
that kind of step, records what came of it, moves the stage, and tells you when there is a reason
to stop. **You never say a change works. You send decisions; whether the build passed, whether the
tests passed, whether the change stayed in scope and whether the task is complete are the engine's
to derive from evidence.**

| word | means | never |
|---|---|---|
| **task** | one execution, its journal the only state (`tsk-…`): what Mission Control shows | a second record you keep yourself |
| **stage** | where the task is: REQUIREMENT · CONTEXT · ENVIRONMENT · WORKSPACE · PLANNING · IMPLEMENTING · BUILDING · TESTING · DIAGNOSING · FIXING · REGRESSION · REVIEWING | something you set — the engine moves it |
| **workspace** | the task's own local clone at its base revision, its path in `context` | your checkout — you never edit that |
| **check** | a build or test command the project DECLARED, chosen by its id | a command line you write |
| **attempt** | one try at the change: `fresh`, `fix`, `retest`, `retry` | free: the budget counts them |

**Two places, never mixed.** Run every Orbit command from the developer's checkout. Make every edit
in the workspace path `context` prints. A Orbit command run inside the workspace finds no task. An
edit in the checkout is outside the task, and the review will not see it.

## 0 · What it rests on

- **A work item:** the requirement and its frozen snapshot are `orbit-requirements`' (read
  `${CLAUDE_PLUGIN_ROOT}/skills/orbit-requirements/SKILL.md`). With no snapshot, `start` refuses.
  Settle and freeze the requirement there first. Never invent what a requirement leaves open: a
  blocking question blocks the task, and a person answers it.
- **"Continue PBI-482":** `autonomous-engineering.mjs resume PBI-482`. The task is rebuilt from the
  store alone, with no conversation needed. A task a person PAUSED stays paused, and only they resume
  it, in Orbit Control.
- **An ad-hoc change** with no work item: `start "<the change, in one sentence, in English>"` -- restated in English whatever language it was asked in, every name and id kept as written.

## 1 · Start

```
node ${CLAUDE_PLUGIN_ROOT}/cli/autonomous-engineering.mjs start --ref=PBI-482 [--attempts=8 --actions=100 --minutes=<n>]
```

`start` finds the requirement's newest snapshot and the work that rests on it (a work resting on an
older one is a person's choice), returns the task already running for that work if there is one,
records the base revision (HEAD — uncommitted changes in the checkout are NOT in the workspace,
and `start` says so), and reads the requirement back. Never raise a budget to keep going: a spent
budget is a stop.

**A task that starts beside a tracked work joins it (README §4.18).** When `/orbit-help` tracked this request, `start`
links the task it creates to the session's current work and hands the work over once (its answer carries `tracking`,
and `node ${CLAUDE_PLUGIN_ROOT}/cli/track.mjs status` shows the work). A session with no tracked work gets nothing
made. This is identity and a link only: the task's own journal stays the only state it has, and the work reads its
lifecycle back from it. A failure to join is a warning in the answer and never stops the task. You do not report the
work done from here: the work's `verified` is the engine's, read from this task's completion, and only the host that
asked reports its outcome.

## 2 · The loop

1. `autonomous-engineering.mjs context <task> --json` — stage, attempt, budget, `allowed`, the
   workspace path, the declared `checks` (which are `required` and which still `owed`), the
   `verificationPlan`, `latestFailure`, `completion`, `stop`, and `revision`.
2. Decide ONE action from `allowed`, from what the evidence shows. Say what you observed and your
   hypothesis in a sentence each — never a chain of thought.
3. Send it: `echo '<decision JSON>' | node …/autonomous-engineering.mjs step <task> --json`, with
   `expectedRevision` the revision you read. Read `outcome`, `failure`, `data`, `stage`, `next`.
4. Repeat. `STALE` means read the context again. `UNSETTLED` means an earlier step died: run
   `reconcile <task>`, which reads it back and never runs it again. `caught-up` means a pause held
   back a move: read the context again.

A long build or test can outlast a host's command timeout. Run `step` in the background, or with a
long timeout. If the host killed it, `reconcile` settles it once its process is gone.

## 3 · Stage by stage

- **CONTEXT** — `gather-context`: the project's architecture, conventions and knowledge, memory
  first. Read the sections it returns, and follow the engineering conventions they name.
- **ENVIRONMENT** — `check-environment`. A block names who must act. If the checkout declares no
  test, or only one that needs a shell, nothing can verify a change: report it, and point at
  `orbit-qc-builder`. If you changed what the checkout declares, run `runtime discover --rescan`,
  then check again. Use `start-runtime` only when the tests need a declared service up. What it
  starts is the task's own, and stopped if the task is cancelled.
- **WORKSPACE** — `prepare-workspace`.
- **PLANNING** — `plan` first: `intent`, the smallest change in a sentence, and `scope`, every
  repository-relative path you will touch, tests included. The task stays in PLANNING, and its
  answer and `context.verificationPlan` say what that scope reaches. That means which components and
  why, which declared checks the change is held to (`required`), which are `excluded` (NOT
  AFFECTED, NOT RUN), and what nothing declared verifies (`missing`). Then run a baseline `check` of
  every required check in the fresh workspace. A later failure is told from one that was already
  there only by its baseline, and a failure with no baseline counts as a regression. A plan can be
  sent again to change its scope. Then `implement`, which begins the first attempt. If `missing`
  is not empty, nothing can verify that part of the change. Narrow the scope if you can, and
  otherwise tell the person: the task will not complete until something declared covers it.
- **IMPLEMENTING / FIXING** — `implement`, then edit ONLY in the workspace, the smallest change the
  plan or diagnosis says, the way the project builds code (`${CLAUDE_PLUGIN_ROOT}/skills/orbit-develop/SKILL.md`
  §4–§5), then `record-changes`, which reads the change back from the workspace itself.
- **BUILDING / TESTING** — `check` with the id of a REQUIRED command still owed: its builds and
  verify commands (lint, typecheck, validate) in BUILDING, then its tests. A check the change does
  not reach is refused here. Do not try to run it to "be safe". The engine decided it is not
  affected, and a failure there is not this task's. The verification plan moves only with the change
  itself: touch another component, and its checks become owed.
- **DIAGNOSING** — read the failure: `latestFailure` (its class, confidence, signature and excerpt),
  the check step's `data.observation` (1.8.5: what its runner REPORTED while it ran -- the failing cases
  with their category and location, the counts, and any gap the observation names; never the verdict,
  which is the receipt), `log <task> <chk-n>` (or `<sbx-n>` for an application a sandbox started that
  stopped by itself) for more, and the workspace's code. Make ONE hypothesis. A `low`-confidence
  class is a hint, not a fact. Then `diagnose` with `then: "fix"` (change something), or
  `"retest"` (the same change again, when the failure looked like the machine's, not the code's).
- **REGRESSION** — `check` every required test still `owed` since the last change. A required check
  that failed exactly as at its baseline (`failed-as-before`) is settled. It stays visible, and it
  is never a pass. At least one required test or verify command must pass for the change to count as
  verified.
- **REVIEWING** — read your own diff (`git -C <workspace> diff <baseRevision>`) against the
  requirement and the plan, then `review`. Anything outside the plan's scope fails it, and the loop
  diagnoses that like any failure. When every completion row holds, the engine completes the task
  itself.

When the change needs to be seen RUNNING (a screen, an API), run it in the task's SANDBOX and let an
investigation look at THAT (`orbit-qa-agent`). The sandbox is an environment the task owns,
started from the workspace's changed code and never from the developer's checkout:
`prepare-sandbox` prepares it, and `start-sandbox` brings the declared application up in it (and
prepares it first, and replaces a stale one). The context says when it is worth doing (`next`),
and prints `SANDBOX`, `APP` and `NETWORK` once the task has one. Then ask the investigation for it
with `orbit-qa-agent plan --sandbox=<environment from the context> …`, and link its id with
`link-investigation`. Its own words are kept, never translated into a pass.

Live evidence names the source tree it was taken from. If the workspace moved since (the context's
`QA` line says `stale`, and which row), start the sandbox again and investigate again: an
investigation of code that no longer exists proves nothing about the change. A checkout that
declares nothing to run (a library) has no sandbox, and is told nothing about one. A sandbox a
person has not trusted yet blocks the task, `needs person`: say so, and wait for Control. You never
trust it yourself, and no step carries a port, a provider or a directory — a sandbox picks its own.

## 4 · When the engine says stop

| stop | what you do |
|---|---|
| `blocked` (needs requirement · environment · capability · person) | Tell the person what it needs, in its words. Only the recheck it allows may run. A sandbox that waits for a person (`needs person` after `prepare-sandbox` or `start-sandbox`) is trusted in Orbit Control, never by you; once they have, `prepare-sandbox` lifts the block. |
| `waiting-approval` | Tell the person which action waits in Orbit Control → Mission Control → Approvals, and why. Poll `context`. Once granted, send the SAME action with `"approval": "apr-n"`. |
| `paused` | Stop. Only a person resumes, in Control. |
| `no-progress`, `budget` | The engine has already ended the task. Report why, with the signature and what you tried. |
| `cancelled` | The engine already asked runtime to stop what the task started, and released its sandbox. Report it, and do nothing else. |
| you cannot go on | `finish <task> --stop=<REASON> --because="…"` — refused unless the journal supports that reason. |

## 4½ · Watching it: Orbit Live

A person sees the task without opening Orbit Control (README §4.16): in Claude Code's status line, once they
installed it, and in any terminal with `node <engine>/cli/live.mjs watch` -- or full screen with `live tui`, which a
person runs in a SECOND terminal or pane (never run it yourself: it needs the terminal you are in). When they ask to
WATCH the task, run `node <engine>/cli/live.mjs open <task>`: it starts that viewer beside this session (a tmux pane,
a Windows Terminal pane, or a macOS Terminal window) and returns at once, and the viewer closes itself when the task
ends; where it can open nothing it prints the command -- pass it on. Never open one unasked. All read the task's journal; you
write nothing for them. A viewer knows a task as this session's when its `create` ran in a shell carrying this
session's mark (exported at session start); otherwise it shows the one task running in the checkout, and when two
run there, a person chooses with `live pin <task>` -- never pin for them. `live status` is the same few lines,
once, if you need to say where the task stands. Installing the status line is the person's
(`node <engine>/cli/host.mjs render --host=claude --kind=statusline`, then `apply ... --human`): offer the
command when they ask to see progress in Claude Code, and never run `apply` yourself.

## 5 · Handing over

The task completes only on evidence. Then report the task id, the workspace path and its base
revision, the attempts (each with its outcome and signature), the checks that passed after the last
change, the review, and anything a person must still do. Committing the workspace's change, opening
a pull request, merging and deploying are a person's: the workspace is a clone of its own, so a person
takes the change with `git fetch <workspace path> HEAD` from their checkout. `remove-workspace <task>` is theirs to ask for.
`cleanup` has already stopped the task's sessions and released its sandbox.

## Never

- edit the developer's checkout, run Orbit from inside the workspace, or edit outside the plan's scope
  without diagnosing why;
- write a command line, a shell script or an argument for a check: a check is a declared command
  by id;
- put an outcome, a verdict, a stage, a signature, a confidence or an approval in a decision;
- pass `--human`, approve, resume, or ask again for an action a person rejected;
- resend a step that did not settle: reconcile it;
- raise a budget, start a second task for the same work, or call a task done that the engine did
  not complete;
- push, merge, deploy, or write anything a person has not asked for.
