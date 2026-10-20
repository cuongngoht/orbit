# ADR 0012 — A task is an execution of a work, kept as a journal, and governed by single-use approvals

**Status:** accepted, 1.7.7

## Context
A work (ADR 0010) answers what doing a requirement needs: needs, bindings, receipts. Once something
autonomous starts *doing* it, a second question appears that a work cannot answer without becoming
something else: what happened while trying — which attempt is running, what the agent decided and
why, what Orbit holds a receipt for, what is blocked, and what a person may stop, approve or reject.

Three shortcuts were available and each would have cost more than it saved: extending the work into
an executor (one journal answering two questions, and a requirement's one work turned into its many
attempts); reading the session trail as task state (it is fail-open, capped and pruned by design);
and a machine-wide database of everything (a second truth beside every domain store).

## Decision
1. **A task is its own subject (`src/task/`), and it references a work; it never is one.**
   - One journal per task, in the project's machine store (`<storeRoot>/tasks/<tsk-id>/`), never
     in a repository. Many tasks may exist over a work's life; one may be ACTIVE per work and checkout.
   - A task keeps ids of what it rests on — work, requirement root, snapshot and its digest, base
     revision, workspace, provider — and copies none of their contents.
2. **The journal is the only state, and everything is derived from it.**
   - Append-only, an allow-list of fields per kind, free text bounded and scrubbed, a schema on the
     first line that a newer engine's journal is refused by.
   - Lifecycle, stage, attempt, stop reason, readiness and every view come from one fold. Nothing
     mutable is stored beside it, so nothing can drift from it.
   - A revision is the journal's position. A person's decision names the revision it was made on.
3. **Lifecycle is small; stages are not lifecycle.** Ten lifecycle states, twelve engineering stages,
   and a stop reason that says why a task is blocked or failed instead of one generic FAILED.
4. **Attempts, decisions and receipts are first-class.**
   - Attempts carry their cause, outcome and failure signature, so repetition is visible as data.
   - A decision is a short, structured summary — observed, hypothesis, next action, evidence,
     reason — and never a chain of thought, a prompt or a response.
   - A receipt is a reference to the domain that owns it (`domain:ref`, its own outcome word). An
     action without one is shown as *reported*, never as proven; a verification of `satisfied` or
     `violated` must cite one.
5. **An approval is task-scoped, action-scoped, fingerprint-bound and single-use.**
   - The fingerprint hashes the action's type, tool, environment and parameters; the parameters are
     never stored. A changed action cannot reuse an approval.
   - Approve once, or reject, is a person's, made on the revision read. A decided approval cannot
     be decided again; a granted one is consumed exactly once, written before the action it allows;
     an expired one is refused. Nothing creates a standing permission.
   - A decision that ALLOWS something -- approve, and resume after a person's pause -- is written
     only through Orbit Control, whose page proves a person with its mutation token. A terminal
     cannot prove who typed `--human`, and an agent that asked for an approval could otherwise grant
     it to itself. From a terminal a person may only stop work: pause, cancel, reject.
6. **A person's decision is refused on a materially moved task.** Material is a column on the
   journal's kinds: attempts, actions starting, approvals, blocks, pauses and endings are; decisions,
   changed files, receipts and finished actions are not. No last-write-wins, no silent retry.
7. **The machine view is a projection, not a store.** It reads the Project Registry's known projects
   and their task journals, scans no directory, writes nothing, and keeps no index.
8. **The session trail may carry a projection of task moments (ids and counts), and is never read
   back as task state.**

## Consequences
- An orchestrator can be built on this without a second data model: it records through
  `cli/task.mjs`, asks for approvals, consumes them by fingerprint, and reads where it stands from the
  same fold a person's page reads.
- Pausing never pretends a running action was interrupted, and cancelling never stops a process; the
  journal can still record what an already-running action came to.
- A task can always be read and governed from Orbit Control, even when its checkout's folder is gone,
  because it lives in the store and is addressed by the registry.
