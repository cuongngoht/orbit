# ADR 0013 — An orchestrator decides the next step and coordinates the owners; it owns no lifecycle

**Status:** accepted, 1.7.8

## Context
1.7.7 made a task the record of an autonomous execution (ADR 0012) and stopped before anything
drove one. Driving a task means deciding, step by step, what engineering move comes next —
settle the requirement, read the project, check the environment, prepare a place to change code,
change it, build, test, diagnose, fix, test again, review — and every one of those moves already
has an owner: requirements, work, project context, runtime, the process port, the capability
pipeline, Autonomous QA, and the task itself.

Two shortcuts were available. A second journal for "the orchestration" would have been a second
lifecycle beside the task's, free to disagree with it. And an orchestrator that did the owners'
work itself — read requirement files, start processes, decide readiness — would have been a
second runtime, a second requirements reader and a second process door.

## Decision
1. **The task journal is the only lifecycle.** `src/orchestration/` writes through the task's one
   door (`apply`, `createTask`), reads its view and events, and keeps only disposable artifacts
   beside it: a plan's scope, a check's bounded log and receipt, a tree id per attempt, which
   process is running a step, and moves a pause deferred. Each is reachable from a journal line,
   and none decides a state.
2. **The orchestrator decides what comes next; owners decide everything else.** It imports no
   subject. Requirements, work, runtime, context, the workspace's git, checks, capabilities and
   investigations arrive as ports from one composition root, `cli/autonomous-engineering.mjs`.
3. **The host's model reasons; the engine judges.** A decision is judged before anything happens
   and recorded before any side effect. It may not assert an outcome, a stage, a signature or an
   approval. The engine moves the stage, classifies a failure, signs it, derives NO_PROGRESS,
   anticipates budgets and decides completion from a table of facts the journal must show.
4. **A task owns one isolated workspace.** A local clone under the project's store, detached at the
   task's base revision, with an owner receipt written first. The primary checkout is never written,
   not even its `.git` (a linked worktree would write `.git/worktrees/`, which a sandboxed host keeps
   read-only); a workspace is removed only when its owner receipt names the task.
5. **Build and test come from the project.** A check is a command the checkout's own runtime
   understanding declared, shell-free, chosen by id and run argv-only in the workspace. Nothing a
   model writes becomes a command, and there is no command endpoint.
6. **Nothing that may have written is ever re-sent.** An action that never settled is reported,
   read back where its owner can, and otherwise closed as unknown.
7. **A person's decisions stay a person's.** Only Orbit Control grants an approval or resumes a
   paused task; a rejection is never re-asked; a cancel makes the orchestrator ask runtime to stop
   only the sessions this task started, under runtime's ownership rules.

## Consequences
- Mission Control needs no change to show an orchestrated task: it is a task.
- A later session — another host, another day — continues from the store and the repository alone.
- What the orchestrator cannot do yet is explicit: running the workspace as a runtime checkout,
  restoring dependencies, committing or pushing. Each is a later decision, not a hidden gap.
