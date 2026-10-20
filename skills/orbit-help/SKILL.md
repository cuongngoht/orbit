---
name: orbit-help
description: >
  The one entry point: describe a goal and Orbit takes it through, autonomously by default with
  nothing to turn on. With a task a coordinated workflow fits (a change, a fix, a PBI, an
  investigation), it plans the workflow the task needs -- requirement, context, runtime, an
  engineering task in its own workspace, QA, regression, review, or a project playbook -- and
  takes it one decided step at a time, each step settled only on evidence its owner keeps and
  every action gated by its own class. Without a task, or for a read-only question, it is one
  bounded look at what this project's architecture, UI map, QA plans and lessons already say,
  and exactly one recommended `orbit-*` workflow with the reason. Use when it is unclear where
  to start, or to take a task all the way through.
argument-hint: where should I start | implement PBI-482 and test it until it passes
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/help.mjs*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/architecture.mjs ensure*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/engineering.mjs recall*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/automation.mjs*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/skill-factory.mjs*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/live.mjs status*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/live.mjs ensure*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/live.mjs open*)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/track.mjs*)
user-invocable: true
---

**Host binding:** On protocol v2, resolve the plugin root from this SKILL.md’s actual location and bind the host/protocol/hashed session supplied at startup on every Orbit shell invocation. Resolve command examples against that root; do not assume hook exports persist. Follow [the shared host contract](../../docs/hosts.md) for task stdin, runtime isolation and unavailable native capabilities. Use the supported native protocol for the selected host.

# First, when a PERSON invoked /orbit-help: Orbit Live beside this session

When the person typed `/orbit-help` (or asked for orbit-help by name) -- not when you chose this skill yourself, and
never for a prompt the router merely classified -- run this once, before anything else:

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/live.mjs ensure --json
```

It opens this session's full-screen Orbit Live viewer beside the session (a tmux pane, a Windows Terminal pane, or a
macOS Terminal window), or reuses the one already open: never a second one for this session. In Claude Code, Orbit Live's
pane docked in it opened as this skill started and IS that viewer: the
answer is `ALREADY_ATTACHED`, and nothing else opens. It waits a few seconds
for the viewer to say it is ready, and it always exits 0. Relay its `say` in ONE line; when `opened` is false and it
carries a `command`, give the person that command for a second terminal. Then carry on with the task -- a viewer
that could not open never stops the work. It grants nothing: it does not approve, start a sandbox or run anything,
and until a task appears it shows what this session's tools read, edit and run, as the plugin's hooks observe them
(README §4.16).
A person switches it off in Orbit Control › Advanced › Automation limits › Live (`live.open`); a headless run (`claude -p`, CI) and a
host that cannot say a person is at the session (Codex, Antigravity) get the command, never a window. Then say, in
the same line, that they can ask you to open it: when the PERSON asks ("open Orbit Live", "show me the task"), run
`node ${CLAUDE_PLUGIN_ROOT}/cli/live.mjs open` once -- their choice, which puts the viewer on the RIGHT of this
terminal where it can (a tmux pane, a Windows Terminal pane, an iTerm2 pane, or VS Code with the Orbit Live
companion) and relay its `say`; never run it on your own. Never run `live tui` or `live watch` yourself: they need
your terminal.

# When the person named a concrete task: ONE work follows it (README §4.18)

A concrete task -- something to change, fix, find out, verify or finish, named in the invocation -- is ONE work from
the moment it is asked to what it came to, whoever does it: you, in this session (`developer`), or an engineering task
or a coordinated workflow (`autonomous`). The work keeps a stable id, what is linked to it and what was REPORTED about
it; Orbit Live and Orbit Control read it as one view. Tracking itself never creates a task or a sandbox, grants
anything or runs a workflow.

**General guidance creates no work.** "Where should I start", "what does this project know" and every invocation with
no concrete task are the navigator and nothing more: do not run `track` for them.

For a concrete task, once `help.mjs --for="<the task>"` has named `NEXT` and BEFORE you hand off to it:

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/track.mjs track "<the task, in one sentence, in English>" --route=<NEXT> --because="<the BECAUSE, one sentence>" --json
```

