# Orbit for coding hosts: the plugin

**From Goal to Verified Outcome**

> One direction of Orbit. Orbit is a **Governed Agentic Workplace** -- AI employees doing governed work for an account
> -- presented in the repository's [README](../README.md). This document is the plugin's own: Orbit inside the AI coding
> host you already use.

Orbit is a plugin for AI coding hosts — **Claude Code**, **Codex**, **Antigravity CLI** and **Grok Build**. You describe
a goal (a PBI, a bug, an engineering objective); Orbit takes it through requirements, planning, implementation, testing
and review, and calls it done only when there is **evidence** that it is done. Along the way it keeps what it learns
about your project, runs UI tests written as plain JSON (checking the screen, the API call and the database row),
investigates a running application the way a QA engineer would, and shows its work in a viewer beside your session.

- **Local and private** — all state lives on your machine, outside your repository. No cloud service.
- **Autonomous by default** — a person is asked only at a few **protected boundaries**: writing your checkout, a git
  push, a production deploy or migration, destroying production data.
- **Governed** — deterministic engine rules check every action; the boundaries, catalogs and limits are a person's.
- **Evidence-based** — a step is verified only by a record its owner keeps: a passing check, a test run, a QA report.
- **Product-neutral** — the engine names no product, vendor or stack; your project declares its own.
- **Zero dependencies** — plain Node.js 20 or newer, no npm packages.

This document describes the Orbit plugin **0.6.0**. What changed in each release: [CHANGELOG.md](../CHANGELOG.md).

## Contents

