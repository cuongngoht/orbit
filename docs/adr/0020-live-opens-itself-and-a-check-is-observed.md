# ADR 0020 — Live opens itself for `/orbit-help`, and a running check is observed beside the task

**Status:** accepted, 1.8.5

## Context

Through 1.8.4 Orbit Live opened by itself only when `automation start` CREATED a workflow, and only when a person
had switched `live.open` on (it defaulted to off). A `/orbit-help` with no task, with Automation off, or that picked
up a running workflow opened nothing. Nothing recorded that a viewer was already open for a session, so allowing more
openings would have meant one pane per call.

A check (a declared build or test command) ran through `spawnSync`. Its output existed only after the child exited,
so what a person could see of a twenty-minute test run was a timer. The ENGINEER section had room for four checks
and nothing about what any of them was doing.

Three things constrained the design:

- `failure.mjs exactOf` decides "failed exactly as before the change" on the WHOLE output of a check. Anything that
  adds an argument, a variable or a reporter to a declared command changes that output, and a baseline taken before
  the change could no longer be compared with a run after it.
- The task's journal is its only state, and a person's decision is STALE on any material line after the revision it
  read. Progress written into the journal would move revisions and make decisions stale for a test finishing.
- The live core reads no subject. What a task or an investigation is arrives as a SOURCE its owner declares.

## Decision

1. **One launcher, one lease.** `live ensure` (`cli/live-ensure.mjs`) is the one way Orbit opens a viewer by itself,
   for `/orbit-help` (`--entry=help`) and a workflow's start (`--entry=workflow`, which `automation start` runs
   detached). It decides with `src/live/ensure.mjs` (POLICY rows: Live off, the automation settings unreadable,
   `live.open` off, `live.display` off, nobody at the session as the host says, no checkout, no session mark; and,
   among the lease RULES, asked only when a viewer would be opened, nothing here can open a pane) and keeps ONE lease
   per host · session · checkout (`src/live/lease.mjs`). The lease is reserved
   under the room's lock before anything launches, so two asks open one viewer. An opener that exited 0 is a request:
   the answer is OPENED only once the viewer itself wrote `ready` (with its pid and when that pid started), else
   STARTING. A viewer beats every five seconds, says what it shows and whether a person picked it, and records why it
   left. A workflow's ask never brings back a viewer a person closed; the next `/orbit-help` may.
2. **Presentation grants nothing.** `live.open` now defaults to on; a saved `false` stays false, a machine's false
   wins over a project's true, and turning it on enables no automation, approval, sandbox or run. A viewer that
   cannot open is an answer with the command for a second terminal, and the caller exits 0.
3. **An observation is a sidecar, never a journal line.** When the composition root binds an observer, the check
   runner runs the command through `runObserved` (the Process port: run()'s answer to the byte, the output handed to
   an observer as it arrives, one process group per run on POSIX) and writes what it reads to
   `orchestration/<task>/activity/<act>.jsonl`: an allow-listed line per event, with a sequence and a generation,
   authority `observation`. Nothing reads it to move a task. The check's receipt, its verification and failed-as-
   before are decided exactly as before, on the same output; a bounded summary rides along in the check's record.
4. **Passive adapters, honest capabilities.** An adapter reads what the declared command already prints. A protocol
   (TAP) lives in `src/orchestration/activity/`; a stack's runner (`dotnet test`, VSTest and Microsoft.Testing.
   Platform) lives in `skills/orbit-engineer/observers/`. Each says what it can show (`cases`: reported,
   failures, none; `total`: at-end, none; `order`: reported) and what it was measured on. A total is shown only when
   the runner said it, a case only as what it was reported to come to, and a command nothing reads shows its time.
5. **Delivery is a projection.** The live core gets a third source (`ACTIVITY_SOURCE`, handed in by a composition
   root). Each followed check's lines are folded, never kept, and sent as one `activity-view` frame — a whole bounded
   projection with its revision — when what it says moved. A viewer REPLACES it, so a reconnect or a late frame is
   never a duplicate and the cursor grammar did not change. Before a task's `end`, every observation is read once more.
6. **A host may dock the viewer itself.** Where a host can draw a pane of its own beside the session — Claude Code,
   through a hooks module the `orbit` plugin carries (`hooks/live-pane.tsx`, a Claude Code mod) — the pane IS the session's viewer: `/orbit-help`
   opens it before the skill runs, it asks `live pane --host=claude` every two seconds while it is drawn and draws the
   answer (the full-screen viewer's sections as segments: a header line, the overview, NOW pinned at the bottom), and
   it holds the same lease, with the opener `pane`, only while a person can see it. It honours the person's switches
   and nothing else (`live pane --auto` reads them and writes nothing), and `live ensure` asks whether anything could
   open a window only when one would be opened, so an attached pane is ALREADY_ATTACHED in any terminal. A close is
   the person's and lets the lease go; the next `/orbit-help` opens it again.

## Consequences

- Every viewer — the full-screen TUI (ACTIVITY section and the `i` inspector), `watch --plain|--jsonl`, the status
  line and Orbit Control — draws the same projection. A task from before 1.8.5 has none and shows none.
- What cannot be observed says so: no structured output, a runner that prints only failures, a sidecar budget spent,
  a runner's totals that disagree with what was observed. None of those is a failure of the check.
- Node 23 and later print the human `spec` report when piped, which is not a protocol; those commands show their
  lifecycle only unless the project asks its runner for TAP. Report files (TRX, JSON) and other runners' reporters are
  not read in this release.
- The external viewer stays the fallback for hosts that cannot show a pane of their own, and in Claude Code for a
  session whose pane is not drawn. Mods are an early-access surface of Claude Code (built against 2.1.300): the pane adds no
  word and decides nothing, so what can change under it is how it draws, never what a task does.