Add `--ref=<work item>` when the task names one (PBI-482) and `--continue=<w-…>` when the person is continuing a work
you can name (`track.mjs current`, `track.mjs list`). Say the work id in ONE line -- it is the id of the request from
here on -- and carry it into whatever you invoke next (`orbit-requirements`, `orbit-develop`, an engineering task).
Asking again for the same request in the same session finds the same work; the same words in another session are
another work. If `track` says `tracked: false` (this shell carries no session mark and no `--ref` or `--continue`
named the work), or it fails, say so in one line and carry on: **tracking never blocks the work**, and a failure is
a warning, never a reason to stop.

- **Handing the work to a task.** `automation.mjs start` and `autonomous-engineering.mjs start` join the task they
  create to this session's current work by themselves (their answer carries `tracking`) and hand the work over once. A
  task started anywhere else is joined with `track.mjs handoff --to=autonomous --task=<tsk-…>`, and the work comes back
  with `--to=developer`. The id and the history stay.
- **While it goes on.** When the work waits or cannot go on, say so once: `track.mjs state --state=waiting --wait=user|permission|environment --why="<one sentence>"`
  (or `blocked`, `paused`), and `--state=working` when it moves again. Tool activity after a wait says it went on.
- **When it ends.** `track.mjs report --outcome=done|failed|cancelled|blocked --summary="<one sentence>" --proved="<what was shown, and how>" --unverified="<what was not>"`.
  The engine copies the files you changed and the checks you ran from what the hooks OBSERVED -- you cannot type
  them -- and `done` is a REPORT: the work shows `verified` only when a linked task completed in its own journal and
  nothing was edited after it. Never say verified yourself, and never put a pass or a verdict in a summary. A work
  that was closed moves again only with `track --continue=<w-…>`: a late line changes nothing.
- **Reading it.** `track.mjs status` is the one picture (lifecycle, evidence, files and checks observed, linked
  tasks, handoffs, and what this host cannot see). `track.mjs coverage` says what the host lets tracking observe.

# Ask what this project already knows before doing anything else

```bash
node <engine>/cli/help.mjs
node <engine>/cli/help.mjs --for="<the task, in one sentence, in English>"
node <engine>/cli/help.mjs --json
```

**Any Git checkout, nothing to set up (1.8.9).** There is no `init` to run and no `ui-tests/` to create: the first
`help` in a checkout SEATS the project in the machine store -- binds the checkout and writes the least a store needs
(a `project.json` naming it, the generated schemas), never a screen, a case or a guess, and never a byte in the
checkout. A checkout that commits `ui-tests/project.json` keeps it there, untouched. Where the test data lives, and
moving it between the store and the checkout, is `cli/storage.mjs` (`where`, `import`, `export`) -- and writing a
repository is a person's: an export is applied only by a person at their own terminal or in Orbit Control, never by
you, so offer them the command it prints and do not run it with `--human` yourself.

**`--for` is in English, whatever language the person wrote in.** The routing table's words are English and the
engine calls no model, so YOU restate the task: one plain English sentence that keeps what the person asked for --
find or investigate stays find or investigate, fix or change stays fix or change -- and keeps every name, screen,
id, path and work item exactly as written. Translate the meaning, never add to it; the person's own words are still
what you answer in.

Prints, in order: **PROJECT** (its name) · **STATUS** (how much of what is known rests on evidence, one word:
NOT_INITIALIZED · BLOCKED · BOOTSTRAPPED · STALE · PARTIAL · READY, with what it rests on -- BOOTSTRAPPED never means
the project is understood) · **TASK** (with `--for`: what the task is ABOUT, as the
prompt router's table classifies it -- an intent word; the task's text is never kept) · **UNDERSTANDING** (architecture facts, map
screens/edges, QA plans, lessons — counted, not listed) · **UNKNOWN** (what nothing here can
report yet, said outright rather than guessed) · **BLOCKERS** (a capability this project
cannot be held to, e.g. no `sql.command`, or a store this machine cannot write) · **CAPABILITIES** (with no task:
what Orbit can do here, one line per workflow it ships) · **NEXT** (exactly one `orbit-*` workflow) ·
**BECAUSE** (the reason, in one sentence). Relay STATUS as it is said: never call a project understood that
the engine called BOOTSTRAPPED or PARTIAL.