[Install](#install) · [Quick start](#quick-start) · [How Orbit works](#how-orbit-works) · [Skills](#skills) ·
[Command line](#command-line) · [Where your data lives](#where-your-data-lives) ·
[Settings and switches](#settings-and-switches) · [Orbit Live and Orbit Control](#orbit-live-and-orbit-control) ·
[Feature guides](#feature-guides) · [Orbit Web](#orbit-web) · [Developing Orbit](#developing-orbit) ·
[Further reading](#further-reading)

## Install

Node.js 20 or newer is all the engine needs. Orbit Control needs Node 24.15 or newer and finds one by itself; UI tests
need `playwright-cli` ([check the install](#check-the-install)).

| Host | Install | Notes |
| --- | --- | --- |
| **Claude Code** | `/plugin marketplace add cuongngoht/orbit`, then `/plugin install orbit@orbit` | |
| **Grok Build** | `grok plugin install cuongngoht/orbit --trust` (or the path of a local clone) | `--trust` lets Grok run the plugin's hooks. [docs/grok.md](grok.md) |
| **Codex** | from a clone or an unpacked release: `codex plugin marketplace add <plugin-root>`, then `codex plugin add orbit@orbit` | Installing does not trust the hooks: review and trust them in Codex. Enable only one Orbit installation per workspace. [docs/codex.md](codex.md) |
| **Antigravity CLI** | `agy plugin install <plugin-root>` | [docs/antigravity.md](antigravity.md) |
| **Local development** | `claude --plugin-dir .` from a clone of this repository | |

### Check the install

`<plugin-root>` is where the host installed Orbit (`${CLAUDE_PLUGIN_ROOT}` inside a skill on Claude Code). Every command
is `node <plugin-root>/cli/<tool>.mjs`, called by its path: Orbit puts nothing on your PATH.

```bash
node <plugin-root>/cli/orbit.mjs doctor           # where the goals store is, and how many goals it holds
node <plugin-root>/cli/query.mjs doctor           # are the tools this project declares (playwright-cli …) usable here?
node <plugin-root>/cli/setup.mjs --install        # install the declared tools that have a package name
node <plugin-root>/cli/live.mjs doctor --claude   # can Orbit Live show a task here, and where?
```

How each host binds the plugin root and the session: [docs/hosts.md](hosts.md). Source:
[github.com/cuongngoht/orbit](https://github.com/cuongngoht/orbit) (public, MIT).

## Quick start

1. **Open your product repository** in a host where Orbit is installed. Nothing is written into the repository: Orbit
   seats the project in its machine store the first time you use it.
2. **Not sure where to start?** Run `/orbit-help`. It looks at what Orbit already knows about the project and either
   takes your task through a coordinated workflow or names the one skill that fits, and why.
3. **Have a full goal?** Run `/orbit` with the whole specification — a PBI, acceptance criteria, a bug report:

   ```text
   /orbit Implement PBI-482: refunds over 30 days require a manager's approval. Acceptance criteria: …
   ```

   Orbit keeps the goal as submitted, analyzes it, plans work units, runs them through their owners, verifies against
   evidence and reports.
4. **Or just ask**, in English or Vietnamese. The [prompt router](#the-prompt-router) suggests the skill or agent that
   fits, or adds nothing when none is needed.
5. **Watch it work** in [Orbit Live](#orbit-live), beside your session. Normal development needs no approval; when work
   reaches a [protected boundary](#protected-boundaries), decide it in [Orbit Control](#orbit-control) (`/orbit-control`).

## How Orbit works

```text
 Goal ──► Requirement ──► Plan ──► Task (own workspace) ──► Checks / QA ──► Evidence ──► Report
           snapshot        units    build · test · fix       verified by      kept by
                                                             their owner      its owner
 All of it is kept on your machine, in the Orbit store, never in your repository.
```

The **host's model** reasons: it reads the goal, chooses the next step and writes the code. The **engine** (plain
Node.js commands under `cli/`) keeps the state in append-only journals, judges each step before it runs and settles it
with receipts. The **hooks** watch the session and speak only where Orbit has something to say. [Orbit
Live](#orbit-live) shows what the journals hold; [Orbit Control](#orbit-control) is where a person decides. Layers,
dependency direction and data: [docs/architecture.md](architecture.md).

| Idea | What it means for you |
| --- | --- |
| **Every artifact has one owner** | A requirement, a task, a check, a QA investigation each own their records. Nothing re-judges another owner's verdict. |
| **PASS is earned** | No verdict executed means `INCONCLUSIVE`, never a pass. A failure that existed before your change shows as `failed-as-before`, never hidden. |
| **Your repository is untrusted data** | Orbit runs only commands your project files declare, as argument lists — never a shell line a model wrote. |
| **Changes happen in isolation** | An engineering task edits and commits in its own workspace (a local clone), never in your checkout. |
| **Autonomous, except at the boundary** | Building, testing, QA, sandboxes, local databases and local commits ask nobody. A push, a production deploy or migration and destroying production data wait for one approval of exactly that action; writing your checkout is yours alone. An agent cannot approve its own action. |

## Skills

Name a skill yourself (`/orbit-help`; in Claude Code also `/orbit:orbit-help`), or let the host pick one: each
description's first sentence says *when* to use it, within the host's listing budget (300 characters each, 7,500 for
all 26).

### Entry points

| Skill | Use it for |
| --- | --- |
| **`/orbit`** | A whole specification — a PBI, a bug report, a goal with acceptance criteria — taken to a verified outcome: analyze → plan → execute → verify → report. For one change, use `orbit-develop`. |
| **`/orbit-help`** | Not knowing where to start, or a task several owners take in turn (a work item, a code change, the running app, QA, review). Starts or resumes a coordinated workflow, or names the one skill that fits, and why. |
| **`/satellite`** | A goal run as an autonomous multi-agent mission: a work graph, least-privilege agents, each criterion settled on an independent owner's record. |

### Engineering

| Skill | Use it for |
| --- | --- |
| `orbit-requirements` | A work item, PBI, issue or user story read into atomic requirement facts and one frozen snapshot; asks a person only what blocks, and never decides a requirement itself. |
| `orbit-engineer` | A requirement taken autonomously to a **verified** change in a task-owned workspace: plan, build, test, diagnose, fix, review; it commits, and a push waits for approval. |
| `orbit-develop` | A feature, fix, refactor or rename made directly in this checkout, the way this project builds code: context first, the smallest change, verified and reviewed. |
| `orbit-runtime` | What this checkout needs to run and whether this machine can; start or stop what its files declare; a port conflict, an unreachable server, a dev container. |
| `orbit-architecture` | What the project is made of, where an integration belongs, whether a capability exists — from a kept snapshot that re-reads only what moved. |
| `orbit-reverse-engineer` | The running system mapped as a kept system graph: components, workloads, interfaces, queues, schedules, stores, and what talks to what. |
| `orbit-dotnet` | Which technologies a .NET solution declares, what its code really uses each for, and whether to reuse or build. |
| `orbit-research` | How a library, SDK or API behaves, answered from a source for the version the manifest pins, and kept as knowledge scoped to that version. |
| `orbit-learn` | Dated lessons, with evidence, from what repeated across independent sessions; recall, record or forget one. Never decides PASS. |
| `orbit-improve` | This project's generated playbooks and Satellite roles improved from evidence: the smallest successor, evaluated against the current version on frozen inputs. |

### Quality and testing

| Skill | Use it for |
| --- | --- |
| `orbit-qa` | A live application investigated like a senior QA engineer, one step at a time inside approved limits, watching screen, network and data; it reports only what it proves. |
| `orbit-test-plan` | *What* to test, decided before any test is written: known versus assumed, one checkable, risk-ranked plan per feature. |
| `orbit-ui-test` | ONE JSON UI test case run or authored: `playwright-cli` drives it, and it verifies UI, API and SQL, with evidence on failure. |
| `orbit-test-suite` | An agreed set of cases run the way a tester does — the browser profile, evidence for each — and one review page. |
| `orbit-ui-map` | The UI map (screens, controls, effects) filled and corrected from the declared frontend source, then confirmed live. |
| `orbit-ui-explore` | A screen nobody wrote cases for, explored: candidate map records, cases that survived a real run, one session sheet. |
| `orbit-browser` | A browser and a signed-in profile on this machine, opened as a test session on a copy of it. No password is read. |
| `orbit-sql` | Read-only SQL Server checks for a test through `sqlcmd`: one `SELECT` per call, the connection from `ORBIT_SQL_*`. |
| `orbit-qc-builder` | The smallest project-local QC tool a check needs when nothing here can do it (a second database, a vendor SDK, a queue). |
| `orbit-security-audit` | The project assessed against the security catalogs it is held to, from evidence, with its obligations handed to QA. Never says "compliant". |

### Operations

| Skill | Use it for |
| --- | --- |
| `orbit-control` | Orbit Control started and its URL returned: MCP servers, CLI tools, report connections and sign-in, limits, policies, the router. |
| `orbit-report` | A product owner's report from GitHub or Azure DevOps, read once, frozen and rendered as one offline HTML page ([project reports](#project-reports)). |
| `orbit-release` | A new version of Orbit itself shipped, or Orbit installed or upgraded in another repository. |

### Role agents

Twenty role agents each do one bounded job in a context of their own. Five may be dispatched directly when that job is
the whole request: `orbit-engineering-agent` (drive one engineering task), `orbit-qa-agent` (run one QA investigation),
`orbit-failure-analyst` (classify a failed UI run into one cause), `orbit-dsl-doctor` (repair how a case is written,
never what it means) and `orbit-engineering-observer` (propose what a session taught about how this project builds
code). The other fifteen — the architecture scanner, the reverse-engineering agent, the security auditor, the map healer
and recorder, the QA case writer, the five requirement-roundtable agents and Satellite's four — run only from their
parent skill's playbook (`via` in `catalog/components.json`); the router never offers one on its own.

### The prompt router

Beside every prompt, Orbit's router says how much Orbit the request needs, in one line or not at all (RouteDecision v3,
[ADR 0050](adr/0050-the-host-activates-orbit-by-capability-and-orbit-verifies-what-happened.md)):

| Strategy | When |
| --- | --- |
| **NONE** (adds nothing) | a prompt you opened with a slash command (you already chose what runs), a greeting, a status question that asks for nothing else ("how far along are we?", "tới đâu rồi"), a background task's notification, an opt-out ("without Orbit", "không dùng orbit"), or anything the session already does itself |
| **DIRECT** | names the one skill or agent that fits |
| **COORDINATED** | the one command for a change several owners take in turn (`/orbit-help`'s workflow) or for a whole specification (`/orbit`'s goal); a question that only names code ("is the orders endpoint protected?") asks for no change |
| **SATELLITE** | only ever a mission you asked for |
| **RESUME** | picks up an open work of this checkout through its owner |

English and Vietnamese are read alike; words past the first 2,000 characters (a pasted log or file) never decide what a
prompt is about; a one-word match counts only when it is a skill's own word. Since 0.6.0 a **fact** about the session's
work counts too, never a word the engine guessed: a check that failed after the session's edits (`check.failed`), the
same check failing three times with nothing changed between (`check.repeats`), a knowledge need of the tracked work
nobody answered (`knowledge.owed`). A catalog row names the facts its playbook handles (`reactsTo`), and the existing
resolver picks the provider ([ADR 0059](adr/0059-proactive-execution-from-facts-said-once-and-explained.md)). The
router suggests; the host decides. `test/fixtures/routing/corpus.jsonl` holds it to realistic prompts in both
languages. Off: the `prompt_router` option or `ORBIT_PROMPT_ROUTER=off`.

### Follow-through during a session

Where Orbit owns the work, the rest of the session gets at most a line at a time:

| Moment | What Orbit adds |
| --- | --- |
| Session start, in a checkout Orbit knows | one line of at most 300 bytes — each family's usable count, what you switched off, the project's STATUS word — and, on a resumed or compacted session, its open work and next step |
| One of Orbit's agents returns | the owner record that settles its work (the workflow, goal, mission or task) and where it stands; what the agent said is its report, never the evidence |
| An Orbit command fails under governed work | the owner's recovery row: an action that did not settle is read back with `reconcile`, never sent again |
| Any tool call fails (0.6.0) | at most one line of advice — the fact, its subject, the skill or agent that handles it and the call that brings it in — or nothing: an ordered silence table keeps quiet when the host cannot carry a line, the trail is off, you said stop, nothing holds, it was said already this session, this prompt had its line, your work is paused or waiting, or nothing handles it. Never after a call that succeeded |
| Stop, with a workflow step ready | the turn is held open (at most twice per prompt, never twice in a row) with the step and its command, or the model says in one sentence why it stops; never past your pause, cancel, approval or question, never after a halt cue. Off: `trigger.holdOnStop` |
| Stop, after edits nothing checked (0.6.0) | held open once per prompt when the turn edited code a component owns and no test or declared verifying check passed after the edit (a lint or a build alone shows nothing works), naming the safe check that component declares — or, with none, the tracked test files linked to the edited files, or a regression test to write. It runs nothing. Off: `trigger.holdUnverified` |

The Stop holds are Claude Code's; each host's row is in [docs/hosts.md](hosts.md). How a suggestion became an
outcome is read back from [the session trail](#the-session-trail).

## Command line

Every skill is backed by commands under `cli/`. On any host the reliable form is `node <plugin-root>/cli/<tool>.mjs …`
(`node cli/…` below, for short). Each file starts with its usage; most commands take `--json`; in the examples,
`a | b` between subcommands means either one, as in a usage line.

| Area | Commands | What they are for |
| --- | --- | --- |
| Start | `orbit.mjs` | goals (`goal start`, `analyze`, `plan`, `step`, `status`, `verify`, `report`, `resume`, `list`) and `doctor` |
| | `help.mjs` · `automation.mjs` · `track.mjs` | one recommended next step; coordinated workflows; unified work tracking |
| Requirements and work | `requirements.mjs` · `work.mjs` · `task.mjs` | facts, questions and snapshots; a work's needs and receipts; one execution (`list`, `show`, `why`) |
| Engineering | `autonomous-engineering.mjs` · `context.mjs` · `runtime.mjs` | a task taken to a verified change; what a task touches; what a checkout needs to run |
| Project memory | `architecture.mjs` · `intelligence.mjs` · `engineering.mjs` · `knowledge.mjs` · `learn.mjs` | architecture and the system graph; technologies; conventions; knowledge and opportunities; lessons |
| Testing and QA | `run-case.mjs` · `query.mjs` | one JSON UI test case (`--dry`, `--report`); the UI map, cases and DSL (`dsl`, `verb`, `field`), `check`, `triage`, `doctor`, `storage` |
| | `qa-plan.mjs` · `plan-check.mjs` | test plans and their coverage, held to their rules |
| | `autonomous-qa.mjs` · `security-audit.mjs` | QA investigations and generated tests; security assessments |
| | `report.mjs` · `review.mjs` · `explore.mjs` · `record-edge.mjs` | a run, screen, session or exploration as one HTML page; UI map records |
| Viewing | `live.mjs` · `trace.mjs` · `host.mjs` | Orbit Live; the session trail; Claude Code's status line |
| Resources | `resources.mjs` · `mcp.mjs` | the registry and a dry route (`route "<prompt>"`); MCP servers, called through every gate |
| | `skill-factory.mjs` · `qc-tool.mjs` · `setup.mjs` | generated playbooks; this project's QC tools; installing declared tools |
| Data and reports | `storage.mjs` · `init.mjs` · `project-report.mjs` | where test data lives, and a person's transfers; seating a project; product owner reports |
| More | `improve.mjs` · `satellite/cli/satellite.mjs` | self-improvement; Orbit Satellite missions |

**Exit codes**, the same across the CLIs: `0` done · `1` failed (only where something can fail: a test case, a plan or
integrity check, an MCP tool's own error) · `2` refused · `3` blocked · `4` inconclusive. A passing slice of a case
(`--from`/`--to`) is `PARTIAL`, exit `0`. The full reference, with the flags: [AGENTS.md › Commands](../AGENTS.md#commands).

> **Trying commands inside this repository?** Set `ORBIT_STORE_DIR=/tmp/orbit` first — everything writes to
> `~/.orbit` by default.

## Where your data lives

All durable state lives **outside your product repository**, in the machine store:

| What | Where |
| --- | --- |
| Default | `~/.orbit/projects/<project-key>/` |
| Override (the only one) | `ORBIT_STORE_DIR=/path/to/base` → `/path/to/base/<project-key>/` |
| Show the paths | `node cli/query.mjs storage --json` or `node cli/storage.mjs where` |

- A project is keyed by its repository's identity: every checkout of one repository shares one store, and runtime
  sessions stay separate per checkout. Reading never creates state; every write is contained, locked and checked for a
  stale revision.
- **Test data** (`ui-tests/`: `project.json`, `graph/`, `screens/<screen>/<plan>.plan.json`,
  `screens/<screen>/cases/<case>.json`) lives in the store by default. A team that commits it with its code chooses the
  checkout explicitly (`init --in-checkout`, or `storage export --all --move`), and `ORBIT_UI_TESTS` names a data
  directory directly. Moving data between the two is a person's act (`storage import`, `storage export`), previewed and
  checked with per-file digests.
- **Reports, evidence, lessons, goals, requirements, works, tasks, generated playbooks and improvement campaigns**
  always stay in the store.

## Settings and switches

These are on by default. On Claude Code each is a plugin option; on any host, an exported variable overrides it on one
machine.

| Switch | Option | Variable | Off means |
| --- | --- | --- | --- |
| Prompt router | `prompt_router` | `ORBIT_PROMPT_ROUTER=off` | nothing is added beside a prompt |
| Session trail | `trace` | `ORBIT_TRACE=off` | nothing is recorded about the session (kept 90 days when on) |
| Working set | `working_set` | `ORBIT_WORKING_SET=off` | no metadata about what the session read, edited and ran (kept 7 days when on) |
| Engineering observer | `engineering_observe` | `ORBIT_ENGINEERING_OBSERVE=off` | nothing is learned about how this project builds code |
| Host memory hints | `host_memory` | `ORBIT_HOST_MEMORY=off` | the host's own notes about the project are not used as hints |
| One skill or agent | `skill_…`, `agent_…` | `ORBIT_SKILL_…`, `ORBIT_AGENT_…` | a hook refuses that skill or agent, and says why |

New lessons stop with `ORBIT_LEARN=off` (or `learn auto off`). Everything else a person sets — automation limits and
triggers (`trigger.holdOnStop`, `trigger.holdUnverified`), Live (`live.open`, `pane.*`), self-improvement
(`improvement.*`), MCP policies, security catalogs and budgets — is set in [Orbit Control](#orbit-control), naming the
revision it read.

## Orbit Live and Orbit Control

### Orbit Live

A **read-only** viewer beside your session, fed from the journals the engine keeps: tasks, goals, workflows, checks
and QA. `/orbit` and `/orbit-help` open it once per session, only in an interactive one (never under `claude -p` or
CI). In **Claude Code** it is a pane docked on the right (from 110 columns with the fullscreen layout,
`CLAUDE_CODE_NO_FLICKER=1`; above the prompt otherwise). **Codex, Antigravity CLI and Grok Build** cannot say a person
is there, so nothing opens by itself (unless you list the host in Live's `attendedHosts`); ask, and the agent runs
`live open` — a split in tmux, Windows Terminal or iTerm2, or a macOS window, else the command is printed. In **VS
Code**, the companion in [integrations/vscode-orbit-live](../integrations/vscode-orbit-live) splits the asking terminal
(machine-scoped settings `orbit.live.storeDirs`, `orbit.live.nodePath`).

The badge says what the task is doing — `ORBITING`, `IDLE`, `BLOCKED`, `COMPLETED` … — only on evidence; the animated
orbit in the header is the viewer's motion, never progress. Below it: the checklist, `NOW`, six views (events, tests,
changes, notices, plan, timeline), task and test progress, and a workflow's milestones under their step. Where the host
names the subagent behind a call (Claude Code, 0.2.2), activity is grouped **per agent**; an evaluation task shows its
campaign in an `IMPROVE` section (0.3.0). The task shown is one this session created, a pin or the one task running in
this checkout — never the newest on the machine; two candidates are `AMBIGUOUS`, and `live pin <task>` chooses.

In a terminal: `live.mjs status` (print once), `watch` (follow; `q` detaches the viewer and nothing else), `tui` (full
screen, in a second terminal or pane) and `open` (beside this session). Settings, through `live settings
--apply='<json>' --revision=<r>`: `pane.widthPercent`, `pane.focusCli`, `pane.animation: off` and `pane.orbitSpeed`
(`slow` · `normal` · `fast`). To stop it opening by itself: Orbit Control › Advanced › Automation limits › Live
(`live.open`).

**Status line (Claude Code).** Orbit can own one key, `statusLine`, in your Claude Code settings:
`node cli/host.mjs render --host=claude --kind=statusline` shows what it would write and the revision; `apply …
--revision=<r> --human` writes it and `remove … --revision=<r> --human` takes it out. A status line you already have is
refused unless you `--replace` it (yours comes back on remove) or `--keep-existing` (yours runs first; not on Windows).

### Orbit Control

A local panel, on loopback only, where a person decides and configures: skills, MCP servers, CLI tools, report
connections (a credential that goes straight to the OS secret store, or a Microsoft sign-in), automation limits, Live,
security catalogs, self-improvement (Advanced › Improvement), the router's inspector, analytics and the session trail —
and the protected actions waiting for a person. Start it with `/orbit-control` (or
`node <plugin-root>/skills/orbit-control/start.mjs`) and open the URL it prints, `#token=…` included: without the token
the page is read-only.

- **MCP servers.** A *managed* server is Orbit's, added here and called only through Orbit's broker. An *external* one
  is what a host configured: listed and testable, never routed to, called or written by Orbit. A secret is never typed
  in: a header or variable names the environment variable its value comes from.
- **Decisions.** Approving a push or a production action, and resuming a paused task, happen only here: a terminal
  cannot prove a person typed them. Orbit never adds, enables or approves a server, a policy or an approval by itself;
  the one thing it fetches on its own is a pinned, checksum-verified private tool that work you asked for needs (see
  [Microsoft sign-in](#microsoft-sign-in-for-azure-devops)).

### Protected boundaries

Orbit is **autonomous by default**: it inspects, plans, edits its own workspace, builds, tests, runs QA, prepares its own
sandbox (restoring dependencies and building containers there), uses local databases and commits locally without asking.
A person is asked only where work would leave that boundary
([ADR 0042](adr/0042-autonomous-by-default-protected-boundaries.md)):

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

## Feature guides

[Goals](#goals) · [Requirements, work and tasks](#requirements-work-and-tasks) · [Project context](#project-context) ·
[Project memory](#project-memory) · [Coordinated workflows](#coordinated-workflows-and-playbooks) ·
[Autonomous engineering](#autonomous-engineering) · [Unified work tracking](#unified-work-tracking) ·
[Running the application](#running-the-application) · [UI test cases](#ui-test-cases) · [Autonomous QA](#autonomous-qa) ·
[Orbit Satellite](#orbit-satellite) · [Self-improvement](#autonomous-self-improvement) ·
[The session trail](#the-session-trail) · [Project reports](#project-reports) ·
[Extending Orbit](#extending-orbit-in-your-project)

### Goals

`/orbit` keeps the specification exactly as submitted. The host's model reads it into requirements — each labelled
`explicit`, `derived`, `assumption`, `unknown`, `conflict`, `decision` or `constraint`, citing the line it rests on (a
row with no kind is an assumption) — and a structured **intent**: category, work kinds, capabilities, verification,
dependencies, missing prerequisites. The plan comes from the intent alone, never from the words, so a goal in Vietnamese
and its English twin plan the same: one unit per work kind, in order (analyze → change → investigate → procedure →
verify), each run as a [coordinated workflow](#coordinated-workflows-and-playbooks). A unit a missing prerequisite
blocks is `unresolved` and never started. From a terminal: `orbit.mjs goal start --stdin [--ref=PBI-482] < goal.txt`,
then `goal analyze|plan|step|status|verify|report|resume <goal-id>`.

### Requirements, work and tasks

- **A requirement** is what its own source says. `orbit-requirements` reads a work item into atomic facts and a frozen
  snapshot (`rs-…`), keeping what the item *was* (identity, revision, digest, whose word), never its text. Code, tests
  and pull requests are never a requirement's source: what the product does today is how it was built, not what it
  should do. Unknowns become questions, and only a person answers one (`answer --human`); a roundtable of reviewer
  agents proposes questions and decides nothing.
- **A work** (`w-…`) holds what a requirement needs: capabilities, the provider bound to each, receipts (digests, never
  the answer) and checkpoints. A capability nothing provides is an opportunity for a person, never an install.
- **A task** (`tsk-…`) is one execution: an append-only journal whose state is derived on every read. Your pause or
  cancel names the revision you read (`--expect=<revision>`); approve and resume happen only in Orbit Control.

```bash
node cli/requirements.mjs resolve <ref> | acquire <ref> | status <root> | snapshot <root>
node cli/requirements.mjs answer <root> --question=<rq-…> --says="…" --human
node cli/task.mjs list | show <task> | why <task> | pause <task> --human --expect=<revision>
```

### Project context

`context --for="<task>"` is what `orbit-develop`, `orbit-engineer` and `orbit-help` read before they choose a scope.
Memory first, it composes the architecture, technology, engineering, knowledge, work and working-set sections, and
answers two questions about the task (0.5.0):

- **RELEVANT** — what the task touches, from what the owners already hold: each item a `file`, `symbol`, `component` or
  `check`, classed `direct`, `dependency`, `downstream`, `verification` or `unknown`, with its evidence, its freshness
  and who found it (`engine` or `host-verified`); at most 40. Names match with identifiers split (`createOrder` is
  "create order"), with no embeddings. Each direct file is followed one hop each way — its imports, its importers, its
  tests — by relation adapters in a pack (JavaScript/TypeScript and Python, in `skills/orbit-develop/relations/`).
- **SUFFICIENCY** — `ENOUGH` (proceed), `DISCOVER` (the targeted reads that would fill the gap, each an Orbit command,
  never a full scan) or `ASK` (a question about the task's own work is already open; Orbit never makes one up). Since
  0.6.0 it is also answered per level — enough to **investigate**, to **change**, to **conclude** — each an ordered
  table over facts, never a count of search hits
  ([ADR 0058](adr/0058-a-task-knows-enough-by-levels-on-its-own-work.md)).

A host proposes what it found with `--with-refs`; a file or symbol the tracked tree does not hold is refused by name.
Discovery rounds are checkpoints on the task's own work (`work checkpoint <w-…> --asked="<source · target>"`): they stop
after five, or after two in a row that settle nothing new, and an answer still fresh is not asked again — so the next
session re-reads only what went stale. Composing the package writes nothing.

```bash
node cli/context.mjs --for="<task>" [--work=<w-…>] [--json]
node cli/context.mjs --with-refs --json < refs.json   # {"task": "…", "refs": [{"kind": "file|symbol", "ref": "…", "why": "…"}]}
```

### Project memory

Orbit keeps what it learns about a project in the store, reads memory first and re-reads the repository only when
something moved — and prints that decision. Each fact names its evidence and its scope, and freshness is measured
against that scope, never HEAD: `stale` means "revalidate", never "false"; an uncommitted edit is `unknown`; a scope
deleted, renamed away or gone on a branch switch is `GONE`.

| Memory | What it keeps | Commands (`node cli/…`) |
| --- | --- | --- |
| Architecture | modules, boundaries, gates and the system graph (below); `ensure` normally answers `CURRENT` after a few git calls | `architecture.mjs ensure`, `facts`, `why <id>`, `graph`, `diff` |
| Technologies | what is declared, used and configured (a technology is not a capability); integrations by system *and* operation; `resolve` says reuse, build, unknown or blocked, and never acts | `intelligence.mjs ensure`, `technologies`, `integrations`, `resolve <intent>` |
| Engineering conventions | how this project builds code, from tracked files and the checks that passed | `engineering.mjs facts`, `why <id>`, `doctor` |
| Knowledge | claims, each a relation in a context (two contexts are two claims); authority derived: rule · adopted · source · confirmed · host-memory · inference | `knowledge.mjs claims --for="…"`, `opportunities` |
| Lessons | what repeated in independent sessions (two machines or two UTC days); one session is only an observation | `learn.mjs lessons`, `why <id>`, `recall` |

The **system graph** (`architecture graph`) projects the running system — nodes (components, workloads, interfaces,
channels, schedules, stores) and relations (calls, publishes-to, consumes-from …), each with evidence, freshness and
unknowns. `ensure` reads what composition files declare; the rest arrives as candidates through `architecture record`,
which refuses untracked files and secret attributes; what a kind means comes from the vocabulary
(`catalog/topology.json` plus organisation and project layers). `orbit-reverse-engineer` runs a standalone pass.

A capability nothing provides is remembered as one **opportunity** and work goes on; only a person decides it
(`knowledge decide <opp-id> defer|accept|ignore|reopen --human`). The **engineering observer** is on by default and
bounded: a milestone only (a commit, a session's end, a check passing after an edit, a completed task), at most four
times a session, never stronger than `observed`, and only in a checkout the machine knows (one Orbit was used in, one
that commits `ui-tests/`, or `ORBIT_UI_TESTS`); `engineering doctor` says whether it ran and what stopped it. Your
**host's memory** is a hint: it can point discovery somewhere, but never becomes a fact or enters the store, and current
source always outranks it.

### Coordinated workflows and playbooks

`/orbit-help` with a concrete task starts a **coordinated workflow**
([ADR 0017](adr/0017-a-coordinator-is-a-task-that-dispatches-to-owners.md)): a task whose every step is an owner's —
a frozen requirement, runtime understanding, an engineering task, an investigation, a project playbook — settled only on
that owner's record. One step runs at a time; the plan is a graph the engine's tables draw, revised only on evidence (at
most `execution.maxReplans` times). The engine calls no model, and its limits are a person's, set in Orbit Control.

When a workflow needs a capability nothing provides, the skill factory drafts a **project-scoped playbook**: a
`SKILL.md` and, for a sequence of calls to capabilities this machine already has, a declared `workflow.json` — data,
never code. The engine validates it, registers it and runs it pinned to one version, each step through its provider's
own gate (the MCP broker or the capability pipeline) and every call a receipt of digests; later workflows reuse the pin
([ADR 0030](adr/0030-a-generated-skill-declares-a-workflow-the-engine-runs-through-owner-gates.md)).

```bash
node cli/automation.mjs status | plan --for="<objective>" | context <task> | reconcile <task>
node cli/skill-factory.mjs discover --for=release.readiness.verification   # reusable (and its pin) or which gap
node cli/skill-factory.mjs workflow <id|pin> | runs <id> | review <id>     # its steps; its runs; a successor proposed
```

### Autonomous engineering

`orbit-engineer` (`autonomous-engineering.mjs`) takes a requirement to a verified change in the task's own workspace, a
local clone; your checkout, `.git` included, is never written.

- **Held to what it reaches** ([ADR 0019](adr/0019-a-change-is-held-to-what-it-reaches.md)): the changed paths and
  the component graph decide which declared checks are REQUIRED; the rest are NOT AFFECTED, never a pass. A path nothing
  holds, or a changed component nothing tests, is MISSING and blocks completion. A failure its baseline already had is
  `failed-as-before` — shown, never a pass — and at least one required test or verify command must pass.
- **Only declared checks run**, by id, as argument lists. What stopped one comes from facts, never an error's words:
  `DEPENDENCY` (the dependency restore failed), `ACCESS` (a target the component requires is unreachable),
  `ENVIRONMENT` (it cannot run here, or failed this way before any change), `CODE`, `TEST`, `CAPABILITY`,
  `REQUIREMENT`, `DATA`, `SCOPE`, `UNKNOWN` — a class picks what to look at next, never a verdict. Three attempts on one
  failure signature are `NO_PROGRESS`.
- **Commit, then push on approval:** a verified change is committed by itself; that exact commit is pushed only after
  one approval in Orbit Control. It never merges.

Start one with `autonomous-engineering.mjs start --ref=<item>` (or `start "<objective>"`). Its context ends with a `DO`
line, the one command that goes on (`step` with the decision on stdin, or `reconcile`). `task why <task>` says how each
decision settled — a receipt, or REPORTED and never proven — and which receipt moved the task next.

#### Check observation adapters

While a declared check runs beside an engineering task, Orbit reads its output through one adapter, chosen by the
command and its output. What it observes is shown live in Orbit Live and never changes the verdict:

  | Adapter | Framework | Cases shown |
  | --- | --- | --- |
  | `dotnet-test` | the .NET test platform's console report (VSTest or Microsoft.Testing.Platform) | failures |
  | `tap` | a TAP stream (Test Anything Protocol 13 or 14) | reported |
  | `generic` | any command | none |

### Unified work tracking

When `/orbit-help` gets a concrete task, Orbit follows it as one **work** (`w-…`) from the request to what it came to,
whether you work it in the session (`developer`) or an engineering task or workflow takes it (`autonomous`). A tracked
work keeps its identity, links and what was reported; what a task did, which verdict a check earned and what changed
stay with their owners and are read back on every view. Tracking creates no task, sandbox or workflow, grants nothing
and never blocks the work. It is shown on three separate axes:

- **Lifecycle:** `RECEIVED`, `IN_PROGRESS`, `INTERRUPTED`, `WAITING`, `BLOCKED`, `PAUSED`, `REPORTED_DONE`, `FAILED`,
  `CANCELLED`.
- **Evidence:** `none` · `observed` · `reported` · `verified` — only a completed linked task is `verified`, and an edit
  observed after it takes that away.
- **Liveness:** whether a session is still on it (`ACTIVE`, `QUIET`, `ENDED`, `NONE`), never a lifecycle.

Files are the paths an edit tool was seen writing while a session was bound, never the checkout's dirty files; a check
is a command named like one, with how it ended, never "passed". `track.mjs status [<w-…>]`, `list` and `coverage` (what
this host lets tracking see; [docs/hosts.md](hosts.md) has the table) read it back.

### Running the application

`orbit-runtime` works out what a checkout needs to run from its own files — manifests, version files, container and dev
container files, pipelines, build files — and runs none of them to find out. A command is launched only as a file
declared it, as an argument list. Orbit stops only what it can prove it started (a receipt, a pid and the pid's start
time agree); a port in use blocks the start and names its holder, and is never freed or moved. A task's **sandbox** is
its own — containers, an internal network, leased ports, each fingerprinted and receipted — and never reuses your
running application. Writing the repository (`runtime adopt`) is the primary-checkout-write boundary: only you, in
Orbit Control. Commands: `runtime.mjs discover`, `status`, `doctor`, `design`, `start|stop [--component=<key>]`.

### UI test cases

The Orbit Engine runs UI test cases written as plain JSON through `playwright-cli`. A case names controls by their place
in the project's UI map (`"on": "home/Add"`), so a moved locator is corrected once, in the map, and each verdict rules on
one layer — the screen (`ui`), the call it made (`api`) or the row it wrote (`sql`):

```json
{ "id": "create-thing", "name": "Create a thing", "start": "home", "creates": "one thing ${NAME}", "seen": "live",
  "params": [{ "n": "NAME", "required": true }], "steps": [
  { "do": "goto", "screen": "home", "wait": "document.body.innerText.length>0" },
  { "do": "click", "on": "home/Add", "wait": "document.querySelector('[role=dialog]')" },
  { "do": "fill", "on": "dlg-thing/Name", "value": "${NAME}" },
  { "do": "click", "on": "dlg-thing/Save", "wait": "document.body.innerText.includes('${NAME}')" },
  { "do": "api", "match": "api/things", "method": "POST", "status": 201 },
  { "do": "sql", "query": "SELECT COUNT(*) AS n FROM Things WHERE Name='${NAME}'", "expect": "Number(it[0].n) === 1" } ] }
```

PASS is earned and says what it proved (`proved ui n · api n · sql n`); no verdict executed is `INCONCLUSIVE` (4); an
unreachable database is `BLOCKED` (3), since the product is not broken when a laptop is off the VPN; a case refused
before the browser (invalid, a missing parameter, a destructive case without its flag, no signed-in session) is
`REFUSED` (2). A screen can show a write that never happened, so a case that declares `creates` and rules only on the
screen is a finding. `--report` writes one self-contained HTML page into the store, and `run-case <that-report.html>`
runs the case again. Self-healing is never "change the test until it passes": `orbit-failure-analyst` classifies a
failure into one of nine causes, and only that cause's owner repairs its own artifact (`orbit-dsl-doctor` a case's form,
`orbit-map-healer` one locator). Cases an agent writes stay in the store's drafts, even after a PASS, until a person
promotes them.

```bash
node cli/run-case.mjs create-thing NAME=TC-1 --dry      # resolve and print the plan; no browser, no database
node cli/run-case.mjs create-thing NAME=TC-1 --report   # run it, with a self-contained HTML report
node cli/query.mjs dsl | verb sql | check | triage      # the vocabulary; one verb; integrity; what a run's evidence shows
node cli/qa-plan.mjs coverage <plan-id>                 # criterion → scenario → case → run → evidence
```

### Autonomous QA

`orbit-qa` runs an **investigation** of a live application: the host chooses one next step at a time, as a decision the
engine judges before anything runs. What is still owed, why to stop and what a finding concludes are derived from the
investigation's journal, never from the host's word. Its mode bounds what it may do: `observe` (read only),
`explore-write` (synthetic `TC-` data; never a destructive control), `security-test` (an authorised tenant-isolation
matrix), `regression` (accepted cases through `run-case`) or `fixture-write` (generated tests that write, only in a
task's isolated sandbox, each write under a grant). Every mode but `observe` runs only where a person approved it for
that environment.

**Generated tests** go from an accepted requirement to a verified outcome: obligations derived from accepted plans
against the frozen system graph; a design the host proposes, whose every verdict and page script the engine compiles
from the accepted criteria and fixed templates; a frozen version run only in a task's isolated sandbox (Docker); and
what the worker left validated before anything is recorded. Backends are reached through adapters (`orbit.adapter/v1`)
in packs a project opts into, each proven by conformance receipts
([ADR 0052](adr/0052-an-adapter-operation-declares-what-its-request-carries.md)). A verdict must depend on the
application, never on what the design itself causes: every contradiction rule reads one model of what a design causes
(`src/qa/backend/causes.mjs`) — since 0.6.0, `NEVER_DECIDED` refuses a design that waits on a schedule whose injected
clock never moved, and `CLOCK_PASSED` advises when it only moves the clock where an earlier test already took it.
Security catalogs (by default ASVS 5.0.0 L1, labelled with OWASP Top 10 2025 and API Security Top 10 2023), limits and
isolation are a person's, in Orbit Control
([ADR 0040](adr/0040-standards-and-policies-are-configured-in-orbit-control.md)); Orbit never says "compliant".

```bash
node cli/autonomous-qa.mjs plan --objective="…" --plan=<id> --sandbox=<env-id> --mode=fixture-write
node cli/autonomous-qa.mjs derive|step|reconcile|finish --investigation=<id>   # a dispatch that never settled is read back
node cli/security-audit.mjs assess --investigation=<id>      # the security controls in effect, from that record
node cli/qa-plan.mjs expects <contract.json>                 # OpenAPI, AsyncAPI or schedule → candidate expectations
node cli/query.mjs adapters --matrix                         # what each adapter is proven to support
```

### Orbit Satellite

`/orbit:satellite <goal>` (or `node <plugin-root>/satellite/cli/satellite.mjs` on any host) runs a **mission**: the goal
becomes a structured intent, an investigation comes before deciding who changes what, and the work graph is revised only
on evidence. Roles, agent templates, skills and workflows are reused first and generated only when nothing fits, each
pinned by digest. Every unit runs as a fresh agent under a least-privilege profile, source changes happen only in an
engineering task's own workspace, and a criterion is verified only by an independent owner's record.

```bash
node satellite/cli/satellite.mjs mission start --stdin < goal.txt      # the goal is kept as submitted
node satellite/cli/satellite.mjs mission context <msn> | step <msn> < decision.json
node satellite/cli/satellite.mjs live tui <msn> | host capabilities    # Satellite Live (nine views); what this host can do
```

Claude Code dispatches agent runs natively and in parallel; Codex, Antigravity CLI and Grok Build run them one at a time
in the main session. Each run says which host agent carries it, and how anybody knows (0.2.2,
[ADR 0044](adr/0044-run-identity-and-attribution.md)): `HOST_OBSERVED` (the hooks saw the Agent call carrying the
run's envelope launch that agent), `REPORTED` (only the dispatcher said so, with `agent ack <msn> <arn>
--host-agent=<agentId>`), `CONFLICTING` (two agents named for one run, or one for two runs: neither is chosen) or
`UNATTRIBUTED` (a serial run, or nothing observed). In `live tui`, press `2`, pick a run with `j`/`k` and `enter` to see
its pins, parent and children, host agent and the basis of that word, its calls and its records. Details:
[satellite/docs/README.md](../satellite/docs/README.md), [ADR 0041](adr/0041-orbit-satellite-is-a-mission-journal-above-owners.md).

### Autonomous self-improvement

Orbit improves this project's **declared playbooks** and **Satellite roles** from what they actually did, and only on
independent evidence ([ADR 0045](adr/0045-autonomous-self-improvement-on-independent-evidence.md)).
**Detect** — the owners' run records become signals, one opportunity per problem; a single failure, retries in one
session, a provider, an environment or an approval never count. **Generate** — only a defect of the definition itself
gets a successor, drafted by the skill factory and staged as a candidate nobody is offered. **Validate** — one that
widens its tools, drops a required step, loosens a success rule or carries anything executable is refused before it
runs. **Evaluate** — candidate and current version run the same frozen inputs through the same gates; it is better only
when two independent sessions (two UTC days or two machines) say so and none says otherwise. **Promote** — twelve
gates, then the owner's own door picks it for new work; a pin a task holds never moves. **Monitor** — a regression in
independent sessions puts the replaced version back.

It runs by itself after a workflow and from the hooks, but never evaluates there. Every switch and bound is a person's
(`improvement.*` in Orbit Control); with automatic promotion off, a qualified candidate waits for a person, and nothing
it does crosses a protected boundary. Commands: `improve.mjs status`, `analyse [--dry]`, `resume <imp-id>`,
`evaluate <imp-id>`, `metrics` (nine metrics, each with its numerator and denominator).

### The session trail

The hooks keep a trail of what each session did through Orbit, on this machine only, as metadata by allow-list: per
prompt a salted fingerprint, its length and what the router decided; which skills and agents started; which Orbit
commands (and classes of other command) ran and how they ended; where a turn ended; a line of advice as `advice.given`
(table words, never the sentence). Never a prompt's text, a response, an argument, a tool's output, a path or a file's
contents. It is kept 90 days and sent nowhere, and its views are folds rebuilt on every read, so a terminal and Orbit
Control's Trace and Analytics pages always agree. `trace activation` shows how a suggestion became an outcome —
suggested → selected → dispatched → executed → verified, with only an owner's record ever verified — and marks a turn
that dispatched more agents than its strategy accounted for as **over-delegated**. Read it with `trace.mjs turns`,
`turn <turn-id>`, `usage`, `activation` and `where`.

### Project reports

`orbit-report` builds a product owner's report from GitHub or Azure DevOps — pull requests, reviews, work items,
pipelines. A run collects once and freezes the snapshot, and every render reads only that snapshot: nothing after the
cut-off counts, a gap is "not available (needs …)" and never a zero, and a forecast never reaches past the window it has
history for. The result is one offline HTML page. When a report lacks what you asked for, Orbit may build, verify and
activate the smallest report part for this project (a metric, a section, a transform, an exporter) — never one that
replaces a standard part, needs a package, reads the source's API or a credential, or reaches another project. A GitHub
connection reads with a token (named by an environment variable, or stored through Orbit Control in the OS secret
store); an Azure DevOps connection signs in with Microsoft by default.

```bash
node cli/project-report.mjs run [--months=N | --from=D --to=D | --all] [--dry]
node cli/project-report.mjs render [<run-id>|latest]                   # again, asking no source
node cli/project-report.mjs status | settings | parts | runs | connections | probe
```

#### Microsoft sign-in for Azure DevOps

Orbit's Microsoft sign-in is independent of your own Azure CLI login: it keeps a separate Azure CLI profile in its
machine store, and never changes your account, subscription, configuration or login session. You may be signed in as
account A in your terminal and as account B in Orbit at the same time. Sign in once per machine, and every project that
uses the connection reads with it; a personal access token is the alternative
([ADR 0043](adr/0043-orbit-signs-in-through-an-azure-cli-profile-of-its-own.md)).

```bash
node <plugin-root>/cli/project-report.mjs connect <id> --provider=azure-devops --organization=<org>   # signs in with Microsoft (the default)
node <plugin-root>/cli/project-report.mjs sign-in <id> [--tenant=<id>] [--device-code]
node <plugin-root>/cli/project-report.mjs sign-out <id>                                              # Orbit's profile only
node <plugin-root>/cli/project-report.mjs connect <id> --provider=azure-devops --organization=<org> --auth=credential --credential-env=<NAME>   # a personal access token instead
```

Orbit Control › Connections shows each connection's state and lets you check it, sign in and sign out. When a read says
sign-in is required, run `sign-in` yourself (in Claude Code, type `! node <plugin-root>/cli/project-report.mjs sign-in
<id>` at the prompt): the browser step is yours.

| | |
| --- | --- |
| **How it signs in** | The Azure CLI's browser sign-in (a device code with `--device-code`), in Orbit's own profile. Orbit asks the CLI for a short-lived Azure DevOps token each time it needs one and keeps it in memory only; it signs in again only when the CLI says you must act. |
| **Which `az` runs** | 1. a private copy Orbit already installed; 2. your machine's own `az`, used only as a program (it must start, be 2.61.0 or newer and belong to this operating system), never its sign-in; 3. a private copy Orbit installs by itself when neither is usable; 4. otherwise a blocked answer that names every candidate. To make the private copy win over your own `az`, install it from Orbit Control's Tools page. |
| **What Orbit installs** | Only in step 3, into Orbit's store: on Windows x64 Microsoft's official Azure CLI 2.91.0 ZIP (91 MB, SHA-256 checked); on macOS and Linux a Python of Orbit's own plus the official `azure-cli` 2.91.0 wheels from PyPI, every distribution pinned and hash-locked (150 of them; about 200 MB to download, about 700 MB on disk). No administrator rights, nothing on PATH, no package manager, no `sudo`, no Program Files, no Homebrew, no system Python. It is a tool Orbit runs, not a dependency of the engine. |
| **Per platform** | A private copy on Windows x64 (the official ZIP), macOS arm64 and x64, and Linux x64 and arm64 with glibc (the locked Python environment). None on Windows ARM64 (Microsoft publishes no ARM64 build; an x64 `az` you already have is started through its own wrapper, never a shell) or Alpine (musl: the Python Orbit installs is a glibc build). Under WSL, as Linux, with its own Orbit state; a Windows `az` reached through WSL, or a profile on a Windows drive, is refused. Full table: [ADR 0043 › Platforms](adr/0043-orbit-signs-in-through-an-azure-cli-profile-of-its-own.md#platforms). |
| **What it never does** | Import or copy your session, or ask to; read `~/.azure` or `%USERPROFILE%\.azure`, or Azure CLI's token-cache files; change your subscription, extensions or configuration; install the Azure DevOps CLI extension; create a personal access token. |
| **On Windows** | The sign-in is the browser flow. The Windows account broker is turned off for Orbit's profile because it keeps a session outside the profile, shared with your own `az`; so there is no Windows Hello or single sign-on, and a tenant that requires a compliant device through the broker may refuse it. Use a personal access token there. |
| **Scope** | Azure DevOps Services. Microsoft Entra authentication is not available for Azure DevOps Server collections, which use a personal access token. The token is yours for Azure DevOps and is not narrowed to read-only the way a personal access token can be; Orbit's readers only read. |

This covers the Azure CLI processes Orbit starts for its own sign-in; a tool a project's own capability declares
(`tools: ["az"]`) and `query doctor` run as the project asked. How far each platform was run for real, and how far only
resolved or faked: the [platform evidence table](adr/0043-orbit-signs-in-through-an-azure-cli-profile-of-its-own.md#platform-evidence).

### Extending Orbit in your project

Everything specific to your product lives in your project's data and in what it opts into, never in the engine:

- **Project QC tools.** When a test needs what no built-in verb can do — a second database, a vendor SDK, a queue —
  `orbit-qc-builder` builds the smallest project-local *capability*, which a case asks through the one `call` verb. It
  lives outside the repository, is loaded for real into a throwaway context before it is trusted, and is registered only
  once it verifies (`qc-tool new`, `verify`, `register`). It sees a narrow facade — no store, no ledger, no environment,
  no way to write a verdict — and its own crash is `BLOCKED`, never a defect in your feature.
- **Packs** stay inert until `project.json` lists them in `packs`: `orbit-api-test` (HTTP reads and writes) and
  `orbit-backend-test` (messaging, schedulers, jobs, state, fixtures, the clock, identity — each answered by the adapter
  that discovery and its declared semantics select).
- **MCP servers** are added and policed in [Orbit Control](#orbit-control); a session calls a managed one through every
  gate: `node cli/mcp.mjs call <server> <tool> --for=<capability> --input='{…}'`. `query capabilities` and
  `query extensions` say what a `call` step may ask here, and what loaded or was refused, and why.

## Orbit Web

[Orbit Web](../integrations/orbit-web/README.md) (0.8.0) is the Governed Agentic Workplace the repository's
[README](../README.md) presents: its own accounts, AI connections, a virtual office of AI employees each working in
containers of its own, and the account's governance. It runs this plugin in its chats (`claude -p --plugin-dir
/opt/orbit/plugin`), and an employee uses it where the account's owner grants it. Run it and use it from
[its README](../integrations/orbit-web/README.md#run-it).

## Developing Orbit

```bash
node --test                                                  # the suite (npm test): no browser, no network, no sleeps
node cli/check-five-lines.mjs src cli skills --strict         # Five Lines (npm run lint): must print 0 finding(s)
ORBIT_UI_TESTS=test/fixtures/ui-tests node cli/query.mjs check
ORBIT_UI_TESTS=test/fixtures/ui-tests node cli/plan-check.mjs
node skills/orbit-release/ship.mjs --ci                      # the whole definition of done, one command (the fast tier)
node skills/orbit-release/panel.mjs                          # Orbit Control on its own Node: server tests, panel build
node acceptance/run.mjs [--stack=…] [--variant=…]            # optional native backend acceptance: planted defects (Docker)
```

Run one suite at a time: two at once interfere. Before changing code, read:

- [AGENTS.md](../AGENTS.md) — the rules every change is held to: invariants, dependency direction, enforced rules,
  commands, the definition of done
- [docs/architecture.md](architecture.md) — the architecture: layers, dependency direction, where data lives
- [docs/agents/layout.md](agents/layout.md) — the module map: what each directory and module is for
- [docs/agents/extend.md](agents/extend.md) — for each kind of change, what to touch and the test that proves it

In short: zero dependencies; every function body has at most five statements, with no `else` and no `switch`; the DSL
vocabulary is data (`src/dsl/`); no product, vendor or stack is named in engine code; and anything a consumer can
observe — CLI names and flags, exit codes, `ORBIT_*` variables, the `ui-tests/` layout, the DSL — is a contract:
changing one is a major version and adding to one a minor version, bumped in all five manifests.

### Releasing and the independent evaluator

A release qualifies on the fast tier plus the **independent evaluator**'s record of that very artifact (`evaluator/`, a
package of its own that imports nothing of Orbit and never ships;
[ADR 0057](adr/0057-an-independent-evaluator-measures-a-release.md)). It runs one task with the same model, effort,
tools, limits and prompt in arms that differ only by the plugin — the plain host, Orbit at the previous release, Orbit
at the release candidate (mini-SWE-agent as a second host makes it a 2 × 2) — and grades each patch by hidden tests in a
fresh container with no network, never by the agent's word. What runs and how it is judged (task packs and SWE-bench
Verified instances, development and held-out sets, the verdict rule) is pre-registered in
`evaluator/prereg/<release>.json` before any model run. The verdict — IMPROVED, NO_DIFFERENCE, REGRESSED or
INCONCLUSIVE — is said as what it is; a one-task difference is INCONCLUSIVE, never a gain.

```bash
node evaluator/cli.mjs checks | prereg verify                # its own checks; the registered order, re-derived
node evaluator/cli.mjs prereg campaign final --rev=<commit>  # a campaign, made from the pre-registration
node evaluator/cli.mjs run <campaign.json> | resume <id> | status <id> | report <id> --md
node evaluator/cli.mjs record --campaign=<id>,<id> --out=<record.json>
node skills/orbit-release/ship.mjs --evidence --evaluation=<record.json>   # the publish gate: PUBLISHABLE, or why not
```

The tag `v<version>` goes on the merge commit only after `--evidence` says PUBLISHABLE on the pushed head; the gate
itself never tags, pushes or publishes. No GitHub workflow gates the plugin; the one scoped exception is Orbit Web's two
workflows (pull-request checks for `integrations/orbit-web/**`, and its image published by hand behind a reviewer,
[ADR 0060](adr/0060-orbit-web-a-browser-host-around-the-official-clis.md)). More: [evaluator/README.md](../evaluator/README.md),
[skills/orbit-release/SKILL.md](../skills/orbit-release/SKILL.md), and [AGENTS.md › Claude Code](../AGENTS.md#shipping-a-release-from-claude-code-cloud) for running the campaigns
from a Claude Code cloud session.

## Further reading

| Document | About |
| --- | --- |
| [docs/architecture.md](architecture.md) | The architecture: layers, dependency direction, data |
| [docs/hosts.md](hosts.md) | How each host binds Orbit: hooks, sessions, what each host can show, native acceptance |
| [docs/orbit-current-contract.md](orbit-current-contract.md) | Current contracts and fresh-install behaviour |
| [docs/adr/](adr/) | Architecture decision records |
| [control-server/README.md](../control-server/README.md) | Orbit Control |
| [satellite/docs/README.md](../satellite/docs/README.md) | Orbit Satellite |
| [evaluator/README.md](../evaluator/README.md) | The independent evaluator |
| [integrations/orbit-web/README.md](../integrations/orbit-web/README.md) | Orbit Web |
| [integrations/vscode-orbit-live/README.md](../integrations/vscode-orbit-live/README.md) | The VS Code companion for Orbit Live |
| [CHANGELOG.md](../CHANGELOG.md) | What changed in each release |
| [docs/github-orbit-repo.md](github-orbit-repo.md) | Publishing the repository |

## License

MIT — see [LICENSE](../LICENSE).
