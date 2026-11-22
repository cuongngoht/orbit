# Orbit

**From Goal to Verified Outcome**

Orbit is a plugin for AI coding hosts — **Claude Code**, **Codex**, **Antigravity CLI** and **Grok Build**. You describe
a goal (a PBI, a bug, an engineering objective); Orbit takes it through requirements, planning, implementation, testing
and review, and calls it done only when there is **evidence** that it is done. Along the way it keeps what it learns
about your project, runs UI tests written as plain JSON (checking the screen, the API call and the database row),
investigates a running application the way a QA engineer would, and shows its work in a viewer beside your session.

- **Local and private** — all state lives on your machine, outside your repository. No cloud service.
- **Autonomous by default** — Orbit works on its own; a person is asked only at a few **protected boundaries** (writing
  your checkout, a git push, a production deploy or migration, destroying production data).
- **Governed** — deterministic engine rules check every action; the boundaries, catalogs and limits are a person's.
- **Evidence-based** — a step is verified only by a record its owner keeps: a passing check, a test run, a QA report.
- **Product-neutral** — the engine names no product, vendor or stack; your project declares its own.
- **Zero dependencies** — plain Node.js 20 or newer, with no npm packages.

This README describes Orbit **0.6.0** and Orbit Web **0.8.0**. What changed in each release: [CHANGELOG.md](CHANGELOG.md).

## Contents