The recommendation is a data-driven routing table (`src/help/vocab.mjs`), not a model
guessing from prose: the first row whose condition matches the gathered state wins, and the
last row is unconditional, so a caller always gets exactly one answer. With a task: a question
about MCP servers, tools or policies goes to `orbit-control`; a task that names a work item, PBI,
issue or ticket — or any work whose requirement is not yet complete — goes to `orbit-requirements`,
which settles and keeps what the item asks for before anything is built or tested; a task about
running the project, or the place it runs in (a dev container, a port in use), goes to
`orbit-runtime`, which needs no architecture scan first; missing or
stale architecture comes first for anything that needs project context; what this project is or how it builds
code goes to `orbit-architecture`; a change to the code goes to `orbit-develop`; a project with no UI map and no
test plan, asked about nothing a QA workflow is for, gets READINESS (what Orbit can do here, and to name a task) --
never the UI-test path a project with no UI never needed; everything else follows the QA path. Follow `NEXT` — `orbit-control`,
`orbit-requirements`, `orbit-runtime`, `orbit-architecture`, `orbit-develop`, `orbit-ui-map`,
`orbit-test-plan` or
`orbit-test-suite` — rather than deciding
independently what "seems" to be missing.

**With a task, carry on — do not stop at the recommendation.** When the person named a task
(`--for`), `NEXT` is the first step of doing it, not the answer: when `NEXT` is a `orbit-*`
workflow, invoke that skill with the SAME task; when it is a command, run it, then ask
`help.mjs --for="<the task>"` again and follow the new `NEXT`, until it names a workflow. Stop
only when `BLOCKERS` says something the task needs is missing, or the workflow itself asks a
person. This is the same on every host: on a host without a prompt router (Antigravity), this
loop is what routes the task.

**`UNKNOWN` is not empty by accident.** The working set (what a session has already read,
changed and run) is recorded by the plugin's hooks; until a session has been recorded in this
checkout — the hooks are off, or nobody has worked here yet — this command says so under
`UNKNOWN` rather than reporting a state it cannot back with evidence. Nothing here should ever be
tempted to fill it with a guess.

## By default: one task, taken all the way through

Orbit coordinates a named task by default: there is no Automation switch to turn on and no mode to pick. When
`NEXT` is `node <engine>/cli/automation.mjs start` (a coordinated workflow fits the task), run it with the task,
then loop. A read-only question, or a task no workflow fits, gets the navigator's one answer instead -- answer it,
and start nothing:

```bash
node <engine>/cli/automation.mjs start --for="<the task, in one sentence, in English>" [--ref=<work item>] [--capability=<a.b,c.d>]
node <engine>/cli/automation.mjs context <task> --json        # the plan, each step's state, what is ready
echo '<decision>' | node <engine>/cli/automation.mjs step <task> --json
echo '<outcome>'  | node <engine>/cli/automation.mjs settle <task> --json   # only for a step YOU ran
```

0. **The plan is a graph.** Each step lists what it waits for (`after`), why it is there (`because`) and what it
   must prove (`verification`); several steps may be ready at once. Name a capability with `--capability` only when
   the objective plainly needs one the plan would not read off the sentence (a verification the change must pass,
   say): capability words, never a server, a tool or a URL. `plan --for="…"` shows the graph, every capability read
   and which gap each is, and what is missing and who must say it, before anything is written.
1. **Decide one ready step.** `context` lists `ready`; pick ONE of them (a workflow runs one step at a time) and send
   `{ "schemaVersion": 1, "decisionId": "<your own id>", "expectedRevision": <the revision context gave>, "action":
   { "kind": "run", "step": "<id>" }, "observed": "<one sentence>", "hypothesis": "<one sentence>" }`. A new
   decision takes a new `decisionId`; sending the same one again is answered from the journal and never runs twice.
2. **An engine step settles itself** (a frozen requirement read back, project context, runtime,
   regression and review read off the engineering task). Read the answer and decide the next one.
