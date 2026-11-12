# Orbit

**From Goal to Verified Outcome**

Orbit is a plugin for AI coding hosts — **Claude Code**, **Codex**, **Antigravity CLI** and **Grok Build**. You describe a
goal (a PBI, a bug, an engineering objective); Orbit takes it through requirements, planning, implementation, testing and
review, and calls it done only when there is **evidence** that it is done.

- **Local and private** — every piece of state lives on your machine, outside your repository. No cloud service.
- **Autonomous by default** — Orbit works on its own; a person is asked only at a small set of **Protected Boundaries**
  (writing your checkout, a git push, a production deploy or migration, destroying production data).
- **Governed** — each action is checked by deterministic engine rules; the boundaries, catalogs and limits are a person's.
- **Evidence-based** — a step is verified only by a record its owner keeps (a passing check, a test run, a QA report).
- **Zero dependencies** — the engine is plain Node.js (≥ 20) with no npm packages.

## Contents

1. [Install](#install)
2. [Quick start](#quick-start)
3. [How Orbit works](#how-orbit-works)
4. [Skills you can call](#skills-you-can-call)
5. [Command line](#command-line)
6. [Where your data lives](#where-your-data-lives)
7. [Orbit Live and Orbit Control](#orbit-live-and-orbit-control)
8. [Feature guides](#feature-guides)
9. [Developing Orbit](#developing-orbit)
10. [Further reading](#further-reading)

---

## Install

**Requirements:** Node.js 20 or newer. Nothing else — the engine has no npm dependencies.

### Claude Code

```bash
/plugin marketplace add cuongngoht/orbit
/plugin install orbit@orbit
```

### Grok Build

```bash
grok plugin install cuongngoht/orbit --trust
# or from a local clone:
grok plugin install /path/to/orbit --trust
```

`--trust` lets Grok run the plugin's hooks. Details: [docs/grok.md](docs/grok.md).

### Codex

From a clone or an unpacked release:

```bash
codex plugin marketplace add <plugin-root>
codex plugin add orbit@orbit
```

Installing does not trust the hooks — review and trust them in Codex afterwards. Enable only one Orbit installation per
workspace. Details: [docs/codex.md](docs/codex.md).

### Antigravity CLI

```bash
agy plugin install <plugin-root>
```

Details: [docs/antigravity.md](docs/antigravity.md).

### Local development (from this repository)

```bash
claude --plugin-dir .
```

### Check the install

```bash
node <plugin-root>/cli/orbit.mjs doctor      # goals store: where it is, how many goals
node <plugin-root>/cli/query.mjs doctor      # are this project's declared tools usable here?
```

How each host binds the plugin root and the session: [docs/hosts.md](docs/hosts.md).
Repository: [github.com/cuongngoht/orbit](https://github.com/cuongngoht/orbit) (public, MIT).

---

## Quick start

1. **Open your product repository** in the host where Orbit is installed. Nothing is written into the repository —
   Orbit seats the project in its machine store the first time you use it.
2. **Not sure where to start?** Run `/orbit-help`. It looks at what Orbit already knows about the project and either
   takes your task through a coordinated workflow or recommends exactly one skill, with the reason.
3. **Have a full goal?** Run `/orbit` with the whole specification — a PBI, acceptance criteria, a bug report:

   ```text
   /orbit Implement PBI-482: refunds over 30 days require a manager's approval. Acceptance criteria: …
   ```

   Orbit keeps the goal as submitted, analyzes it, plans work units, executes them through its owners, verifies
   against evidence and reports.
4. **Watch it work** in **Orbit Live** (opens beside your session). Normal development needs no approval; when work
   reaches a [protected boundary](#protected-boundaries), decide it in **Orbit Control** (`/orbit-control`).

---

## How Orbit works

```text
 Goal ──► Requirement ──► Plan ──► Task (own workspace) ──► Checks / QA ──► Evidence ──► Report
  │         snapshot       units    build · test · fix        verified by       kept by
  │                                                           their owner       its owner
  └── kept on your machine, in the Orbit store — never in your repository
```

A few ideas run through everything:

| Idea | What it means for you |
| --- | --- |
| **The host reasons, the engine keeps state** | The AI model decides the next step; the engine judges it, records it before it runs, and settles it with receipts. |
| **Every artifact has one owner** | A requirement, a task, a check, a QA investigation each own their records. Nothing re-judges another owner's verdict. |
| **PASS is earned** | No verdict executed means `INCONCLUSIVE`, never a pass. A failure that existed before your change is shown as `failed-as-before`, never hidden. |
| **Your repository is untrusted data** | Orbit runs only commands your project files declare, as argument lists, never a shell line a model wrote. |
| **Changes happen in isolation** | An engineering task edits its own workspace (a local clone) and commits there, never in your checkout. |
| **Autonomous by default** | Building, testing, QA, sandboxes, containers, local databases and local commits run without asking anybody. |
| **A person decides at the boundary** | A push, a production deploy or migration, and destroying production data wait for one approval of exactly that action in Orbit Control; writing your checkout is yours alone. An agent cannot approve its own action. |
| **No product knowledge in the engine** | Products, vendors and stacks live in your project's data, or in adapters and packs a project opts into. |

---

## Skills you can call

You can name any of these yourself, and Claude Code also picks them by itself: it reads each skill's description, so
every description says *when* to use it in its first sentence and stays within the host's listing budget (at most 300
characters, 7,500 for all 26). `test/activation-catalog.test.mjs` holds that, and that each first sentence carries a
word that brings a prompt to the skill.

Beside every prompt, Orbit's prompt router says how much Orbit the request needs, in one line, or nothing at all
(RouteDecision v3, ADR 0050). **NONE** adds no text: a prompt you opened with a slash command yourself
(`/orbit-help fix the refund rule` -- you already chose what runs), a greeting, a status question that asks for nothing
else ("how far along are we?", "tới đâu rồi"), a background task's notification the host delivers as if it were a
prompt, an opt-out ("without Orbit", "không dùng orbit"), or anything the session already does itself. **DIRECT** names the one
skill or agent that fits. **COORDINATED** gives the one command for a change you ask for that several owners take in
turn -- a work item to settle, or an investigation or a security check to prove it (`/orbit-help`'s workflow) -- or for
a whole specification (`/orbit`'s goal); a question that only names code ("is the orders endpoint protected?") asks for
no change. **SATELLITE** is only ever a mission you asked for, and **RESUME** picks up an open work of this checkout
through its owner. English and Vietnamese are read alike, words past the first 2,000 characters -- a pasted log or file
-- never decide what a prompt is about, and a one-word match is said only when it is a skill's own word. The router
suggests; Claude decides. `test/fixtures/routing/corpus.jsonl` holds it to realistic prompts in both languages.

Since 0.6.0 a FACT about the session's work brings a skill or agent in as well as the prompt's words, and never a word
the engine guessed ([ADR 0059](docs/adr/0059-proactive-execution-from-facts-said-once-and-explained.md)): a check the session ran after its edits failed (`check.failed`), the same check failed
three times in a row with nothing changed between (`check.repeats`, said once as no progress), or the session's tracked
work has a knowledge need nobody answered (`knowledge.owed`). A catalog row names the facts its playbook handles
(`reactsTo`), and a fact that holds counts for it as one of its words would -- so a check that failed after the last
prompt shapes the next prompt's decision.

The rest of a session follows its work through, a line at a time and only where Orbit owns the work (0.5.0, ADR 0050):

- **Session start** (a checkout Orbit knows): one line of at most 300 bytes -- each family's usable count, what you
  switched off, and the project's STATUS word -- and, on a resumed or compacted session, its open work and next step.
- **After one of Orbit's agents returns**: one line naming the owner record that settles its work (the workflow, goal,
  mission or task) and where it stands. What the agent said is its report, never the evidence; its message and
  transcript are never read.
- **After an Orbit command fails** under the session's governed work: the owner's recovery row, beside the usual
  diagnosis -- an action that did not settle is read back with `reconcile`, never sent again.
- **After any tool call fails** (0.6.0): at most one line of advice -- the fact that holds, its subject, the skill or
  agent that handles it and the call that brings it in -- or nothing. An ordered silence table keeps it quiet when the
  host cannot carry a line, the trail is off, your prompt said stop, nothing holds, the same fact was said already this
  session, this prompt had its line, your governed work is paused or waiting for you, or nothing here handles it.
  Nothing is said after a call that succeeded.
- **At Stop**: when the session's own coordinated workflow or goal is still running with a step ready, Claude Code's
  turn is held open -- at most twice per prompt, never twice in a row -- with the step and its one command, or the
  model says in one sentence why it stops. Never past your pause, cancel, approval or question, never after a turn
  that only answered a question, never when your prompt said stop or wait, never with the trail off; switch it off in
  Orbit Control › Advanced › Automation limits (`trigger.holdOnStop`). The hold starts and grants nothing.
- **At Stop, after edits nothing checked** (0.6.0): a turn that edited code a component of this checkout owns, with no
  passing check after the edit, is held open once per prompt, naming the safe check that component declares and its
  command -- or the model says why it stops. It runs nothing, and never holds after a halt cue, past a paused or waiting
  work, beside the workflow hold, or for a path nothing speaks for. With no declared check, it names the tracked test
  files Orbit's relation adapters link to the edited files instead, by the test patterns the checkout declares (pytest's
  `python_files`), else the default (the files, never a command, and a regression test
  where none covers the change). On by default; switch it off in Orbit Control (`trigger.holdUnverified`).

`node cli/trace.mjs activation` reads back, per turn and per work, how a suggestion became an outcome: suggested →
selected → dispatched → executed → verified, each from its own source, with only the owner's record ever verified, and a
turn that dispatched more of Orbit's agents than its strategy accounted for marked **over-delegated**. A line of advice
after a failed call is kept as `advice.given` (the fact, its subject, the provider and its kind, never the sentence) and
counted as suggested.

### Entry points

| Skill | Use it for |
| --- | --- |
| **`/orbit`** | Full goals: multi-step work, PBIs, acceptance criteria — analyze → plan → execute → verify → report. Pass the complete specification (stdin or `--file` on the CLI). |
| **`/orbit-help`** | Where to start: one bounded look at what the project already knows and one recommended workflow, or a coordinated workflow for a concrete task. Continues tracked work. |
| **`/satellite`** | Autonomous multi-agent missions: a goal taken through a revisable work graph of fresh agent runs, each with least privilege, settled on independent evidence. |

### Engineering

| Skill | Use it for |
| --- | --- |
| `orbit-requirements` | Turn a work item, PBI, issue or ticket into atomic requirements and one immutable snapshot; ask a person only what blocks. |
| `orbit-engineer` | Take a requirement to a **verified** change autonomously: own workspace, smallest change, the builds and tests it reaches, diagnosis, review. |
| `orbit-develop` | Implement a change the way *this* project builds code, using its architecture and conventions. |
| `orbit-runtime` | What a checkout needs to run, whether this machine can run it, and how — for any stack. |
| `orbit-architecture` | An evidence-backed architecture snapshot, recalled from memory and rescanned only when stale. |
| `orbit-reverse-engineer` | Map a system's running parts (components, interfaces, channels, stores) into a system graph. |
| `orbit-dotnet` | Which technologies a .NET solution declares and what its code actually uses each for. |
| `orbit-research` | Answer a technical question from a source, for the version this project's manifest pins, and keep the answer as knowledge scoped to that version (0.6.0). |
| `orbit-learn` | Lessons from repeated evidence across independent sessions. |
| `orbit-improve` | Improve this project's playbooks and Satellite roles from what they did: a successor compared with the version it would replace in independent sessions, promoted through gates, rolled back on regression. |

### Quality and testing

| Skill | Use it for |
| --- | --- |
| `orbit-qa` | Investigate a live application like a senior QA engineer, from a screen, a PBI, or both. |
| `orbit-test-plan` | Decide *what* to test with a person before any case is written: risk-ranked scenarios. |
| `orbit-ui-test` | Author or run one JSON UI test case through `playwright-cli`, verifying UI, API and SQL. |
| `orbit-test-suite` | Run an agreed set of cases with evidence and one review page for the session. |
| `orbit-ui-map` | Fill and correct the UI map (screens, controls, effects) every case points into. |
| `orbit-ui-explore` | Explore a live screen when the map is thin; leave candidate map records and cases. |
| `orbit-browser` | Pick a browser and signed-in profile on this machine for a test session. |
| `orbit-sql` | Read a SQL Server database from a test (read-only, through `sqlcmd`). |
| `orbit-qc-builder` | Build the smallest project-local QC tool an agreed test needs. |
| `orbit-security-audit` | Assess a project against the security catalogs it is held to, from evidence. |

### Operations

| Skill | Use it for |
| --- | --- |
| `orbit-control` | Start Orbit Control, the local control panel. |
| `orbit-report` | A product owner's project report from GitHub or Azure DevOps, computed from a frozen snapshot. Azure DevOps signs in with your Microsoft account by default ([how](#microsoft-sign-in-for-azure-devops)); GitHub reads with a token. |
| `orbit-release` | Ship a new version of Orbit, or install it in another repository. |

Role agents each do one bounded job in a context of their own. Five may be dispatched by the session directly when that
job is the whole request: `orbit-engineering-agent`, `orbit-qa-agent`, `orbit-failure-analyst`, `orbit-dsl-doctor` and
`orbit-engineering-observer`. The other fifteen -- the architecture scanner, the reverse-engineering agent, the security
auditor, the map healer and recorder, the QA case writer, the five requirement roundtable agents and Satellite's four --
are dispatched only from their parent skill's playbook, because each needs that skill's step before it: their catalog
row names the parent (`via` in `catalog/components.json`), the router never offers one on its own, and the parent's line
in the routing context names the agents it dispatches.

---

## Command line

Every skill is backed by a CLI under `cli/`. The reliable form on any host is `node <plugin-root>/cli/<tool>.mjs …`.

```bash
# Goals
node cli/orbit.mjs goal start --stdin < goal.txt      # keep a goal as submitted
node cli/orbit.mjs goal analyze <goal-id> --stdin      # the host's reading, as JSON; a row with no kind is an assumption, one with no sourceRef cites none
node cli/orbit.mjs goal status <goal-id>               # where it stands
node cli/orbit.mjs goal plan|resume|step|verify|report|list <goal-id>
node cli/orbit.mjs doctor

# Where to start
node cli/help.mjs --for="<task>"                       # one recommended next step, and why

# Requirements, work and tasks
node cli/requirements.mjs resolve <ref>                # find a work item
node cli/autonomous-engineering.mjs start --ref=<item> # a task taken to a verified change
node cli/task.mjs list                                 # tasks on this machine
node cli/task.mjs why <task> [--json]                  # each decision, how it settled, what moved the task next (0.6.0)
node cli/work.mjs checkpoint <w-…> --asked="<source · target>"   # one round of discovery: what it asked (0.6.0)

# Project knowledge
node cli/architecture.mjs ensure                       # is the architecture snapshot current?
node cli/runtime.mjs discover                          # what this checkout needs to run
node cli/context.mjs --for="<task>" [--json]           # what the task touches, and whether that is enough (0.5.0)
node cli/context.mjs --with-refs --json < refs.json    # the same, with the files and symbols you propose, verified
node cli/context.mjs --for="<task>" --work=<w-…>       # with the round state of the task's own work (0.6.0)

# Live view
node cli/live.mjs status                               # Orbit Live in a terminal
node cli/live.mjs status --json                        # session.agents: which agent did what (0.2.2)

# How sessions used Orbit
node cli/trace.mjs usage                               # counts with their denominators; per agent, as the host says (0.2.2)
node cli/trace.mjs activation                          # suggested → selected → dispatched → executed → verified (0.5.0)

# Self-improvement (0.3.0)
node cli/improve.mjs status                            # switches, opportunities, campaigns
node cli/improve.mjs analyse [--dry]                   # what the owners' records show; one opportunity per problem
node cli/improve.mjs resume <imp-id>                   # a campaign stepped until it needs the host, a person or a session
node cli/improve.mjs evaluate <imp-id>                 # the candidate beside the version it would replace, this session
node cli/improve.mjs metrics                           # nine metrics, each with its numerator and denominator
```

Exit codes across the CLIs: `0` done · `1` failed · `2` refused · `3` blocked · `4` inconclusive.
The full command reference is in [AGENTS.md § Commands](AGENTS.md#commands).

> **Trying commands inside this repository?** Set `ORBIT_STORE_DIR=/tmp/orbit` first — everything writes to
> `~/.orbit` by default.

---

## Where your data lives

All durable state lives **outside your product repository**, in the machine store:

| What | Location |
| --- | --- |
| Default | `~/.orbit/projects/<project-key>/` |
| Override | `ORBIT_STORE_DIR=/path/to/base` → `/path/to/base/<project-key>/` |
| Show paths | `node cli/query.mjs storage --json` or `node cli/storage.mjs where` |

- **Test data** (`ui-tests/`) defaults to the store. A team that commits test data with its code can explicitly choose
  the checkout instead (`init --in-checkout`, or `storage export --all --move`).
- **Reports, evidence, lessons, goals, tasks, generated playbooks and improvement campaigns** always stay in the store.
- Checkouts of the same repository share one store; runtime sessions are isolated per checkout.
- Reading never creates state; writes are contained, locked and checked for stale revisions.

---

## Orbit Live and Orbit Control

### Orbit Live — see what is happening

A **read-only** viewer beside your session, fed from the same journals the engine keeps (tasks, goals, checks).
`/orbit` and `/orbit-help` open it: a docked pane in Claude Code, a terminal split or a window elsewhere.

- The badge says what the task is doing — `ORBITING`, `IDLE`, `BLOCKED`, `COMPLETED` … — and only on evidence.
- The animated orbit in the header is the viewer's motion, never progress.
- The pane shows tabs per view, `TASK EXECUTION` with `NOW`, the baseline as a card, a workflow's milestones under
  their step, and a footer of bars.
- Settings: `pane.widthPercent`, `pane.focusCli`, `pane.animation: off` (keep it still), `pane.orbitSpeed`
  (`slow` · `normal` · `fast`).
- **Which agent did what** (0.2.2): where the host names the subagent that made a call (Claude Code), the session's
  activity is grouped per agent — its type, whether the host says it started or stopped, its calls, which agent or the
  session launched it, and the mission run it carries. The session's own calls stay apart, and a coverage line says what
  this host lets the hooks see. A declared playbook's run shows its id, its attempts and `RUNTIME_BOUND`.
- **Self-improvement** (0.3.0): an evaluation task shows its campaign in an `IMPROVE` section — the phase, both
  versions, the verdict and the gates.

```bash
node cli/live.mjs status        # print once
node cli/live.mjs watch         # follow in a terminal
node cli/live.mjs tui           # full screen
node cli/live.mjs open          # open beside this session (tmux · Windows Terminal · macOS window)
```

**VS Code:** install the companion under [integrations/vscode-orbit-live](integrations/vscode-orbit-live)
(machine-scoped settings: `orbit.live.storeDirs`, `orbit.live.nodePath`).

### Orbit Control — decide and configure

A local panel (loopback only) for skills, MCP servers, tools, report connections (their credential, or their Microsoft
sign-in), automation limits, security catalogs, self-improvement (Advanced → Improvement) and the protected actions
waiting for a person. Start it with
`/orbit-control`. Orbit never adds, enables or approves an MCP server, a policy or an approval by itself — a person does
it here. The one thing it fetches on its own is a pinned, checksum-verified private runtime that work you asked for
needs (see [Microsoft sign-in](#microsoft-sign-in-for-azure-devops)).

### Protected boundaries

Orbit is **autonomous by default**: it inspects, plans, edits its own workspace, builds, tests, runs QA, prepares its own
sandbox (restoring dependencies and building containers there), uses local databases and commits locally without asking.
Normal development activity does not require approval. A person is asked only where work would leave that boundary
([ADR 0042](docs/adr/0042-autonomous-by-default-protected-boundaries.md)):

| Action | Policy |
| --- | --- |
| Task workspace write, local commit | AUTO |
| **Primary checkout write** (`runtime adopt`) | DENY — you do it yourself, in Orbit Control (no terminal or agent can) |
| **Git push** (the exact repository, remote, ref, commit, force) | approve once in Orbit Control |
| Local, development, preview, staging deploy | AUTO |
| **Production deploy** (the exact artifact, revision, target) | approve once |
| Local, test, sandbox database migration | AUTO |
| **Production database migration** (the exact migration and digest) | approve once |
| Destructive change on a local or test database | AUTO |
| **Destructive production data** (delete, truncate, drop, purge, reset, or a production write nobody declared) | approve once, marked **DESTRUCTIVE** |
| Everything else | AUTO |

An approval is for ONE action: a changed commit, ref, remote, artifact, revision, target or digest asks again; it is
spent before the action starts and never twice; a rejected or expired one runs nothing. What is production is what you
or your project **declared** (a capability's `environment` and `effects`, a QA environment's kind), never a guess from a
command — and unknown is never production.

---

## Feature guides

### Project context: what a task touches, and whether that is enough

`context --for="<task>"` is what `orbit-develop`, `orbit-engineer` and `orbit-help` read before they choose a scope.
Memory first, it composes the architecture, technology, engineering, knowledge, work and working-set sections, and
since 0.5.0 two answers about the task itself:

- **RELEVANT** lists what the task touches, from what the owners already hold: architecture's modules, boundaries,
  system-graph nodes and gates, intelligence's integrations, what engineering and knowledge recall for the task, the
  working set, and, once the paths are known, what the change reaches and which declared checks hold it. Each item is
  a `file`, `symbol`, `component` or `check`; its class is `direct`, `dependency`, `downstream`, `verification` or
  `unknown`; it names its evidence and its freshness, measured against each record's own scope (never HEAD); and it
  says who found it, `engine` or `host-verified`. At most 40 are listed and the rest counted. Names are matched with
  identifiers split (`createOrder` is "create order"), with no embeddings and no parsing of any language.
- **SUFFICIENCY** is one word: `ENOUGH` (proceed, starting from those items), `DISCOVER` (with the targeted reads that
  would fill the gap, never a full scan; each target's `run` is an Orbit command, `node <plugin-root>/cli/<first
  word>.mjs <the rest>`, and a read already made that would find the same nothing is never named again) or `ASK` (a
  question about the task's own work is already open: a requirement's blocking question, or a goal's missing
  prerequisite, on a work or goal the task names by id or whose objective is mostly the task's own words). Orbit never
  makes a question up, and only a person answers one.

A host proposes what it found with `--with-refs`: `{ "task": "…", "refs": [{ "kind": "file|symbol", "ref": "…",
"why": "…" }] }` on stdin. A file is checked against the tracked listing, and every proposed symbol by ONE whole-word
search of the index; one the tree does not hold is refused by name and never listed. Composing RELEVANT and
SUFFICIENCY writes nothing: only the sections' own memory-first commands refresh what they keep.

**Three levels (0.6.0, [ADR 0058](docs/adr/0058-a-task-knows-enough-by-levels-on-its-own-work.md)).** SUFFICIENCY also answers, level by level, whether the task knows enough to
**investigate** (a direct file or symbol the tracked tree holds), to **change** (the direct items confirmed by a read,
what depends on them known or said unknown, a done criterion recorded as a `proof` need on the task's own work, and the
check that would prove it identified) and to **conclude** (every proof need satisfied, nothing it rests on moved since,
and the work's evidence `verified` by an owner's completed task). Each level is one ordered table over facts, never a
count of search hits: it says the row that stops it and everything it misses, with the command that fills each. A name
the task's words matched is a candidate, never confirmed, however many there are.

**Relations, one hop each way.** RELEVANT follows each direct file to what it imports and to who imports it, and to the
tests that go with it -- read from the tracked tree, on demand, never a graph of the repository. What a file names is a
language's, so it is read by relation adapters in a pack (JavaScript/TypeScript and Python ship in
`skills/orbit-develop/relations/`). A route-shaped string two files share is a hypothesis you verify by reading both; a
file no adapter reads is a gap you fill by reading it and proposing what you found with `--with-refs`.

**A bounded discovery loop.** Discovery is recorded on the task's own work: its done criteria are `proof` needs, its
gaps `knowledge` needs, and each round is a checkpoint that keeps what it asked (`work checkpoint <w-…> --asked="<source
· target>"`, as the package printed it). `context --work=<w-…>` reads the rounds back: they stop after five, or after two
in a row that settle nothing new, and a target already answered is not offered again while that answer is fresh -- so
the next session re-reads only what went stale. A scope that is gone from the tree is said as GONE, and a need settled
on it is invalidated, to be settled again. A question about how a technology behaves goes to `orbit-research`: answered from a source for the
version the manifest pins, and kept as knowledge scoped to that version, so a version bump makes it stale.

### Coordinated workflows and reusable playbooks

When a workflow needs a capability nothing provides, the skill factory drafts a **project-scoped playbook**: a
`SKILL.md` and, when the work is a sequence of calls to capabilities this machine already has, a declared
`workflow.json`. The engine validates it, registers it in the store and runs it pinned to one version — each step
through its provider's own gate (the MCP broker or the capability pipeline), every call a receipt of digests. Later
workflows reuse the pinned playbook instead of drafting again
([ADR 0030](docs/adr/0030-a-generated-skill-declares-a-workflow-the-engine-runs-through-owner-gates.md)).

```bash
node cli/skill-factory.mjs discover --for=release.readiness.verification   # reusable (and its pin) or which gap
node cli/skill-factory.mjs workflow <id|pin>                               # its steps, in order
node cli/skill-factory.mjs runs <id>                                        # what each run came to
node cli/skill-factory.mjs review <id>                                      # what runs show; a successor proposed, never written
```

Goals are planned from a structured `intent` the host's model writes (`skills/orbit/SKILL.md`), never from the words
of the objective — so a goal in any language plans the same.

### System graph

`architecture graph [--json]` projects the running system: **nodes** (components, workloads, interfaces, channels,
schedules, stores …) and **relations** (calls, publishes-to, consumes-from, schedules …), each with evidence,
freshness and unknowns. `architecture ensure` reads what composition files declare; everything else arrives as
candidates through `architecture record`, which refuses untracked files and secret attributes. What a kind or
relation *means* comes from the vocabulary (`catalog/topology.json` plus organisation and project layers). The
`orbit-reverse-engineer` skill runs a standalone pass, one agent per unknown scope.

### Autonomous test generation and sandbox verification

From an accepted requirement to a verified outcome:

1. Obligations are **derived** from accepted plans against the frozen system graph.
2. The host proposes a test design; the engine compiles every verdict and page script from accepted criteria and fixed
   templates.
3. A frozen version runs only in a task's **isolated sandbox** (Docker), with writes allowed only under grants minted
   for its own fixture.
4. The host validates what the worker left before anything is recorded; ordered result rows give the outcome.

Backends are reached through adapters (`orbit.adapter/v1`) shipped as packs a project opts into; what each adapter is
proven to support is computed from conformance receipts. An adapter's operation may declare what its request carries
([ADR 0052](docs/adr/0052-an-adapter-operation-declares-what-its-request-carries.md)), and a design is held to it before
a draft exists.

```bash
node cli/autonomous-qa.mjs plan --plan=<id> --sandbox=<env-id> --mode=fixture-write
node cli/autonomous-qa.mjs derive --investigation=<id>        # obligations its accepted plans imply
node cli/autonomous-qa.mjs step --investigation=<id>          # one decision on stdin
node cli/autonomous-qa.mjs reconcile --investigation=<id>     # a dispatch that never settled, read back — never resent
node cli/security-audit.mjs assess --investigation=<id>       # security controls in effect, from that record
node cli/qa-plan.mjs expects <contract.json>                   # OpenAPI, AsyncAPI or schedule → candidate expectations
node cli/query.mjs adapters --matrix                           # what each adapter is proven to support
node acceptance/run.mjs [--stack=…] [--variant=…]              # native acceptance: two stacks, planted defects
```

A verdict must depend on the application, never on what the design itself causes. Every contradiction rule reads a
design through one model of what it causes (`src/qa/backend/causes.mjs`) and names no operation or shape: a wait for a
second delivery nothing brings, a match the design pins itself, a result its own step satisfies. Since 0.6.0 two more:
`NEVER_DECIDED` refuses a design that waits for a schedule to decide an occurrence when the clock is injected and
nothing in the investigation moved it, and `CLOCK_PASSED` advises when a design moves the clock only to where an earlier
test already took it.

Security catalogs (default: ASVS 5.0.0 L1, labelled with OWASP Top 10 2025 and API Security Top 10 2023), limits and
isolation are configured by a person in Orbit Control; a task's own sandbox needs nobody's trust to run
([ADR 0040](docs/adr/0040-standards-and-policies-are-configured-in-orbit-control.md)). Orbit never calls anything
"compliant".

### Autonomous engineering: what stopped a check

An engineering task (`orbit-engineer`, `autonomous-engineering.mjs`) classifies a failed check from facts it can
demonstrate, never from the words of an error: `DEPENDENCY` (the workspace's dependency restore for that component ran
and failed), `ACCESS` (a target a person said the component requires is unreachable from here, asked fresh),
`ENVIRONMENT` (it could not run here, or failed the same way before any change), `CODE`, `TEST`, `CAPABILITY`,
`REQUIREMENT`, `DATA`, `SCOPE` and `UNKNOWN`. A class chooses what to look at next; it is never a verdict. The task's
context ends with a `DO` line: the one command that goes on -- `step` with the decision's shape on stdin, or
`reconcile` for an action that did not settle. `node cli/task.mjs why <task>` says, for each decision, how it settled (a
receipt, or REPORTED and never proven; OPEN or AMBIGUOUS read back, never resent) and which receipt moved the task next.

### Orbit Satellite — multi-agent missions

`/orbit:satellite <goal>` (or `node <plugin-root>/satellite/cli/satellite.mjs` on any host) runs a **mission**: the goal
becomes a structured intent, an investigation comes before deciding who changes what, and the work graph is revised
only on evidence. Roles, agent templates, skills and workflows are reused first and generated only when nothing fits,
each pinned by digest. Every unit runs as a fresh agent under a least-privilege profile; source changes happen only in
an engineering task's own workspace; a criterion is verified only by an independent owner's record.

```bash
node satellite/cli/satellite.mjs mission start --stdin < goal.txt      # start, goal kept as submitted
node satellite/cli/satellite.mjs mission context <msn>                 # what stands, what is allowed, next step
node satellite/cli/satellite.mjs mission step <msn> < decision.json    # one decision, judged before it runs
node satellite/cli/satellite.mjs live tui <msn>                        # Satellite Live: nine views
node satellite/cli/satellite.mjs host capabilities                     # what this host can do
```

Claude Code dispatches agent runs natively and in parallel; Codex, Antigravity CLI and Grok Build run them serially in
the main session. Each run says which of the host's agents carries it, and how anybody knows (0.2.2,
[ADR 0044](docs/adr/0044-run-identity-and-attribution.md)):

| Word | Means |
| --- | --- |
| `HOST_OBSERVED` | the hooks saw the Agent call that carried the run's envelope launch that agent |
| `REPORTED` | only the dispatcher said so (`agent ack <msn> <arn> --host-agent=<agentId>`) |
| `CONFLICTING` | two agents are named for one run, or one agent for two runs: neither is chosen |
| `UNATTRIBUTED` | a serial run, or nothing observed: its calls cannot be told from the session's own |

In `live tui`, press `2`, select a run with `j`/`k` and press `enter` to inspect it: its pins, parent and children, its
host agent and the basis of the word, its calls (direct, and through the agents it launched) and its records. Details: [satellite/docs/README.md](satellite/docs/README.md),
[ADR 0041](docs/adr/0041-orbit-satellite-is-a-mission-journal-above-owners.md).

### Autonomous self-improvement

Orbit improves this project's **declared playbooks** and **Satellite roles** from what they actually did, and only on
independent evidence ([ADR 0045](docs/adr/0045-autonomous-self-improvement-on-independent-evidence.md)):

1. **Detect.** The runs the owners recorded become signals, and one problem is one opportunity by its fingerprint. A
   single failure, or retries inside one session, never count; neither does a provider, an environment or a person's
   approval.
2. **Diagnose and generate.** Only a defect of the definition itself gets a successor. The skill factory drafts it from
   the version it succeeds, the host writes the change, and it is staged as a candidate nobody is offered.
3. **Validate.** A candidate that widens its tools, drops a required step, loosens a success rule or carries anything
   executable is refused before it runs.
4. **Evaluate.** The candidate and the version it would replace run the same frozen inputs side by side, through the
   same gates as ordinary work. It is better only when two independent sessions, meaning two UTC days or two
   machines, say so and none says otherwise.
5. **Promote.** Twelve gates, then the owner's own door chooses it for new work. A pin a task already holds never
   moves, and the replaced version is kept whole.
6. **Monitor and roll back.** Later runs are watched. A regression in independent sessions puts the replaced version
   back, and the result becomes a lesson only through learn's own ladder.

It runs by itself after a workflow and from the hooks, never evaluating there. Every switch and bound is a person's,
under `improvement.*` in Orbit Control, and with automatic promotion off a qualified candidate waits for a person.
Nothing it does crosses a protected boundary, widens a permission or overrides a person's decision.

### Check observation adapters

While a declared check runs beside an engineering task, Orbit reads its output through one adapter, chosen by the
command's output. Observation is shown live and never changes the verdict:

  | Adapter | Framework | Cases shown |
  | --- | --- | --- |
  | `dotnet-test` | the .NET test platform's console report (VSTest or Microsoft.Testing.Platform) | failures |
  | `tap` | a TAP stream (Test Anything Protocol 13 or 14) | reported |
  | `generic` | any command | none |

### Unified work tracking

One request is followed from `/orbit-help` to what it came to, on three separate axes:

- **Lifecycle:** `RECEIVED`, `IN_PROGRESS`, `INTERRUPTED`, `WAITING`, `BLOCKED`, `PAUSED`, `REPORTED_DONE`, `FAILED`,
  `CANCELLED`.
- **Evidence:** `none` · `observed` · `reported` · `verified` (only a completed linked task is `verified`).
- **Liveness:** whether a session is still attached.

### Microsoft sign-in for Azure DevOps

Orbit's Microsoft sign-in is independent from your normal Azure CLI login. If you already use `az` for development, Orbit does not change that account, subscription, configuration or login session. Orbit keeps a separate Azure CLI profile in the Orbit machine store. You may therefore be logged into account A in your terminal and account B in Orbit at the same time.

A connection to Azure DevOps signs in with your Microsoft account by default; a personal access token is the alternative.
Sign in once per machine and every project that uses the connection reads with it
([ADR 0043](docs/adr/0043-orbit-signs-in-through-an-azure-cli-profile-of-its-own.md)):

```bash
node <plugin-root>/cli/project-report.mjs connect <id> --provider=azure-devops --organization=<org>   # a connection that signs in with Microsoft (the default)
node <plugin-root>/cli/project-report.mjs sign-in <id> [--tenant=<id>] [--device-code]
node <plugin-root>/cli/project-report.mjs sign-out <id>                                              # Orbit's profile only
node <plugin-root>/cli/project-report.mjs connect <id> --provider=azure-devops --organization=<org> --auth=credential --credential-env=<NAME>   # a personal access token instead
```

Orbit Control → Connections shows each connection's state and lets you check it, sign in and sign out. When a read says
sign-in is required, run `sign-in` yourself (in Claude Code, type `! node <plugin-root>/cli/project-report.mjs sign-in <id>`
at the prompt): the browser step is yours.

| | |
| --- | --- |
| **How it signs in** | The Azure CLI's browser sign-in (a device code with `--device-code`), in Orbit's own profile. Orbit asks the CLI for a short-lived Azure DevOps token each time it needs one and keeps it in memory only; it signs in again only when the CLI says you must act. |
| **Which `az` runs** | 1. a private copy Orbit already installed; 2. your machine's own `az`, used only as a program (it must start, be 2.61.0 or newer and belong to this operating system), never its sign-in; 3. a private copy Orbit installs by itself when neither is usable; 4. otherwise a blocked answer that names every candidate. To make the private copy win over your own `az`, install it from Orbit Control's Tools page. |
| **What Orbit installs** | Only in step 3, into Orbit's store: on Windows x64 Microsoft's official Azure CLI 2.91.0 ZIP (91 MB, SHA-256 checked); on macOS and Linux a Python of Orbit's own plus the official `azure-cli` 2.91.0 wheels from PyPI, every distribution pinned and hash-locked (150 of them; about 200 MB to download, about 700 MB on disk). No administrator rights, nothing on PATH, no package manager, no `sudo`, no Program Files, no Homebrew, no system Python. It is a tool Orbit runs, not a dependency of the engine. |
| **What it never does** | Import or copy your session, or ask to; read `~/.azure` or `%USERPROFILE%\.azure`, or Azure CLI's token-cache files; change your subscription, extensions or configuration; install the Azure DevOps CLI extension; create a personal access token. |
| **On Windows** | The sign-in is the browser flow. The Windows account broker is turned off for Orbit's profile because it keeps a session outside the profile, shared with your own `az`; so there is no Windows Hello or single sign-on, and a tenant that requires a compliant device through the broker may refuse it. Use a personal access token there. |
| **Scope** | Azure DevOps Services. Microsoft Entra authentication is not available for Azure DevOps Server collections, which use a personal access token. The token is yours for Azure DevOps and is not narrowed to read-only the way a personal access token can be; Orbit's readers only read. |

| Platform | Private copy Orbit can install | Your own `az`, as a program |
| --- | --- | --- |
| Windows x64 | official ZIP | yes |
| Windows ARM64 | none: Microsoft publishes no ARM64 build | an x64 `az` you already have, started through its own wrapper and never a shell; otherwise blocked |
| macOS arm64 and x64 | locked Python environment | yes |
| Linux x64 and arm64 (glibc) | locked Python environment | yes |
| WSL | as Linux, with its own Orbit state; a Windows `az` reached through WSL is refused, and so is a profile on a Windows drive | a Linux `az` |
| Alpine (musl) | none: the Python Orbit installs is a glibc build | an `az` already there |

This covers the Azure CLI processes Orbit starts for its own sign-in. A tool a project's own capability declares
(`tools: ["az"]`) and `query doctor` run as the project asked. How far each platform has been run for real, and how far
only resolved or faked, is in the
[platform evidence table](docs/adr/0043-orbit-signs-in-through-an-azure-cli-profile-of-its-own.md#platform-evidence).

---

## Developing Orbit

```bash
npm test                                                     # node --test: no browser, no network, no sleeps
npm run lint                                                 # Five Lines check, must print 0 finding(s)
ORBIT_UI_TESTS=test/fixtures/ui-tests node cli/query.mjs check
ORBIT_UI_TESTS=test/fixtures/ui-tests node cli/plan-check.mjs
node skills/orbit-release/ship.mjs --ci                      # the whole definition of done, one command (the fast tier);
                                                             #   there is no GitHub workflow: this is what a pipeline ran
node skills/orbit-release/panel.mjs                          # Orbit Control on its own Node: server tests, panel build
node skills/orbit-release/ship.mjs --evidence --evaluation=<record.json>   # the publish gate (ADR 0057)
```

Before changing code, read:

- [AGENTS.md](AGENTS.md) — invariants, dependency direction, enforced rules, commands, definition of done
- [docs/agents/layout.md](docs/agents/layout.md) — module map
- [docs/agents/extend.md](docs/agents/extend.md) — what to touch for each kind of change, and the test that proves it

Key rules in short: zero dependencies; every function body ≤ 5 statements with no `else`/`switch`; the DSL vocabulary
is data (`src/dsl/`); no product, vendor or stack named in engine code.

### The independent evaluator

`evaluator/` measures what Orbit adds to a coding host from outside
([evaluator/README.md](evaluator/README.md), [ADR 0057](docs/adr/0057-an-independent-evaluator-measures-a-release.md)).
It runs the same task with the same model, effort, tools, limits and prompt in arms that differ only by the plugin --
the plain host, Orbit at the previous release, Orbit at the release candidate -- and grades the patch each run leaves by
hidden tests the agent never sees, in a fresh container with no network: never by the agent's word, never by Orbit's
own records. It is a package of its own (Orbit imports nothing of it, and it imports nothing of Orbit) and never ships.

What runs and how it is judged is pre-registered (`evaluator/prereg/<release>.json`) before any model run: SWE-bench
Verified instances and local task packs, a development set and a held-out set, the arms, and the verdict rule --
IMPROVED, NO_DIFFERENCE, REGRESSED or INCONCLUSIVE, where a one-task difference is INCONCLUSIVE. A release qualifies on
the fast tier plus the evaluator's record of that very artifact.

```bash
node evaluator/cli.mjs checks                                # the evaluator's own checks, no Docker
node evaluator/cli.mjs selfcheck --ca-file=<pem>             # its scripted controls, for real, no model
node evaluator/cli.mjs prereg campaign final --rev=<commit>  # a phase's campaign, made from the pre-registration
node evaluator/cli.mjs run <campaign.json> | resume <id> | status <id> | report <id> --md
node evaluator/cli.mjs record --campaign=<id>,<id> --out=<record.json>   # what ship.mjs --evidence reads
```

---

## Further reading

| Document | About |
| --- | --- |
| [docs/hosts.md](docs/hosts.md) | Host binding, sessions, native acceptance per host |
| [docs/orbit-current-contract.md](docs/orbit-current-contract.md) | Current contracts and fresh-install behaviour |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [satellite/docs/README.md](satellite/docs/README.md) | Orbit Satellite |
| [docs/github-orbit-repo.md](docs/github-orbit-repo.md) | Publishing the repository |

## License

MIT — see [LICENSE](LICENSE).
