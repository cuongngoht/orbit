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

Role agents (`orbit-engineering-agent`, `orbit-qa-agent`, `orbit-qa-case-writer`, `orbit-failure-analyst`,
`orbit-map-healer`, …) each do one bounded job for a parent skill.

---

## Command line

Every skill is backed by a CLI under `cli/`. The reliable form on any host is `node <plugin-root>/cli/<tool>.mjs …`.

```bash
# Goals
node cli/orbit.mjs goal start --stdin < goal.txt      # keep a goal as submitted
node cli/orbit.mjs goal status <goal-id>               # where it stands
node cli/orbit.mjs goal plan|resume|step|verify|report|list <goal-id>
node cli/orbit.mjs doctor

# Where to start
node cli/help.mjs --for="<task>"                       # one recommended next step, and why

# Requirements, work and tasks
node cli/requirements.mjs resolve <ref>                # find a work item
node cli/autonomous-engineering.mjs start --ref=<item> # a task taken to a verified change
node cli/task.mjs list                                 # tasks on this machine

# Project knowledge
node cli/architecture.mjs ensure                       # is the architecture snapshot current?
node cli/runtime.mjs discover                          # what this checkout needs to run

# Live view
node cli/live.mjs status                               # Orbit Live in a terminal
node cli/live.mjs status --json                        # session.agents: which agent did what (0.2.2)

# How sessions used Orbit
node cli/trace.mjs usage                               # counts with their denominators; per agent, as the host says (0.2.2)

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
proven to support is computed from conformance receipts.

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

Security catalogs (default: ASVS 5.0.0 L1, labelled with OWASP Top 10 2025 and API Security Top 10 2023), limits and
isolation are configured by a person in Orbit Control; a task's own sandbox needs nobody's trust to run
([ADR 0040](docs/adr/0040-standards-and-policies-are-configured-in-orbit-control.md)). Orbit never calls anything
"compliant".

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
node skills/orbit-release/ship.mjs                           # the whole definition of done, one command
```

Before changing code, read:

- [AGENTS.md](AGENTS.md) — invariants, dependency direction, enforced rules, commands, definition of done
- [docs/agents/layout.md](docs/agents/layout.md) — module map
- [docs/agents/extend.md](docs/agents/extend.md) — what to touch for each kind of change, and the test that proves it

Key rules in short: zero dependencies; every function body ≤ 5 statements with no `else`/`switch`; the DSL vocabulary
is data (`src/dsl/`); no product, vendor or stack named in engine code.

### The Docker benchmark

`benchmark/` holds Orbit to cases written as data, on the branch you are on, in Docker. It is development tooling and
never ships ([benchmark/README.md](benchmark/README.md), [ADR 0046](docs/adr/0046-a-docker-benchmark-holds-orbits-source-to-independent-checks.md),
[ADR 0047](docs/adr/0047-a-qa-benchmark-asks-whether-autonomous-qa-finds-a-planted-defect.md)). It has two kinds of case.

**Source cases** hold Orbit's own source to independent checks.

- Each run freezes the source and verifies it twice, with no network, no credential and no model.
- With `--repair`, a failure the case declares repairable goes to a real coding host. That host drives ONE Orbit
  engineering task in a runner container whose only way out is the model's API.
- The candidate is then judged by hidden checks the runner never sees, by the repository's own gates on its own tests,
  and by its own regression test, which must fail before the change and pass after it.

**QA cases** ask whether Orbit's autonomous QA *finds* a defect planted in an application.

- The application runs on an isolated sandbox that Orbit's own engine sets up beside the controller.
- A real coding host works one investigation over it through a relay. It is given the requirement and the contracts,
  never the application's source.
- A contradiction counts as a defect found only once the clean application passes the same test.
- `controls` proves the verifier without a model: a reference host must pass, while an idle host and a false-alarm
  host must fail.

A run is an Orbit task, so Orbit Live shows it and a person can pause or cancel it.

```bash
node benchmark/run.mjs build                                 # three images, built once and reused by id
node benchmark/run.mjs run ORBIT-SRC-001                     # a case on this branch's source: expected PASS, nothing changed
node benchmark/run.mjs run ORBIT-SRC-001 --variant=controlled-fault --repair   # a planted failure, repaired through Orbit
node benchmark/run.mjs controls ORBIT-QA-001                 # a QA case's verifier, proved with scripted hosts
node benchmark/run.mjs run ORBIT-QA-001                      # a coding host's QA, judged against the ground truth
node benchmark/run.mjs report <bnr-…>                        # the outcome, the checks that ran, the patch or the judged rows
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
