---
name: orbit-develop
description: >
  Implements a feature, bug fix, refactor or rename in this checkout the way this project builds
  code: project context first, the smallest change, verified, reviewed. Use for a change asked for
  directly. To take one autonomously to a verified result in its own workspace, use orbit-engineer.
argument-hint: implement the change described | fix this bug | refactor this module
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/context.mjs*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/resources.mjs route*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/mcp.mjs list*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/mcp.mjs tools*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/mcp.mjs call*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/engineering.mjs recall*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/engineering.mjs why*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/architecture.mjs ensure*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/intelligence.mjs ensure*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/runtime.mjs discover*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/knowledge.mjs claims*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/knowledge.mjs why*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/knowledge.mjs verify*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/knowledge.mjs opportunities*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/requirements.mjs show*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/requirements.mjs status*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/requirements.mjs ask*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/work.mjs show*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/work.mjs need*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/work.mjs resolve*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/work.mjs settle*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/work.mjs checkpoint*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/work.mjs recall*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/track.mjs status*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/track.mjs state*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/track.mjs report*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/track.mjs current*)
user-invocable: true
---

**Host binding:** On protocol v2, resolve the plugin root from this SKILL.md’s actual location and bind the host/protocol/hashed session supplied at startup on every Orbit shell invocation. Resolve command examples against that root; do not assume hook exports persist. Follow [the shared host contract](../../docs/hosts.md) for task stdin, runtime isolation and unavailable native capabilities. Use the supported native protocol for the selected host.

# Implement a change the way this project builds code

**In short.** The developer workflow: implement a change the way THIS project builds code. Project
context first (architecture, technology, engineering conventions, project knowledge and the working
set, memory first and bounded to the task), then the resources the task actually needs, resolved by
capability, then the smallest implementation that fits, verified, then what would prove it and
whether anything here can, then reviewed. Use for a feature, a bug fix, a refactor or a rename in
the checkout. It never installs, enables or configures a resource and never provisions a missing
capability: a gap is reported as an opportunity, and a person decides.

**Orbit Live follows this workflow by itself.** It creates no task, and needs none: while Orbit Live is open beside the
session it shows what this session's tools read, edit and run -- the working set the plugin's hooks already record --
with a check RUNNING until its command ends. Do not create a task, or write anything, just so Live has something to
show; it says outright when there is nothing to observe (README §4.16).

**A work follows it, when `/orbit-help` tracked one (README §4.18).** When the task came through `/orbit-help` with a
concrete task, the work id was named there and is the id of this request: `track.mjs current` finds it again. Tracking
never changes how you work and never blocks you. When you are waiting for a person, a permission or an environment, say
so once with `track.mjs state --state=waiting --wait=<user|permission|environment> --why="<one sentence>"`, and at the
end `track.mjs report --outcome=<done|failed|cancelled|blocked> --summary="<one sentence>" --proved="…" --unverified="…"`.
The files you changed and the checks you ran come from what the hooks observed, never from you; `done` is reported,
and only a completed linked task earns `verified`. Never mark a work done to make a viewer green, and never create a
work yourself for a task `/orbit-help` did not track.

This workflow provides **`development.implementation`**. It needs **`project.context`** and
**`repository.read`**, and it can use documentation or technology context **when the task names
something that provides it**. It never names a server, a tool or a skill it depends on: it names
capabilities, and the resolver finds who provides each (`src/routing/`). Nothing below may be
skipped because it "seems" unnecessary; each step is cheap when memory is current.

## 1. Understand the task

Restate it in one sentence: what changes, where, and how you will know it works. If the task is
ambiguous in a way that changes the design, ask once — otherwise decide and say what you decided.

**When the change is to be driven to verified autonomously** — built, tested, diagnosed and fixed
in a workspace of its own, every step recorded in a task a person can pause, approve or cancel —
that is `orbit-engineering-agent`. It uses this playbook's way of building code (§4–§5) for
each change it makes.