1. [Install](#install)
2. [Quick start](#quick-start)
3. [How Orbit works](#how-orbit-works)
4. [Skills](#skills)
5. [Command line](#command-line)
6. [Where your data lives](#where-your-data-lives)
7. [Settings and switches](#settings-and-switches)
8. [Orbit Live and Orbit Control](#orbit-live-and-orbit-control)
9. [Feature guides](#feature-guides) —
   [goals](#goals) ·
   [requirements, work and tasks](#requirements-work-and-tasks) ·
   [project context](#project-context) ·
   [project memory](#project-memory) ·
   [coordinated workflows](#coordinated-workflows-and-playbooks) ·
   [autonomous engineering](#autonomous-engineering) ·
   [check observation](#check-observation-adapters) ·
   [work tracking](#unified-work-tracking) ·
   [running the application](#running-the-application) ·
   [UI test cases](#ui-test-cases) ·
   [autonomous QA](#autonomous-qa) ·
   [system graph](#system-graph) ·
   [Satellite](#orbit-satellite) ·
   [self-improvement](#autonomous-self-improvement) ·
   [session trail](#the-session-trail) ·
   [project reports](#project-reports) ·
   [extending Orbit](#extending-orbit-in-your-project)
10. [Orbit Web](#orbit-web)
11. [Developing Orbit](#developing-orbit)
12. [Further reading](#further-reading)

---

## Install

**Requirements:** Node.js 20 or newer, and nothing else for the engine. Orbit Control needs Node 24.15 or newer and
finds one by itself; UI tests need `playwright-cli` ([check the install](#check-the-install)).

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

Installing does not trust the hooks: review and trust them in Codex afterwards. Enable only one Orbit installation per
workspace. Details: [docs/codex.md](docs/codex.md).

### Antigravity CLI

```bash
agy plugin install <plugin-root>
```

Details: [docs/antigravity.md](docs/antigravity.md).

### Local development

From a clone of this repository: `claude --plugin-dir .`

### Check the install

`<plugin-root>` is the directory the host installed Orbit in (inside a skill on Claude Code, `${CLAUDE_PLUGIN_ROOT}`).
Every command is `node <plugin-root>/cli/<tool>.mjs`, called by its path: Orbit puts nothing on your PATH.

```bash
node <plugin-root>/cli/orbit.mjs doctor           # where the goals store is, and how many goals it holds
node <plugin-root>/cli/query.mjs doctor           # are the tools this project declares (playwright-cli …) usable here?
node <plugin-root>/cli/setup.mjs --install        # install the declared tools that have a package name
node <plugin-root>/cli/live.mjs doctor --claude   # can Orbit Live show a task here, and where?
```

How each host binds the plugin root and the session: [docs/hosts.md](docs/hosts.md). Source:
[github.com/cuongngoht/orbit](https://github.com/cuongngoht/orbit) (public, MIT).

---

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
4. **Or just ask.** Describe the change, the bug or the question in plain words, in English or Vietnamese. The
   [prompt router](#the-prompt-router) suggests the skill or agent that fits, or adds nothing when none is needed.
5. **Watch it work** in [Orbit Live](#orbit-live), beside your session. Normal development needs no approval; when work
   reaches a [protected boundary](#protected-boundaries), decide it in [Orbit Control](#orbit-control) (`/orbit-control`).

---

## How Orbit works

```text
 Goal ──► Requirement ──► Plan ──► Task (own workspace) ──► Checks / QA ──► Evidence ──► Report
           snapshot        units    build · test · fix       verified by      kept by
                                                             their owner      its owner
 Everything above is kept on your machine, in the Orbit store, never in your repository.
```

Three parts work together. The **host's model** reasons: it reads the goal, chooses the next step and writes the code.
The **engine** (plain Node.js commands under `cli/`) keeps the state in append-only journals, judges each step before it
runs and settles it with receipts. The **hooks** watch the session and add a line only where Orbit has something to
say. [Orbit Live](#orbit-live) shows what the journals hold; [Orbit Control](#orbit-control) is where a person decides.
Layers, dependency direction and data: [docs/architecture.md](docs/architecture.md).

| Idea | What it means for you |
| --- | --- |
| **The host reasons, the engine keeps state** | The model proposes the next step; the engine judges it, records it before it runs and settles it with receipts. |
| **Every artifact has one owner** | A requirement, a task, a check, a QA investigation each own their records. Nothing re-judges another owner's verdict. |
| **PASS is earned** | No verdict executed means `INCONCLUSIVE`, never a pass. A failure that existed before your change shows as `failed-as-before`, never hidden. |
| **Your repository is untrusted data** | Orbit runs only commands your project files declare, as argument lists — never a shell line a model wrote. |
| **Changes happen in isolation** | An engineering task edits and commits in its own workspace (a local clone), never in your checkout. |
| **Autonomous by default** | Building, testing, QA, sandboxes, containers, local databases and local commits run without asking anybody. |
| **A person decides at the boundary** | A push, a production deploy or migration, and destroying production data wait for one approval of exactly that action; writing your checkout is yours alone. An agent cannot approve its own action. |
| **No product knowledge in the engine** | Products, vendors and stacks live in your project's data, or in adapters and packs a project opts into. |

---

## Skills

Name a skill yourself (`/orbit-help`; in Claude Code also with the plugin prefix, `/orbit:orbit-help`), or let the host
pick one: it reads each skill's description, whose first sentence says *when* to use it. Every description fits the
host's listing budget (at most 300 characters, 7,500 for all 26), which `test/activation-catalog.test.mjs` holds.

### Entry points

| Skill | Use it for |
| --- | --- |
| **`/orbit`** | A whole specification — a PBI, a bug report, a goal with several requirements or acceptance criteria — taken to a verified outcome: analyze → plan → execute → verify → report. Pass the complete text. For one change, use `orbit-develop`. |
| **`/orbit-help`** | Not knowing where to start, or a task that needs several owners in turn (a work item, a code change, the running app, QA, regression, review). Starts or resumes a coordinated workflow, or names the one skill that fits. |
| **`/satellite`** | A goal run as an autonomous multi-agent mission: a work graph, least-privilege agents, every criterion settled on an independent owner's record. |

### Engineering

| Skill | Use it for |
| --- | --- |
| `orbit-requirements` | Turn a work item, PBI, issue, ticket or user story into atomic requirement facts and one frozen snapshot, asking a person only what blocks. Never decides a requirement itself. |
| `orbit-engineer` | Take a requirement or objective autonomously to a **verified** change in a task-owned workspace: plan, build, test, diagnose, fix, regression, review; it commits, and a push waits for approval. |
| `orbit-develop` | Implement a feature, fix, refactor or rename directly in this checkout, the way this project builds code: project context first, the smallest change, verified, reviewed. |
| `orbit-runtime` | What this checkout needs to run and whether this machine can run it; start or stop what its files declare; a port conflict, an unreachable database, a dev container. |
| `orbit-architecture` | Architecture questions — what the project is made of, where an integration belongs, whether a capability exists — from a kept, evidence-backed snapshot that re-reads only what moved. |
| `orbit-reverse-engineer` | Map the running system (components, workloads, interfaces, queues, schedules, stores, and what talks to what) as a kept system graph. |
| `orbit-dotnet` | Which technologies a .NET solution declares, what its code really uses each for, how it is wired, and whether to reuse or build. |
| `orbit-research` | How a library, SDK or API behaves, answered from a source for the version this project's manifest pins (official documentation first), and kept as knowledge scoped to that version. |
| `orbit-learn` | Dated lessons, with evidence, from what repeated across independent sessions; recall, record or forget one. Never decides PASS. |
| `orbit-improve` | Improve this project's generated playbooks and Satellite roles from evidence: the smallest successor, evaluated against the current version on frozen inputs. |

### Quality and testing

| Skill | Use it for |
| --- | --- |
| `orbit-qa` | Investigate a live application like a senior QA engineer, one step at a time inside approved limits, watching screen, network and data; it reports only what it proves. |
| `orbit-test-plan` | Decide *what* to test before any test is written: known versus assumed, one checkable, risk-ranked plan per feature. |
| `orbit-ui-test` | Run or author ONE JSON UI test case: one command drives it through `playwright-cli` and verifies UI, API and SQL, with evidence on failure. |
| `orbit-test-suite` | Run an agreed set of cases the way a tester does — the browser profile, evidence for each — and write one review page. |
| `orbit-ui-map` | Fill and correct the UI map (screens, controls, effects) from the declared frontend source, then confirm it live. |
| `orbit-ui-explore` | Explore a screen nobody wrote cases for; leave candidate map records, cases that survived a real run and a session sheet. |
| `orbit-browser` | Pick a browser and a signed-in profile on this machine and open a test session on a copy of it. No password is read. |
| `orbit-sql` | Read-only SQL Server checks for a UI test through `sqlcmd`: one `SELECT` per call, the connection from `ORBIT_SQL_*`. |
| `orbit-qc-builder` | Build the smallest project-local QC tool a verification needs when nothing here can do it (a second database, a vendor SDK, a queue). |
| `orbit-security-audit` | Assess the project against the security catalogs it is held to, from evidence, and hand the security obligations to QA. Never says "compliant". |

### Operations

| Skill | Use it for |
| --- | --- |
| `orbit-control` | Start Orbit Control and get its URL: MCP servers, CLI tools, report connections and sign-in, limits and policies, the router. |
| `orbit-report` | A product owner's report from GitHub or Azure DevOps — pull requests, reviews, work items, pipelines — read once, frozen, rendered as one offline HTML page. Azure DevOps signs in with your Microsoft account by default ([how](#microsoft-sign-in-for-azure-devops)); GitHub reads with a token. |
| `orbit-release` | Ship a new version of Orbit itself, or install or upgrade it in another repository. |

### Role agents

Twenty role agents each do one bounded job in a context of their own. Five may be dispatched directly when that job is
the whole request: `orbit-engineering-agent` (drive one engineering task), `orbit-qa-agent` (run one QA investigation),
`orbit-failure-analyst` (classify a failed UI run into one cause), `orbit-dsl-doctor` (repair how a case is written,
never what it means) and `orbit-engineering-observer` (propose what a session taught about how this project builds
code). The other fifteen — the architecture scanner, the reverse-engineering agent, the security auditor, the map healer
and recorder, the QA case writer, the five requirement-roundtable agents and Satellite's four — are dispatched only from
their parent skill's playbook, because each needs that skill's step first: their catalog row names the parent (`via` in
`catalog/components.json`), and the router never offers one on its own.

### The prompt router

Beside every prompt, Orbit's router says how much Orbit the request needs, in one line, or nothing at all
(RouteDecision v3, [ADR 0050](docs/adr/0050-the-host-activates-orbit-by-capability-and-orbit-verifies-what-happened.md)):

| Strategy | When |
| --- | --- |
| **NONE** (adds no text) | a prompt you opened with a slash command (you already chose what runs), a greeting, a status question that asks for nothing else ("how far along are we?", "tới đâu rồi"), a background task's notification the host delivers as a prompt, an opt-out ("without Orbit", "không dùng orbit"), or anything the session already does itself |
| **DIRECT** | names the one skill or agent that fits |
| **COORDINATED** | gives the one command for a change several owners take in turn — a work item to settle, an investigation or a security check to prove it (`/orbit-help`'s workflow) — or for a whole specification (`/orbit`'s goal). A question that only names code ("is the orders endpoint protected?") asks for no change. |
| **SATELLITE** | only ever a mission you asked for |
| **RESUME** | picks up an open work of this checkout through its owner |

English and Vietnamese are read alike; words past the first 2,000 characters (a pasted log or file) never decide what a
prompt is about; a one-word match counts only when it is a skill's own word. The router suggests; the host decides.
`test/fixtures/routing/corpus.jsonl` holds it to realistic prompts in both languages.

**Facts, not only words** (0.6.0, [ADR 0059](docs/adr/0059-proactive-execution-from-facts-said-once-and-explained.md)).
A fact about the session's work brings a skill or agent in too, never a word the engine guessed: a check the session ran
after its edits failed (`check.failed`), the same check failed three times in a row with nothing changed between
(`check.repeats`, said once as no progress), or the session's tracked work has a knowledge need nobody answered
(`knowledge.owed`). A catalog row names the facts its playbook handles (`reactsTo`), and a fact that holds counts for it
as one of its words would — so a check that failed after the last prompt shapes the next prompt's decision.

Switch the router off with the `prompt_router` option or `ORBIT_PROMPT_ROUTER=off`. What each host lets it do:
[docs/hosts.md](docs/hosts.md).

### Follow-through during a session

Where Orbit owns the work, the rest of a session gets at most a line at a time (0.5.0 and 0.6.0):

| Moment | What Orbit adds |
| --- | --- |
| **Session start** (a checkout Orbit knows) | One line of at most 300 bytes — each family's usable count, what you switched off, the project's STATUS word — and, on a resumed or compacted session, its open work and next step. |
| **One of Orbit's agents returns** | One line naming the owner record that settles its work (the workflow, goal, mission or task) and where it stands. What the agent said is its report, never the evidence; its message and transcript are never read. |
| **An Orbit command fails** under the session's governed work | The owner's recovery row beside the usual diagnosis: an action that did not settle is read back with `reconcile`, never sent again. |
| **Any tool call fails** | At most one line of advice — the fact that holds, its subject, the skill or agent that handles it and the call that brings it in — or nothing. An ordered silence table keeps it quiet when the host cannot carry a line, the trail is off, your prompt said stop, nothing holds, the same fact was said this session, this prompt had its line, your work is paused or waiting for you, or nothing here handles it. Nothing is said after a call that succeeded. |
| **Stop, with a workflow step ready** | The turn is held open — at most twice per prompt, never twice in a row — with the step and its one command, or the model says in one sentence why it stops. Never past your pause, cancel, approval or question, never after a turn that only answered a question or a prompt that said stop or wait, never with the trail off. Off: `trigger.holdOnStop`. |
| **Stop, after edits nothing checked** | A turn that edited code a component of this checkout owns, with no passing test or declared verifying check after the edit (a lint or a build alone shows nothing works), is held open once per prompt, naming the safe check that component declares and its command. With no declared check it names the tracked test files Orbit's relation adapters link to the edited files (by the checkout's own test patterns, such as pytest's `python_files`), or asks for a regression test where none covers the change. It runs nothing. Off: `trigger.holdUnverified`. |

The two Stop holds are Claude Code's; each host's row is in [docs/hosts.md](docs/hosts.md). `node cli/trace.mjs
activation` reads back how a suggestion became an outcome — suggested → selected → dispatched → executed → verified,
each from its own source, with only an owner's record ever verified — and marks a turn that dispatched more of Orbit's
agents than its strategy accounted for as **over-delegated**. A line of advice is kept as `advice.given` (the fact, its
subject, the provider and its kind, never the sentence) and counted as suggested.

---

## Command line

Every skill is backed by a command under `cli/`. On any host the reliable form is `node <plugin-root>/cli/<tool>.mjs …`
(below, `node cli/…` for short). Each file starts with its usage, and most commands take `--json`.

| Area | Command | What it is for |
| --- | --- | --- |
| Start | `orbit.mjs` | goals: `goal start`, `analyze`, `plan`, `step`, `status`, `verify`, `report`, `resume`, `list`; `doctor` |
| | `help.mjs` | one recommended next step, and why (`--for="<task>"`) |
| | `automation.mjs` | coordinated workflows: `start`, `context`, `step`, `settle`, `reconcile`, `finish`; `status`, `doctor` |
| | `track.mjs` | unified work tracking: `status`, `list`, `current`, `coverage` |
| Requirements and work | `requirements.mjs` | a work item read into facts, questions and a frozen snapshot |
| | `work.mjs` | the one work a requirement has: needs, bindings, receipts, checkpoints |
| | `task.mjs` | one execution: `list`, `show`, `why`, `events`, `machine`; a person's `pause` and `cancel` |
| Engineering | `autonomous-engineering.mjs` | a task taken to a verified change: `start`, `context`, `step`, `reconcile`, `finish` |
| | `context.mjs` | what a task touches, and whether that is enough (`--for="<task>"`) |
| | `runtime.mjs` | what a checkout needs to run: `discover`, `status`, `doctor`, `start`, `stop`, a task's sandbox |
| Project memory | `architecture.mjs` | the architecture snapshot and the system graph: `ensure`, `facts`, `why`, `graph`, `diff` |
| | `intelligence.mjs` | which technologies, and what each is used for: `ensure`, `technologies`, `integrations`, `resolve` |
| | `engineering.mjs` | how this project builds code: `facts`, `why`, `recall`, `doctor` |
| | `knowledge.mjs` | contextual claims and capability opportunities: `claims`, `verify`, `opportunities`, `decide` |
| | `learn.mjs` | lessons from independent sessions: `lessons`, `why`, `recall`, `remember`, `forget`, `analyse` |
| Testing and QA | `run-case.mjs` | run one JSON UI test case (`--dry`, `--report`) |
| | `query.mjs` | the UI map, the cases and the DSL (`dsl`, `verb`, `field`); `check`, `triage`, `doctor`, `storage` |
| | `qa-plan.mjs`, `plan-check.mjs` | test plans (`plans`, `show`, `coverage`, `select`, `impact`, `new`), held to their rules |
| | `autonomous-qa.mjs` | QA investigations and generated tests: `plan`, `derive`, `step`, `reconcile`, `finish` |
| | `security-audit.mjs` | the security catalogs in effect, and an assessment from evidence |
| | `report.mjs`, `review.mjs`, `explore.mjs` | a run, a screen, a session or an exploration as one self-contained HTML page |
| | `record-edge.mjs` | add controls to the UI map, or correct one in place (`--replace`) |
| Viewing | `live.mjs` | Orbit Live: `status`, `watch`, `tui`, `open`, `pin`, `settings`, `doctor` |
| | `trace.mjs` | the session trail: `turns`, `turn`, `usage`, `activation`, `where` |
| | `host.mjs` | Claude Code's status line (`--kind=statusline`) and a host's settings |
| Resources | `resources.mjs` | the registry of skills, agents, MCP servers, tools and capabilities; `route "<prompt>"` dry-runs the router |
| | `mcp.mjs` | managed and external MCP servers; `call` through every gate |
| | `skill-factory.mjs` | generated project playbooks: `list`, `show`, `discover`, `workflow`, `runs`, `review` |
| | `qc-tool.mjs` | this project's own QC tools: `new`, `verify`, `register`, `status`, `rollback` |
| | `setup.mjs` | install the declared tools that have a package name |
| Data | `storage.mjs`, `init.mjs` | where test data lives; seat a project; a person's `import` and `export` |
| Reports | `project-report.mjs` | a product owner's report: `run`, `render`, `connect`, `sign-in`, `sign-out` |
| Improvement | `improve.mjs` | self-improvement: `status`, `analyse`, `resume`, `evaluate`, `metrics` |
| Missions | `satellite/cli/satellite.mjs` | Orbit Satellite: `mission start`, `context`, `step`; `live tui` |

**Exit codes**, the same across the CLIs: `0` done · `1` failed (only where something can fail: a test case, a plan or
integrity check, an MCP tool's own error) · `2` refused · `3` blocked · `4` inconclusive. A passing slice of a case
(`--from`/`--to`) is `PARTIAL`, exit `0`.

> **Trying commands inside this repository?** Set `ORBIT_STORE_DIR=/tmp/orbit` first — everything writes to
> `~/.orbit` by default.

The full command reference, with the flags, is in [AGENTS.md › Commands](AGENTS.md#commands).

---

## Where your data lives

All durable state lives **outside your product repository**, in the machine store:

| What | Where |
| --- | --- |
| Default | `~/.orbit/projects/<project-key>/` |
| Override (the only one) | `ORBIT_STORE_DIR=/path/to/base` → `/path/to/base/<project-key>/` |
| Show the paths | `node cli/query.mjs storage --json` or `node cli/storage.mjs where` |

- A project is keyed by its repository's identity, so every checkout of one repository shares one store; runtime
  sessions stay separate per checkout.
- **Test data** (`ui-tests/`) lives in the store by default:

  ```text
  ui-tests/project.json · graph/ · schema/{case,plan}.schema.json
  ui-tests/screens/<screen-id>/<plan-id>.plan.json (+ .md)
  ui-tests/screens/<screen-id>/cases/<case-id>.json
  ```

  A team that commits its test data with its code chooses the checkout explicitly (`init --in-checkout`, or
  `storage export --all --move`), and `ORBIT_UI_TESTS` names a data directory directly. Moving data between the two is
  a person's act (`storage import`, `storage export`), previewed and checked with per-file digests.
- **Reports, evidence, lessons, goals, requirements, works, tasks, generated playbooks and improvement campaigns**
  always stay in the store.
- Reading never creates state; every write is contained, locked and checked for a stale revision.

---

## Settings and switches

Everything below is on by default. On Claude Code each switch is a plugin option; on any host, an exported variable
overrides it on one machine.

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

---

## Orbit Live and Orbit Control

### Orbit Live

A **read-only** viewer beside your session, fed from the journals the engine keeps: tasks, goals, workflows, checks
and QA. `/orbit` and `/orbit-help` open it once per session (`live ensure`), and only in an interactive one — never
under `claude -p` or in CI:

- **Claude Code:** a pane docked on the right inside Claude Code, drawn by the plugin's pane module (from 110 columns
  with the fullscreen layout, `CLAUDE_CODE_NO_FLICKER=1`; above the prompt otherwise, saying so).
- **Codex, Antigravity CLI, Grok Build:** nothing opens by itself, because their sessions cannot say a person is
  there (unless you list the host in Live's `attendedHosts` setting). Ask for it and the agent runs `live open`: a
  split beside the session in tmux, Windows Terminal or iTerm2, or a macOS window; elsewhere it prints the command.
- **VS Code:** the companion under [integrations/vscode-orbit-live](integrations/vscode-orbit-live) splits the asking
  terminal and runs Orbit's viewer (machine-scoped settings: `orbit.live.storeDirs`, `orbit.live.nodePath`).

What it shows:

- A badge that says what the task is doing — `ORBITING`, `IDLE`, `BLOCKED`, `COMPLETED` … — only on evidence. The
  animated orbit in the header is the viewer's own motion, never progress.
- The checklist, `NOW`, six views (events, tests, changes, notices, plan, timeline), task and test progress, the
  baseline as a card, and a workflow's milestones under their step.
- **Which agent did what** (0.2.2): where the host names the subagent that made a call (Claude Code), the session's
  activity is grouped per agent — its type, whether it started or stopped, its calls, who launched it and the mission
  run it carries. The session's own calls stay apart, and a coverage line says what this host lets the hooks see.
- **Self-improvement** (0.3.0): an evaluation task shows its campaign in an `IMPROVE` section — the phase, both
  versions, the verdict and the gates.

Which task it shows: one this session created, a pin, or the one task running in this checkout — never the newest task
on the machine. Two candidates are `AMBIGUOUS`, and `live pin <task>` chooses.

```bash
node cli/live.mjs status          # print once
node cli/live.mjs watch           # follow in this terminal; q detaches the viewer and nothing else
node cli/live.mjs tui             # full screen, in a second terminal or pane
node cli/live.mjs open            # open it beside this session
node cli/live.mjs settings --apply='{"pane":{"widthPercent":36,"focusCli":true}}' --revision=<r>
```

Pane settings: `pane.widthPercent`, `pane.focusCli`, `pane.animation: off` (keep it still) and `pane.orbitSpeed`
(`slow` · `normal` · `fast`). To stop `/orbit` and `/orbit-help` opening it: Orbit Control › Advanced › Automation
limits › Live (`live.open`).

**Status line (Claude Code).** Orbit can own one key, `statusLine`, in your Claude Code settings, naming a small script
Orbit keeps in its store. `node cli/host.mjs render --host=claude --kind=statusline` shows what it would write and the
revision; `apply … --revision=<r> --human` writes it and `remove … --revision=<r> --human` takes it out. A status line
you already have is refused unless you `--replace` it (yours comes back on remove) or `--keep-existing` (yours runs
first, then Orbit's; not on Windows).

### Orbit Control

A local panel, on loopback only, where a person decides and configures: skills, MCP servers, CLI tools, report
connections (a credential that goes straight to the OS secret store, or a Microsoft sign-in), automation limits, Live,
security catalogs, self-improvement (Advanced › Improvement), the router's inspector, analytics and the session trail —
and the protected actions waiting for a person. Start it with `/orbit-control` (or
`node <plugin-root>/skills/orbit-control/start.mjs`) and open the URL it prints, `#token=…` included: without the token
the page is read-only. It needs Node 24.15 or newer and finds one itself (`ORBIT_CONTROL_NODE`, the running Node, a
private runtime, then nvm's versions).

- **MCP servers.** A *managed* server is Orbit's: added here from the catalog or as your own, and called only through
  Orbit's broker. An *external* server is one a host configured: listed and testable, never routed to, called or
  written by Orbit. A secret is never typed in: a header or variable names the environment variable its value comes
  from.
- **Approvals.** Approving a push or a production action, and resuming a paused task, happen only here: a terminal
  cannot prove a person typed them. An approval is for one action, spent once.
- Orbit never adds, enables or approves an MCP server, a policy or an approval by itself — a person does it here. The
  one thing it fetches on its own is a pinned, checksum-verified private tool that work you asked for needs (see
  [Microsoft sign-in](#microsoft-sign-in-for-azure-devops)).

### Protected boundaries

Orbit is **autonomous by default**: it inspects, plans, edits its own workspace, builds, tests, runs QA, prepares its own
sandbox (restoring dependencies and building containers there), uses local databases and commits locally without asking.
A person is asked only where work would leave that boundary
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

### Goals

`/orbit` keeps the specification exactly as submitted (`goal start`). The host's model then reads it into requirements —
each row labelled `explicit`, `derived`, `assumption`, `unknown`, `conflict`, `decision` or `constraint`, and citing the
line it rests on (a row with no kind is an assumption; one with no citation cites none) — and into a structured
**intent**: category, work kinds, capabilities, verification, dependencies and missing prerequisites. The plan is drawn
from the intent alone, never from the words, so a goal written in Vietnamese and its English twin plan the same. One
work unit is planned per kind, in the engine's order (analyze → change → investigate → procedure → verify); a unit a
missing prerequisite blocks is `unresolved` and never started. Each unit runs as a
[coordinated workflow](#coordinated-workflows-and-playbooks), and `goal verify` says what the evidence shows.

```bash
node cli/orbit.mjs goal start --stdin [--ref=PBI-482] < goal.txt   # keep the goal as submitted
node cli/orbit.mjs goal analyze <goal-id> --stdin < analysis.json  # the host's reading, as JSON
node cli/orbit.mjs goal plan|step|status|verify|report|resume <goal-id>
node cli/orbit.mjs goal list
```

### Requirements, work and tasks

- **A requirement** is what its own source says. `orbit-requirements` reads a work item into atomic facts and one
  frozen snapshot (`rs-…`). A source record keeps what the item *was* (identity, revision, digest, whose word), never
  its text. A pull request, a commit, a test or the code is never a requirement's source: what the product does today
  is how it was built, not what it should do. Unknowns become questions, and only a person answers one
  (`answer --human`). A roundtable of reviewer agents (product, domain, QA and a critic) proposes questions and decides
  nothing.
- **A work** (`w-…`) is the one piece of work a requirement has: the capabilities it needs, which provider serves each
  (a binding the resolver writes), receipts of what was asked (digests, never the answer) and checkpoints. A capability
  nothing provides is one knowledge opportunity for a person to decide — never an install.
- **A task** (`tsk-…`) is one execution of a work: an append-only journal whose lifecycle, stage and attempt are
  derived on every read. A person's pause, cancel or reject names the revision they read (`--expect=<revision>`);
  approve and resume happen only in Orbit Control.

```bash
node cli/requirements.mjs resolve <ref>                              # find a work item
node cli/requirements.mjs acquire <ref> | status <root> | snapshot <root>
node cli/requirements.mjs answer <root> --question=<rq-…> --says="…" --human
node cli/work.mjs start "<objective>" --ref=<item> | show <w-…> | list
node cli/task.mjs list | show <task> | why <task>
node cli/task.mjs pause|cancel <task> --human --expect=<revision>
```

### Project context

`context --for="<task>"` is what `orbit-develop`, `orbit-engineer` and `orbit-help` read before they choose a scope.
Memory first, it composes the architecture, technology, engineering, knowledge, work and working-set sections, and two
answers about the task itself (0.5.0):

- **RELEVANT** — what the task touches, from what the owners already hold: architecture's modules, boundaries,
  system-graph nodes and gates, the integrations, what engineering and knowledge recall, the working set and, once the
  paths are known, what the change reaches and which declared checks hold it. Each item is a `file`, `symbol`,
  `component` or `check`, classed `direct`, `dependency`, `downstream`, `verification` or `unknown`, with its evidence,
  its freshness (against its own scope, never HEAD) and who found it (`engine` or `host-verified`). At most 40 are
  listed and the rest counted. Names are matched with identifiers split (`createOrder` is "create order"): no
  embeddings, no parsing of any language.
- **SUFFICIENCY** — one word: `ENOUGH` (proceed from those items), `DISCOVER` (with the targeted reads that would fill
  the gap, each an Orbit command; never a full scan, and never a read already made that would find the same nothing) or
  `ASK` (a question about the task's own work is already open: a requirement's blocking question or a goal's missing
  prerequisite). Orbit never makes a question up, and only a person answers one.

A host proposes what it found with `--with-refs` — `{ "task": "…", "refs": [{ "kind": "file|symbol", "ref": "…",
"why": "…" }] }` on stdin. A file is checked against the tracked listing and a symbol by one whole-word search of the
index; one the tree does not hold is refused by name and never listed. Composing the package writes nothing.

**Three levels** (0.6.0, [ADR 0058](docs/adr/0058-a-task-knows-enough-by-levels-on-its-own-work.md)). SUFFICIENCY also
says whether the task knows enough to **investigate** (a direct file or symbol the tracked tree holds), to **change**
(the direct items confirmed by a read, what depends on them known or said unknown, a done criterion recorded as a
`proof` need on the task's work, and the check that would prove it identified) and to **conclude** (every proof need
satisfied, nothing it rests on moved since, and the work `verified` by an owner's completed task). Each level is an
ordered table over facts, never a count of search hits: it names the row that stops it and the command that fills each
gap. A name the task's words matched is a candidate, never confirmed, however many there are.

**Relations, one hop each way.** RELEVANT follows each direct file to what it imports, to who imports it and to the
tests that go with it — read from the tracked tree on demand, never a graph of the repository. What a file names is a
language's, so relation adapters in a pack read it (JavaScript/TypeScript and Python ship in
`skills/orbit-develop/relations/`). A route-shaped string two files share is a hypothesis you verify by reading both; a
file no adapter reads is a gap you fill by reading it and proposing what you found with `--with-refs`.

**A bounded discovery loop.** Discovery is recorded on the task's own work: its done criteria are `proof` needs, its gaps
`knowledge` needs, and each round is a checkpoint that keeps what it asked (`work checkpoint <w-…> --asked="<source ·
target>"`). `context --work=<w-…>` reads the rounds back: they stop after five, or after two in a row that settle
nothing new, and a target already answered is not offered again while that answer is fresh — so the next session
re-reads only what went stale. A scope gone from the tree is said as `GONE`, and a need settled on it is settled again.
A question about how a technology behaves goes to `orbit-research`.

```bash
node cli/context.mjs --for="<task>" [--json]              # what the task touches, and whether that is enough
node cli/context.mjs --with-refs --json < refs.json       # the same, with the files and symbols you propose, verified
node cli/context.mjs --for="<task>" --work=<w-…>          # with the rounds of the task's own work
```

### Project memory

Orbit keeps what it learns about a project in the store, reads that memory first and re-reads the repository only when
something moved — and it prints that decision. Every fact names its evidence and its scope. Freshness is measured
against that scope, never against HEAD (keyed to the commit, every fact would be stale on every push): `stale` means
"revalidate", never "false"; an uncommitted edit is `unknown`; a scope deleted, renamed away or gone on a branch switch
is `GONE`.

| Memory | What it keeps | Commands (`node cli/…`) |
| --- | --- | --- |
| Architecture | modules, boundaries, gates and the [system graph](#system-graph). `ensure` decides whether to read the repository at all; the normal answer is `CURRENT`, a few git calls | `architecture.mjs ensure`, `facts`, `why <id>`, `diff` |
| Technologies | what is declared, used and configured — a technology is not a capability; integrations keyed by system *and* operation; `resolve` says reuse, build, unknown or blocked, and never acts | `intelligence.mjs ensure`, `technologies`, `integrations`, `resolve <intent>` |
| Engineering conventions | how this project builds code, from tracked files and the checks that passed | `engineering.mjs facts`, `why <id>`, `recall`, `doctor` |
| Knowledge | claims, each a relation in a context (two contexts are two claims); authority derived — rule · adopted · source · confirmed · host-memory · inference; a relation nobody declared is still kept | `knowledge.mjs claims --for="…"`, `why <id>`, `opportunities` |
| Lessons | what repeated across independent sessions — two machines or two UTC days; one session is only an observation | `learn.mjs lessons`, `why <id>`, `recall`, `remember`, `forget` |

**A gap is an opportunity, and only a person decides one.** A capability nothing here provides is remembered as one
opportunity, development goes on, and nothing is installed, enabled or generated. Defer, accept, ignore or reopen it
with `knowledge decide <opp-id> defer|accept|ignore|reopen --human`; deferred means "not now", never "never".

**The engineering observer.** On by default and bounded: it runs at a milestone only (a commit, a session's end, a
check passing after an edit, a task completed on its own proof), at most four times a session, and what it proposes is
never stronger than `observed`. It watches only a checkout the machine knows — one somebody used Orbit in, one that
commits `ui-tests/`, or a directory named by `ORBIT_UI_TESTS` — so a repository you merely open is written about
nowhere. Switch it off with `ORBIT_ENGINEERING_OBSERVE=off` or the `engineering_observe` option;
`engineering doctor` says whether it is on, whether it ran and what stopped it.

**Host memory is a hint.** What your host keeps about the project (Claude Code's memory) can point discovery at a
subject, but it never becomes a fact, is never copied into the store and is always outranked by current source.

### Coordinated workflows and playbooks

`/orbit-help` with a concrete task starts a **coordinated workflow**
([ADR 0017](docs/adr/0017-a-coordinator-is-a-task-that-dispatches-to-owners.md)): a task of its own whose every step is
an owner's — a frozen requirement read back, runtime understanding, an engineering task, an investigation, a project
playbook — and is settled only on that owner's record. One step runs at a time; the plan is a graph the engine's tables
draw, revised only on evidence and at most `execution.maxReplans` times. The engine calls no model and runs no command
line of its own; its limits are a person's, set in Orbit Control. A workflow never cancels the engineering task it
started: a person does.

When a workflow needs a capability nothing provides, the skill factory drafts a **project-scoped playbook**: a
`SKILL.md` and, when the work is a sequence of calls to capabilities this machine already has, a declared
`workflow.json` — data the engine interprets, never code. The engine validates it, registers it in the store and runs it
pinned to one version, each step through its provider's own gate (the MCP broker or the capability pipeline) and every
call a receipt of digests. Later workflows reuse the pinned playbook instead of drafting again
([ADR 0030](docs/adr/0030-a-generated-skill-declares-a-workflow-the-engine-runs-through-owner-gates.md)).

```bash
node cli/automation.mjs status | plan --for="<objective>"                 # settings in effect; what a workflow would do
node cli/automation.mjs context <task> | reconcile <task> | finish <task>
node cli/skill-factory.mjs discover --for=release.readiness.verification   # reusable (and its pin) or which gap
node cli/skill-factory.mjs workflow <id|pin>                               # its steps, in order
node cli/skill-factory.mjs runs <id> | review <id>                         # what each run came to; a successor proposed, never written
```

### Autonomous engineering

`orbit-engineer` (`autonomous-engineering.mjs`) takes a requirement or an objective to a verified change in a workspace
of the task's own: a local clone. Your checkout, its `.git` included, is never written.

- **A change is held to what it reaches**
  ([ADR 0019](docs/adr/0019-a-change-is-held-to-what-it-reaches.md)). From the changed paths and the component graph
  runtime understanding read, the engine derives which declared checks are REQUIRED; every other one is NOT AFFECTED,
  not run, and never a pass. A path nothing holds, or a changed component nothing tests, is MISSING and blocks
  completion. A failure is a regression unless its baseline failed the same way (`failed-as-before`: shown, never a
  pass), and at least one required test or verify command must pass.
- **Only declared checks run**, chosen by id and run as argument lists; nothing a model writes becomes a command.
- **What stopped a check** is classified from facts, never from the words of an error: `DEPENDENCY` (the workspace's
  dependency restore for that component ran and failed), `ACCESS` (a target a person said the component requires is
  unreachable from here, asked fresh), `ENVIRONMENT` (it could not run here, or failed the same way before any change),
  `CODE`, `TEST`, `CAPABILITY`, `REQUIREMENT`, `DATA`, `SCOPE` and `UNKNOWN`. A class chooses what to look at next; it
  is never a verdict. Three attempts on one failure signature conclude `NO_PROGRESS`.
- **Commit, then push on approval.** A verified change is committed by itself; that exact commit is pushed only through
  the git-push boundary, approved once in Orbit Control. It never merges.

The task's context ends with a `DO` line: the one command that goes on — `step` with the decision on stdin, or
`reconcile` for an action that did not settle. `task why <task>` says, for each decision, how it settled (a receipt, or
REPORTED and never proven; OPEN or AMBIGUOUS read back, never resent) and which receipt moved the task next.

```bash
node cli/autonomous-engineering.mjs start --ref=<item> | start "<objective>"
node cli/autonomous-engineering.mjs context <task> | step <task> < decision.json | reconcile <task> | finish <task>
node cli/task.mjs why <task> [--json]
```

### Check observation adapters

While a declared check runs beside an engineering task, Orbit reads its output through one adapter, chosen by the
command and its output. What it observes is shown live in Orbit Live and never changes the verdict:

  | Adapter | Framework | Cases shown |
  | --- | --- | --- |
  | `dotnet-test` | the .NET test platform's console report (VSTest or Microsoft.Testing.Platform) | failures |
  | `tap` | a TAP stream (Test Anything Protocol 13 or 14) | reported |
  | `generic` | any command | none |

### Unified work tracking

When `/orbit-help` is given a concrete task, Orbit follows it as one **work** (`w-…`) from the request to what it came
to — whether you work it in the session (`developer`) or an engineering task or a coordinated workflow takes it
(`autonomous`). A tracked work keeps its identity, its links and what was reported; what a task did, which verdict a
check earned and what changed stay with their owners and are read back on every view. Tracking creates no task,
sandbox or workflow, grants nothing and never blocks the work it sits beside. It is shown on three separate axes:

- **Lifecycle:** `RECEIVED`, `IN_PROGRESS`, `INTERRUPTED`, `WAITING`, `BLOCKED`, `PAUSED`, `REPORTED_DONE`, `FAILED`,
  `CANCELLED`.
- **Evidence:** `none` · `observed` · `reported` · `verified` — only a completed linked task is `verified`, and an edit
  observed after it takes that away.
- **Liveness:** whether a session is still on it (`ACTIVE`, `QUIET`, `ENDED`, `NONE`) — never a lifecycle.

Files are the paths an edit tool was seen writing while a session was bound, never the checkout's dirty files; a check
is a command named like one, with how it ended, never "passed". How much each host lets tracking see differs
(`track.mjs coverage`; [docs/hosts.md](docs/hosts.md)).

```bash
node cli/track.mjs status [<w-…>]     # lifecycle, evidence, the files and checks observed, linked tasks
node cli/track.mjs list               # this checkout's tracked works
node cli/track.mjs coverage           # what this host lets tracking observe, and what it cannot
```

### Running the application

`orbit-runtime` works out what a checkout needs to run from its own files — manifests, version files, container and dev
container files, pipelines and build files — and runs none of them to find out.

- A command is launched only as a file declared it, as an argument list, never as a shell line.
- Orbit stops only what it can prove it started (a receipt, a pid and the pid's start time agree). A port in use blocks
  the start and names its holder; it is never freed or moved.
- What it takes to run a checkout is kept per checkout (`<store>/checkouts/<checkoutId>/`), because a branch's
  manifest, a machine's tools and a held port differ per checkout.
- A task's **sandbox** is its own: containers, an internal network and leased ports, fingerprinted and receipted. It
  never reuses your running application, and you never reuse its.
- Writing the repository (`runtime adopt`) is the primary-checkout-write boundary: only you, in Orbit Control.

```bash
node cli/runtime.mjs discover | status | doctor          # what it needs, how each component would run, what is missing
node cli/runtime.mjs start|stop [--component=<key>]      # only what a file declared; only what Orbit proves it started
node cli/runtime.mjs design | proposal                   # what an environment would have to change
```

### UI test cases

The Orbit Engine runs UI test cases written as plain JSON through `playwright-cli`. A case names controls by their
place in the project's UI map (`"on": "home/Add"`), so a moved locator is corrected once, in the map. Each verdict rules
on one layer: the screen (`ui`), the call it made (`api`) or the row it wrote (`sql`):

```json
{
  "id": "create-thing",
  "name": "Create a thing",
  "start": "home",
  "creates": "one thing ${NAME}",
  "params": [{ "n": "NAME", "required": true }],
  "steps": [
    { "do": "goto", "screen": "home", "wait": "document.body.innerText.length>0" },
    { "do": "click", "on": "home/Add", "wait": "document.querySelector('[role=dialog]')" },
    { "do": "fill", "on": "dlg-thing/Name", "value": "${NAME}" },
    { "do": "click", "on": "dlg-thing/Save", "wait": "document.body.innerText.includes('${NAME}')" },
    { "do": "api", "match": "api/things", "method": "POST", "status": 201 },
    { "do": "sql", "query": "SELECT COUNT(*) AS n FROM Things WHERE Name='${NAME}'", "expect": "Number(it[0].n) === 1" }
  ],
  "seen": "live"
}
```

- **PASS is earned and says what it proved:** `proved ui n · api n · sql n`. No verdict executed is `INCONCLUSIVE` (4).
  A database that cannot be reached is `BLOCKED` (3) — the product is not broken because a laptop is off the VPN. A
  case refused before the browser (an invalid case, a missing parameter, a destructive case without its flag, no
  signed-in session) is `REFUSED` (2).
- **A case that writes must be witnessed below the screen.** A screen can show a write that never happened, so a case
  that declares `creates` and rules only on the screen is a finding.
- **Evidence and reports.** A failure leaves its evidence; `--report` writes one self-contained HTML page into the
  store (pictures inlined, the case's JSON inside), and `run-case <that-report.html>` runs the case again.
- **Self-healing is never "change the test until it passes".** `orbit-failure-analyst` classifies a failure into one of
  nine causes; only the owner of that cause repairs its own artifact (`orbit-dsl-doctor` a case's representation,
  `orbit-map-healer` one locator), and the repair goes back through the engine.
- New cases an agent writes stay in the store's drafts, even after a PASS; promoting one to the shared regression set
  is a person's request.

```bash
node cli/run-case.mjs create-thing NAME=TC-1 --dry      # resolve and print the plan; no browser, no database
node cli/run-case.mjs create-thing NAME=TC-1 --report   # run it, with a self-contained HTML report
node cli/query.mjs dsl | verb sql | field into          # the case vocabulary, from the DSL tables
node cli/query.mjs check                                # integrity: dangling edges, invalid cases, a stale schema
node cli/query.mjs triage                               # one run: what its evidence shows, and what it cannot tell
node cli/qa-plan.mjs coverage <plan-id>                 # criterion → scenario → case → run → evidence
```

### Autonomous QA

`orbit-qa` runs an **investigation** of a live application: the host chooses one next step at a time, as a decision the
engine judges before anything runs, within the mode the environment allows. What is still owed, why to stop and what a
finding concludes are derived from the investigation's journal, never from the host's word.

| Mode | What it may do |
| --- | --- |
| `observe` | read only: navigate, look, listen to the network, run read-only checks |
| `explore-write` | create and change synthetic `TC-` data; a destructive control is never touched |
| `security-test` | an authorised tenant-isolation matrix over approved identities and resources |
| `regression` | run already-accepted cases through `run-case` |
| `fixture-write` | generated tests that write — only in the task's isolated sandbox, on the run's own fixture, each write under a grant |

Every mode but `observe` runs only on an environment whose modes a person approved.

**Generated tests**, from an accepted requirement to a verified outcome:

1. Obligations are **derived** from accepted plans against the frozen system graph.
2. The host proposes a test design; the engine compiles every verdict and page script from the accepted criteria and
   fixed templates.
3. A frozen version runs only in a task's **isolated sandbox** (Docker), where a write is allowed only under a grant
   minted for its own fixture.
4. The host validates what the worker left before anything is recorded; ordered result rows give the outcome.

Backends are reached through adapters (`orbit.adapter/v1`) shipped as packs a project opts into; what each adapter is
proven to support is computed from conformance receipts. An adapter's operation may declare what its request carries
([ADR 0052](docs/adr/0052-an-adapter-operation-declares-what-its-request-carries.md)), and a design is held to it before
a draft exists.

A verdict must depend on the application, never on what the design itself causes. Every contradiction rule reads a
design through one model of what it causes (`src/qa/backend/causes.mjs`) and names no operation or shape: a wait for a
second delivery nothing brings, a match the design pins itself, a result its own step satisfies. Since 0.6.0,
`NEVER_DECIDED` refuses a design that waits for a schedule to decide an occurrence when the clock is injected and
nothing moved it, and `CLOCK_PASSED` advises when a design moves the clock only to where an earlier test already took
it.

Security catalogs (by default ASVS 5.0.0 L1, labelled with OWASP Top 10 2025 and API Security Top 10 2023), limits and
isolation are configured by a person in Orbit Control; a task's own sandbox needs nobody's trust to run
([ADR 0040](docs/adr/0040-standards-and-policies-are-configured-in-orbit-control.md)). Orbit never calls anything
"compliant".

```bash
node cli/autonomous-qa.mjs plan --objective="…" --plan=<id> --sandbox=<env-id> --mode=fixture-write
node cli/autonomous-qa.mjs derive --investigation=<id>       # the obligations its accepted plans imply
node cli/autonomous-qa.mjs step --investigation=<id>         # one decision, on stdin
node cli/autonomous-qa.mjs reconcile --investigation=<id>    # a dispatch that never settled, read back, never resent
node cli/security-audit.mjs assess --investigation=<id>      # the security controls in effect, from that record
node cli/qa-plan.mjs expects <contract.json>                 # OpenAPI, AsyncAPI or schedule → candidate expectations
node cli/query.mjs adapters --matrix                         # what each adapter is proven to support
node acceptance/run.mjs [--stack=…] [--variant=…]            # native acceptance: two stacks, planted defects (Docker)
```

### System graph

`architecture graph [--json]` projects the running system: **nodes** (components, workloads, interfaces, channels,
schedules, stores …) and **relations** (calls, publishes-to, consumes-from, schedules …), each with evidence, freshness
and unknowns. `architecture ensure` reads what composition files declare; everything else arrives as candidates through
`architecture record`, which refuses untracked files and secret attributes. What a kind or relation *means* comes from
the vocabulary (`catalog/topology.json` plus organisation and project layers). `orbit-reverse-engineer` runs a
standalone pass, one agent per unknown scope.

### Orbit Satellite

`/orbit:satellite <goal>` (or `node <plugin-root>/satellite/cli/satellite.mjs` on any host) runs a **mission**: the goal
becomes a structured intent, an investigation comes before deciding who changes what, and the work graph is revised only
on evidence. Roles, agent templates, skills and workflows are reused first and generated only when nothing fits, each
pinned by digest. Every unit runs as a fresh agent under a least-privilege profile; source changes happen only in an
engineering task's own workspace; a criterion is verified only by an independent owner's record.

```bash
node satellite/cli/satellite.mjs mission start --stdin < goal.txt      # start; the goal is kept as submitted
node satellite/cli/satellite.mjs mission context <msn>                 # what stands, what is allowed, the next step
node satellite/cli/satellite.mjs mission step <msn> < decision.json    # one decision, judged before it runs
node satellite/cli/satellite.mjs live tui <msn>                        # Satellite Live: nine views
node satellite/cli/satellite.mjs host capabilities                     # what this host can do
```

Claude Code dispatches agent runs natively and in parallel; Codex, Antigravity CLI and Grok Build run them one at a time
in the main session. Each run says which of the host's agents carries it, and how anybody knows (0.2.2,
[ADR 0044](docs/adr/0044-run-identity-and-attribution.md)):

| Word | Means |
| --- | --- |
| `HOST_OBSERVED` | the hooks saw the Agent call that carried the run's envelope launch that agent |
| `REPORTED` | only the dispatcher said so (`agent ack <msn> <arn> --host-agent=<agentId>`) |
| `CONFLICTING` | two agents are named for one run, or one agent for two runs: neither is chosen |
| `UNATTRIBUTED` | a serial run, or nothing observed: its calls cannot be told from the session's own |

In `live tui`, press `2`, select a run with `j`/`k` and press `enter` to inspect it: its pins, parent and children, its
host agent and the basis of that word, its calls (direct, and through the agents it launched) and its records. Details:
[satellite/docs/README.md](satellite/docs/README.md),
[ADR 0041](docs/adr/0041-orbit-satellite-is-a-mission-journal-above-owners.md).

### Autonomous self-improvement

Orbit improves this project's **declared playbooks** and **Satellite roles** from what they actually did, and only on
independent evidence ([ADR 0045](docs/adr/0045-autonomous-self-improvement-on-independent-evidence.md)):

1. **Detect.** The runs the owners recorded become signals; one problem is one opportunity, by its fingerprint. A single
   failure, retries inside one session, a provider, an environment or a person's approval never count.
2. **Diagnose and generate.** Only a defect of the definition itself gets a successor: the skill factory drafts it from
   the version it succeeds, the host writes the change, and it is staged as a candidate nobody is offered.
3. **Validate.** A candidate that widens its tools, drops a required step, loosens a success rule or carries anything
   executable is refused before it runs.
4. **Evaluate.** The candidate and the version it would replace run the same frozen inputs, through the same gates as
   ordinary work. It is better only when two independent sessions (two UTC days or two machines) say so and none says
   otherwise.
5. **Promote.** Twelve gates, then the owner's own door chooses it for new work. A pin a task already holds never moves,
   and the replaced version is kept whole.
6. **Monitor and roll back.** A regression in independent sessions puts the replaced version back; a result becomes a
   lesson only through learn's own ladder.

It runs by itself after a workflow and from the hooks, never evaluating there. Every switch and bound is a person's,
under `improvement.*` in Orbit Control; with automatic promotion off, a qualified candidate waits for a person. Nothing
it does crosses a protected boundary, widens a permission or overrides a person's decision.

```bash
node cli/improve.mjs status                  # switches, opportunities, campaigns
node cli/improve.mjs analyse [--dry]         # what the owners' records show; one opportunity per problem
node cli/improve.mjs resume <imp-id>         # a campaign stepped until it needs the host, a person or a session
node cli/improve.mjs evaluate <imp-id>       # the candidate beside the version it would replace, in this session
node cli/improve.mjs metrics                 # nine metrics, each with its numerator and denominator
```

### The session trail

The hooks keep a trail of what each session did through Orbit, on this machine only, and as metadata by allow-list: for
each prompt a salted fingerprint, its length and what the router decided; which skills and agents started; which Orbit
commands (and which classes of other command) ran and how they ended; where a turn ended. Never a prompt's text, a
response, an argument, a tool's output, a path or a file's contents. It is kept 90 days, never sent anywhere, and
switched off with the `trace` option or `ORBIT_TRACE=off`. The views are folds rebuilt on every read, so a terminal and
Orbit Control's Trace and Analytics pages always agree.

```bash
node cli/trace.mjs turns              # one line per prompt: what the router decided, the path the session took
node cli/trace.mjs turn <turn-id>     # one prompt in full
node cli/trace.mjs usage              # commands, skills, failures and least privilege, with their denominators
node cli/trace.mjs activation         # suggested → selected → dispatched → executed → verified
node cli/trace.mjs where              # where the trail is kept, and what it never keeps
```

### Project reports

`orbit-report` builds a product owner's report from GitHub or Azure DevOps: pull requests, reviews, work items and
pipelines. A run collects once and freezes the snapshot, and every render reads only that snapshot: nothing after the
cut-off is counted, a gap is "not available (needs …)" and never a zero, and a forecast never reaches past the window it
has history for. The result is one offline HTML page. When a report lacks what you asked for, Orbit may itself build,
verify and activate the smallest report part for this project (a metric, a section, a transform, an exporter) — never
one that replaces a standard part, needs a package, reads the source's API or a credential, or reaches another project.

```bash
node cli/project-report.mjs status | settings | parts | runs
node cli/project-report.mjs run [--months=N | --from=D --to=D | --all] [--dry]
node cli/project-report.mjs render [<run-id>|latest]                   # again, asking no source
node cli/project-report.mjs connections | probe
```

A GitHub connection reads with a token; you name the environment variable it comes from, or store it in Orbit Control,
which puts it straight into the OS secret store. An Azure DevOps connection signs in with Microsoft by default.

#### Microsoft sign-in for Azure DevOps

Orbit's Microsoft sign-in is independent of your own Azure CLI login. If you already use `az` for development, Orbit does
not change that account, subscription, configuration or login session: it keeps a separate Azure CLI profile in its
machine store. You may be signed in as account A in your terminal and as account B in Orbit at the same time. A personal
access token is the alternative. Sign in once per machine, and every project that uses the connection reads with it
([ADR 0043](docs/adr/0043-orbit-signs-in-through-an-azure-cli-profile-of-its-own.md)):

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

### Extending Orbit in your project

Everything specific to your product lives in your project's data and the tools it opts into, never in the engine:

- **Project QC tools.** When a test needs something no built-in verb can do — a second database, a vendor SDK, a
  queue — `orbit-qc-builder` builds the smallest project-local *capability*, and a case asks it through the one `call`
  verb. It lives outside the repository, is loaded for real into a throwaway context before it is trusted
  (`qc-tool verify`) and is registered only once it verifies. A capability sees a narrow facade — no store, no ledger,
  no environment, no way to write a verdict — and its own crash is `BLOCKED`, never a defect in your feature.
- **Packs.** Orbit ships capability packs that stay inert until a project lists them in `project.json` `packs`:
  `orbit-api-test` (HTTP reads and writes) and `orbit-backend-test` (messaging, schedulers, jobs, state, fixtures, the
  clock, identity — each answered by whichever adapter discovery and its declared semantics select).
- **MCP servers** are added, tested and policed in [Orbit Control](#orbit-control). A session calls a managed server
  through every gate with `node cli/mcp.mjs call <server> <tool> --for=<capability> --input='{…}'`.
- **Playbooks** a workflow needs are drafted, verified and pinned per project
  ([coordinated workflows](#coordinated-workflows-and-playbooks)).

```bash
node cli/qc-tool.mjs where | list                          # this project's QC tools, and any that failed to load
node cli/qc-tool.mjs new <id> <scratch-dir> [--tool=psql] [--mutates]
node cli/qc-tool.mjs verify|register <dir>                 # exit 2 if it would not load
node cli/query.mjs capabilities                            # what a {"do":"call"} step may ask here
node cli/query.mjs extensions                              # loaded, refused, and why
```

---

## Orbit Web

[Orbit Web](integrations/orbit-web/README.md) (0.8.0) is a self-hosted, browser-based home for Claude Code with the
Orbit plugin — and a **virtual office of AI employees** — running in Docker beside PostgreSQL (with pgvector) and an
allocator.

- **Its own accounts.** You sign in to Orbit Web itself, with a username and a password, independent of every AI CLI.
  The first administrator is set up with a one-time code the server prints
  (`docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js owner setup-code`). Each account
  is a tenant, and every record belongs to one.
- **AI connections, per account.** Settings › AI Connections connects the CLIs an account works with: Claude Code,
  OpenAI Codex and Google Antigravity, all three in the image. A Claude Code or Codex subscription is signed in with the
  official CLI's own sign-in — from its card (Orbit Web shows the link the CLI printed; for Claude Code you paste back
  the code its page shows) or from a terminal on the server — and an API key is the other way. No credential of the
  server's own is ever given to any program.
- **Chat and coding:** Claude Code with Orbit on a repository from GitHub or Azure DevOps (or none), with the model,
  effort and mode you pick; the page streams what it does, the files it changed and what Orbit says about the work.
- **Research:** your documents and pages, asked in conversation, every answer cited to a frozen passage.
- **The Office:** hire AI employees (a CLI, a model and an effort each, and a personal sandbox), give them work and
  review what they hand in. Every attempt runs in two containers of its own — a tool plane and a model plane — made by
  the allocator, the only holder of the Docker socket.
- **Governance:** each account's policy, approvals and hash-chained audit record. An optional access token
  (`ORBIT_WEB_ACCESS_TOKEN`) adds a perimeter in front of the sign-in; it is never an identity.

To run it — the passwords, the allocator's secret, three images and `docker compose up` — follow
[Orbit Web › Run it](integrations/orbit-web/README.md#run-it). A localhost-only trial (`compose.trial.yaml`, with
`admin` / `123456`) skips the setup code.

---

## Developing Orbit

```bash
node --test                                                  # the suite: no browser, no network, no sleeps (npm test)
node cli/check-five-lines.mjs src cli skills --strict         # Five Lines: must print 0 finding(s) (npm run lint)
ORBIT_UI_TESTS=test/fixtures/ui-tests node cli/query.mjs check
ORBIT_UI_TESTS=test/fixtures/ui-tests node cli/plan-check.mjs
node skills/orbit-release/ship.mjs --ci                      # the whole definition of done, one command (the fast tier)
node skills/orbit-release/panel.mjs                          # Orbit Control on its own Node: server tests, panel build
claude plugin validate . && node skills/orbit-release/pane-check.mjs   # the Claude Code pane module
```

Run one suite at a time: two at once interfere. Before changing code, read:

- [AGENTS.md](AGENTS.md) — the rules every change is held to: invariants, dependency direction, enforced rules,
  commands, the definition of done
- [docs/architecture.md](docs/architecture.md) — the architecture: layers, dependency direction, where data lives
- [docs/agents/layout.md](docs/agents/layout.md) — the module map: what each directory and module is for
- [docs/agents/extend.md](docs/agents/extend.md) — for each kind of change, what to touch and the test that proves it

In short: zero dependencies; every function body has at most five statements, with no `else` and no `switch`; the DSL
vocabulary is data (`src/dsl/`); no product, vendor or stack is named in engine code; and anything a consumer can
observe — CLI names and flags, exit codes, `ORBIT_*` variables, the `ui-tests/` layout, the DSL — is a contract:
changing one is a major version and adding to one a minor version, bumped in all five manifests.

No GitHub workflow gates the plugin: the gates run where the release is made. The one scoped exception is Orbit Web's
two workflows — checks for pull requests that touch `integrations/orbit-web/**`, and its image published by hand behind
a reviewer ([ADR 0060](docs/adr/0060-orbit-web-a-browser-host-around-the-official-clis.md)).

### The independent evaluator

`evaluator/` measures what Orbit adds to a coding host from outside
([evaluator/README.md](evaluator/README.md), [ADR 0057](docs/adr/0057-an-independent-evaluator-measures-a-release.md)).
It runs the same task with the same model, effort, tools, limits and prompt in arms that differ only by the plugin —
the plain host, Orbit at the previous release, Orbit at the release candidate (a second host, mini-SWE-agent, makes it
a 2 × 2) — and grades the patch each run leaves by hidden tests the agent never sees, in a fresh container with no
network: never by the agent's word, never by Orbit's own records. It is a package of its own (Orbit imports nothing of
it, and it imports nothing of Orbit) and never ships.

What runs and how it is judged is pre-registered (`evaluator/prereg/<release>.json`) before any model run: SWE-bench
Verified instances and local task packs, a development set and a held-out set, the arms, and the verdict rule —
IMPROVED, NO_DIFFERENCE, REGRESSED or INCONCLUSIVE, where a one-task difference is INCONCLUSIVE.

```bash
node evaluator/cli.mjs checks                                # the evaluator's own checks, no Docker
node evaluator/cli.mjs selfcheck --ca-file=<pem>             # its scripted controls, for real, no model
node evaluator/cli.mjs prereg verify                         # the registered order, re-derived from its rule
node evaluator/cli.mjs prereg campaign final --rev=<commit>  # a phase's campaign, made from the pre-registration
node evaluator/cli.mjs run <campaign.json> | resume <id> | status <id> | report <id> --md
node evaluator/cli.mjs record --campaign=<id>,<id> --out=<record.json>   # what ship.mjs --evidence reads
```

### Releasing

A release qualifies on the fast tier plus the evaluator's record of that very artifact:
`node skills/orbit-release/ship.mjs --evidence --evaluation=<record.json>` must say PUBLISHABLE on the pushed head before
the merge commit is tagged `v<version>`. The gate never tags, pushes or publishes; IMPROVED, NO_DIFFERENCE and
INCONCLUSIVE are said as what they are, and a one-task difference is never called a gain. The whole contract is in
[skills/orbit-release/SKILL.md](skills/orbit-release/SKILL.md); running the held-out campaigns from a Claude Code cloud
session is described in [CLAUDE.md](CLAUDE.md).

---

## Further reading

| Document | About |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | The architecture: layers, dependency direction, data |
| [docs/hosts.md](docs/hosts.md) | How each host binds Orbit: hooks, sessions, what each host can show, native acceptance |
| [docs/orbit-current-contract.md](docs/orbit-current-contract.md) | Current contracts and fresh-install behaviour |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [control-server/README.md](control-server/README.md) | Orbit Control |
| [satellite/docs/README.md](satellite/docs/README.md) | Orbit Satellite |
| [evaluator/README.md](evaluator/README.md) | The independent evaluator |
| [integrations/orbit-web/README.md](integrations/orbit-web/README.md) | Orbit Web |
| [integrations/vscode-orbit-live/README.md](integrations/vscode-orbit-live/README.md) | The VS Code companion for Orbit Live |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release |
| [docs/github-orbit-repo.md](docs/github-orbit-repo.md) | Publishing the repository |

## License

MIT — see [LICENSE](LICENSE).