3. **A host step answers `how`**: `mode` (skill, agent or playbook), the provider, and `invoke` -- what
   to do. On Claude Code dispatch the named agent with the Agent tool, or run the named skill; on a host
   with no native agents (Codex, Antigravity) run the skill's own loop here, one step at a time. For a
   project `playbook`, read it with `skill-factory.mjs show <pin>` and follow it in this session.
4. **Settle it** with `{ "schemaVersion": 1, "decisionId": "<the same id>", "expectedRevision": <the
   step answer's revision>, "stepId": "<id>", "executionState": "succeeded|failed|blocked",
   "evidenceRefs": ["task:tsk-…" | "investigation:inv-…" | "requirement:rs-…" | "skill:<id>"] }`. The
   engine reads each reference back from its owner; your word alone never satisfies a step, and a
   reference this workflow did not start (another task, another investigation) proves nothing.
5. **A `propose-skill` step** means nothing here provides the workflow, and the skill factory -- safe-automatic
   by default, bounded by its budgets, instruction-only -- drafts one (reuse comes first: an active playbook that
   provides the capability is used instead): write an instruction-only SKILL.md that uses only commands Orbit documents and
   only capabilities provided here, in the SHAPE `invoke` names (a verification playbook names, for every check, the
   record a listed Orbit command reads back), put it with `skill-factory.mjs put <id> <file> --needs=<a,b>`, and
   settle with `skill:<id>`. The engine holds it to the contract and registers it; you never do. A plan may draft
   one playbook per capability: each step says which (`for`), and its draft is that capability's own.
5b. **A step that answers `replanned`** means the engine REVISED the plan on evidence -- it names the trigger: a
   playbook step nothing provided got its draft and register steps, a
   requirement that moved has the steps built on it planned again, a QA step went in once discovery found something
   to start. Read `context` again and go on from what is ready; every earlier receipt is kept, and the revisions a
   person allows are bounded (past them the answer says BUDGET_EXHAUSTED and blocks or fails, never builds on a
   stale requirement).
6. **Stop** when the answer says so: COMPLETED, FAILED, BLOCKED (it names who must act), WAITING_APPROVAL
   (a person decides in Orbit Control), PAUSED. A step whose process died is `reconcile`d -- read back,
   never sent again. Once `start` (or `resume`) names the workflow's task, run
   `node ${CLAUDE_PLUGIN_ROOT}/cli/live.mjs ensure <task> --json` once, so this session's viewer shows it (a viewer a
   person is reading a task they picked in is told, never moved; one the person closed with q stays closed until they
   invoke /orbit-help again). `context.watch` says the same for a host that shows it. A person who wants ANOTHER viewer
   asks for one: `node ${CLAUDE_PLUGIN_ROOT}/cli/live.mjs open <task>` starts it beside this session and that one
   closes itself when the task ends.

**Never**: settle a step with a success you did not read from the engine; send `outcome`, `verdict`,
`approved`, `stage` or any word the engine derives (it is refused by name); approve, resume or pass
`--human`; pass `--entry=workflow` to `live ensure` (that is a workflow's own call, which never brings back a
viewer a person closed); loop on `live ensure` until it opens; write or lift the automation settings (only a person,
in Orbit Control, does); register or activate a playbook
yourself; start a second workflow for a task that has one (`resume` finds it). Manual use of every other
`orbit-*` skill is unchanged: invoking one directly never starts a coordinated workflow.

Only a restriction a person KEPT from before autonomy was the default (`enabled` false, `mode` manual or
planning, `trigger.explicitHelp` false) makes `NEXT` the navigator's answer for a task a workflow fits; `start`
then refuses and says so (`AUTOMATION_OFF`, `PLANNING_ONLY`). Say that a person lifts it in Orbit Control ›
Health -- never try to change it yourself.

This skill never mutates anything outside a coordinated workflow's own journal. Before writing code, ask engineering memory for the task, not
for everything: `cli/engineering.mjs recall --for="<the task>"` prints the few facts that bear on
it, each with how far it may steer the work (a HINT is never a rule; a CONSTRAINT is). `facts` /
`why` / `journal <id>` show the rest and the evidence behind any one — `orbit-help` only counts.