**When the task names a work item** — a PBI, an issue, a ticket, a user story — or
`work.mjs show --ref=<its id>` finds a work already kept for it, implement FROM the settled
requirement, not from your reading of the item:

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/requirements.mjs show rs-…     # the facts, each with its status and source
node ${CLAUDE_PLUGIN_ROOT}/cli/work.mjs show --ref=<its id>   # the needs and the frontier
```

An **accepted** or **decided** fact is not yours to reinterpret or change. Something the snapshot
does not say is a **question**, never a guess: `requirements.mjs ask` puts it to a person, and the
answer is theirs. A work with no snapshot yet starts in `orbit-requirements`. Propose what the change
needs (`work.mjs need`), let the resolver bind it (`work.mjs resolve`), settle each need on evidence
(`work.mjs settle`), and `work.mjs checkpoint` before you stop. Never read a requirement's words from
anywhere but the snapshot.

## 2. Project context preflight — before reading any source

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/context.mjs --for="<the task, in one sentence, in English>"
```

It composes `project.context` **memory first**: architecture facts (and whether a scope the task
touches moved — a bounded refresh, never a full scan), the technologies in use and what each is
used for, the engineering facts that bear on the task (each with how far it may steer you: a
**CONSTRAINT** binds, a **CONVENTION** is the house style, a **HINT** is never a rule), the
**KNOWLEDGE** that bears on it, and what the latest session read and changed. It ends with the
resources the resolver chose for this task.

**KNOWLEDGE** is what this project's own concepts have to do with one another — what an operation
results in, how that is implemented *in which context*, how it can be observed — each answer with
its authority (**RULE** · **ADOPTED** · **SOURCE** · **CONFIRMED** · **HOST-MEMORY** ·
**INFERENCE**) and any conflict beside it. Read it the way it is written:

- An answer holds only **in the context shown**. `UNKNOWN … it depends on <dimension>` means the
  project does it differently in different places — find out which place the task is in; never
  pick one.
- **HOST-MEMORY** is a hint from the host's own notes: it tells you where to look, never what is
  true. Confirm it against current source before relying on it.
- A relation shown as having no role is kept and shown; nothing derives from it, and you do not
  guess what it means.

`node ${CLAUDE_PLUGIN_ROOT}/cli/knowledge.mjs why <claim-id>` shows the evidence behind any line.

**Read SUFFICIENCY before you choose the scope** — the line under STATUS. **RELEVANT** lists what the task touches
(files, symbols, components and checks: `direct`, `dependency`, `downstream`, `verification` or `unknown`, each with
its evidence and whether it is still current), from what the project already knows. **ENOUGH**: start the scope from
those items, and confirm each in the code before you rely on it — a name one of the task's words matched is not proof
the change needs it. **DISCOVER**: make the reads its targets name, once each, and nothing wider. A target's `run` is
an Orbit command: `node ${CLAUDE_PLUGIN_ROOT}/cli/<first word>.mjs <the rest>`. For `context --with-refs`, search for
what the task names, then send what you found back on stdin (`{ "task": "…", "refs": [{ "kind": "file|symbol", "ref":
"…", "why": "…" }] }`); a reference the tracked tree does not hold comes back refused, so drop it and never reason from
it. A record that moved stays named until its owner reads it again: once you have read what it cites, go on.
**ASK**: relay the one question it quotes, in the flow it names, and wait for the person; never ask one of your own
in its place.

**Three levels** follow the word, one line each (`sufficiency.levels` in `--json`): enough to **investigate** (a direct
file or symbol the tree holds), to **change** (the direct items confirmed by a read, what depends on them followed, a
done criterion stated, the check that would prove it identified) and to **conclude** (every done criterion satisfied
and unmoved, on evidence an owner verified). Each says what it still misses and how that is filled. Investigate until
`change` holds; edit nothing before it does. A name one of the task's words matched never confirms anything: read the
file, then propose it with `--with-refs` — however many names match, an unread task stays at investigate. A
developer's own session never makes `conclude` hold; say what you verified and what is left for a person.

**Relations.** Once a file is confirmed, RELEVANT follows it one hop each way: what it imports (`dependency`), who
imports it (`downstream`), the tests that go with it (`verification`), and a route-shaped literal another file shares
(class `unknown`, evidence `route-literal`): a hypothesis until you have read both ends and proposed the other file
with `--with-refs`. A `gap` line is a file no relation adapter reads: read it yourself and propose what it relates to
with `--with-refs` — never assume an edge.

**A bounded loop on the task's own work.** When the task has a work (`work.mjs show`, or `track.mjs current`), it is
the record of what you understand: record each done criterion as a `proof` need, each unknown as a `knowledge` need
(`work.mjs need <w-…>`), settle each on what you read (`blocked` when it cannot be found out here), and end every round
with `work.mjs checkpoint <w-…> --asked="<source> · <target>"` naming the targets you read. Ask for context with
`--work=<w-…>`: it prints the round state (`ROUNDS … go on`, or `STOP (budget | no-gain)`) and stops offering a target
a settled, unmoved need already answered. Stop when `change` holds, when the round state says STOP, or at a real
blocker — and say what is still missing. Another session picks it up from the same journal (`work.mjs recall
--for="<the task>"`, then `context.mjs --work=<w-…>`): a need whose files moved is offered again, and nothing else is
re-read.

- A section that says **UNKNOWN** is a gap, not permission to guess. If architecture has never
  been scanned, run `orbit-architecture` (or `orbit-help`) before designing.
- Do not Grep the whole repository to rediscover what the context already says.

## 3. Refine the requirements, then resolve resources

The context's **RESOURCES** section is the resolver's decision for this task: what is selected,
what needs a person's approval, what policy blocks, what is missing. Re-run it if the task changed:

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/resources.mjs route "<the task>" --json
```

- **Selected** — use it. A Orbit-managed MCP server is not in your tool list; reach it through the
  broker, which applies Orbit's policy, approval, timeout and scrubbing on every call:

  ```bash
  node ${CLAUDE_PLUGIN_ROOT}/cli/mcp.mjs tools <server>
  node ${CLAUDE_PLUGIN_ROOT}/cli/mcp.mjs call <server> <tool> --for=<capability> --workflow=orbit-develop --input='<json>'
  ```

- **Approval** — a server a person put under approval, or a tool that crosses a PROTECTED BOUNDARY (a push, a
  merge, a production deploy or migration, destroying production data -- refused on any direct call): say so and stop
  that branch. A push of the change goes through an engineering task's own `push` step, approved once in Orbit Control.
  Never try another route around an approval, a boundary or a policy.
- **Missing / blocked** — report it with the reason the resolver gave, and continue without it
  where the task allows. Do **not** install, enable, add or configure anything yourself: that is
  Orbit Control's, and a person's.
- Nothing selected that you did not need: an enabled server is only eligible to be considered.

## 4. Plan the smallest change

Name the files you will touch and why, the conventions and constraints from step 2 that apply,
and the test that proves it. Prefer the project's existing patterns over new abstractions.

## 5. Implement

Make the change. Keep to the plan; if the plan has to change, say why.

## 6. Verify

Run the project's own checks for what you touched — its tests, its linters, its type checker, the
gates the engineering facts name as `enforcedBy`. A change is not done until they pass; report the
output faithfully when they do not.

## 7. What would prove it — and can anything here?

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/knowledge.mjs verify --changed --for="<the task>" --workflow=orbit-develop
```

It derives what the change's consequences are and how each could be observed, asks Orbit's own
resolver who provides that, and remembers what nothing provides as a **capability opportunity**.
It never builds, installs or provisions anything, and a gap never fails the change: **development
continues**.

- **PROVIDED** — say which capability proves it; a QA workflow will use it.
- **GAP** — it is kept as an opportunity. Only a line marked **ASK** is worth raising with the
  person, once, with the reason the policy printed. Their answer is theirs to give: with their
  word, record it as `knowledge decide <opp-id> accept|defer|ignore --human`. Never decide on
  their behalf, and never run `--human` for something they did not say.
- **Not asked** lines are listed and left alone — the policy says why.

When the change established a relationship worth remembering — what an operation now results in,
how it is implemented in this context, where it can be observed — propose it as candidate claims
for `knowledge record` (one JSON object per line, citing tracked files, `strength: observed`).
The person approves that command; reconciliation decides what it does to the store.

## 8. Review

Re-read the diff as a reviewer: correctness first, then the conventions from step 2, then
anything the task did not ask for (remove it). Summarise what changed, what was verified, and what
a person still has to decide.
