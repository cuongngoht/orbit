# Orbit architecture

How Orbit is built, for a person or an agent new to the code: what the system is and what surrounds it, the
principles that shape every module, the layers and which way they depend, who owns what, where the data lives, how
the main flows run, and where the code is meant to grow.

This page explains; three others are its references. What each directory and module is FOR is the module map,
[docs/agents/layout.md](agents/layout.md). What to touch for each kind of change, and the test that proves it, is
[docs/agents/extend.md](agents/extend.md). The rules that bind every change are [AGENTS.md](../AGENTS.md). One part of
this page is rules too: [the import boundaries](#the-import-boundaries) were moved here whole from AGENTS.md and bind
every change as AGENTS.md does. Anywhere else, where this page and AGENTS.md seem to disagree, AGENTS.md wins.

## Contents

1. [What Orbit is](#what-orbit-is)
2. [The system and its context](#the-system-and-its-context)
3. [The principles that shape the code](#the-principles-that-shape-the-code)
4. [Layers and dependency direction](#layers-and-dependency-direction), and
   [the import boundaries](#the-import-boundaries)
5. [Ownership](#ownership): [who owns what, when a case fails](#who-owns-what-when-a-case-fails),
   [how a verdict flows](#how-a-verdict-flows), [owners beyond a test case](#owners-beyond-a-test-case)
6. [Data](#data): [the plugin, the store and the checkout](#the-plugin-the-store-and-the-checkout),
   [the machine store](#the-machine-store), [what never lives in a checkout](#what-never-lives-in-a-checkout)
7. [The main flows](#the-main-flows): [a UI test case](#running-a-ui-test-case),
   [an engineering task](#an-autonomous-engineering-task), [a workflow and a goal](#a-coordinated-workflow-and-a-goal),
   [a mission](#a-satellite-mission), [a prompt](#a-prompt-routed-and-followed-through),
   [knowledge and learning](#knowledge-and-learning), [a release](#a-release)
8. [Extension points](#extension-points)
9. [Where to read more](#where-to-read-more)

## What Orbit is

Orbit is a plugin for AI coding hosts -- Claude Code, Codex, Antigravity CLI and Grok Build -- that takes a goal (a
work item, a bug, an engineering objective, a test case) to a verified outcome, and calls it done only on evidence an
owner keeps. One repository holds two things: an ENGINE in plain Node.js (>= 20, no dependency), run as
`node <plugin>/cli/<tool>.mjs`, and what a host loads -- skills (`skills/*/SKILL.md`: playbooks a model follows),
agents (`agents/*.md`: subagents a skill dispatches, one job each) and hooks (the host's lifecycle events, handed to
the engine). The host's model reasons and chooses the next step; the engine judges that step before it runs, records
it, runs it through a gate, and settles it on a record its owner keeps. Everything Orbit keeps lives in a machine
store outside every repository; the product's checkout is read as untrusted data and written only by a person's own
act.

Orbit began as a UI test engine -- JSON cases run through `playwright-cli`, verifying UI, API and SQL, with evidence on
failure -- and that interpreter is still its core (`src/dsl/`, `src/run/`). Around it, each concern is an OWNER with a
journal of its own: requirements, work, autonomous engineering tasks, QA investigations, runtime understanding,
coordinated workflows, goals, Satellite missions and self-improvement campaigns. It holds no product knowledge: a
product, a vendor, a hostname or a stack is the consuming project's data, or an adapter or a pack a project opts into.

## The system and its context

```text
  a person ─── asks ───► AI coding host: Claude Code · Codex · Antigravity CLI · Grok Build
     │                   the model reasons; it loads Orbit's skills/, agents/ and hooks/
     │                          │ hooks: lifecycle events          │ skills run
     │                          ▼                                  ▼ node <plugin>/cli/<tool>.mjs
     │                   ┌────────────────────────────────────────────────────────────────┐
     │                   │ Orbit engine (this plugin): cli/ composition roots → src/      │
     │                   │ subjects → ports (browser, database, process, source tree …)   │
     │                   │ satellite/: a mission journal above the engine's owners        │
     │                   └─────────────┬────────────────────┬───────────────────┬─────────┘
     │                                 │ keeps its state    │ reads, untrusted  │ drives, argv only
     │                                 ▼                    ▼                   ▼
     │                         the machine store   the product checkout   the application, a task's
     │                         ~/.orbit/projects/  written only by a      sandbox, playwright-cli,
     │                         or ORBIT_STORE_DIR  person's own act       git, Docker, sqlcmd …
     │                                 ▲
     ├── watches ──► Orbit Live ───────┤ reads the journals: a docked pane, a terminal, the VS Code companion
     └── decides ──► Orbit Control ────┘ reads them, and records a person's word -- an approval, a setting, the
                                         one crossing of a protected boundary (control-server/, control-panel/)
```

| Part | Where | What it is |
|---|---|---|
| The hosts | outside this repository | Claude Code, Codex, Antigravity CLI and Grok Build. The model reasons; every host discovers the same `skills/`. Claude Code also runs the plugin's agents natively and docks Orbit Live; the others run a step's skill serially in the main session ([docs/hosts.md](hosts.md)). |
| Skills and agents | `skills/`, `agents/`, `catalog/components.json` | Playbooks name the commands they run; an agent does one bounded job a skill hands it. What each provides and needs is a row of the catalog, never a list in code. |
| Hooks | `hooks/hooks.json` (Claude Code), `hooks/codex.json`, `hooks/grok.json`, the root `hooks.json` (Antigravity) | The host's events, handed to `cli/learn-hook.mjs` (learning, the working set, the trail), `cli/router-hook.mjs` (the prompt router) and `cli/follow-hook.mjs` (the Stop hold, the line after an agent returns). |
| The engine | `cli/`, `src/`, `catalog/`, `schemas/`, `templates/` | Composition roots, subjects, ports and the plugin's immutable data. Its own rules are [AGENTS.md](../AGENTS.md). |
| The machine store | `~/.orbit/projects/`, or `ORBIT_STORE_DIR` | Every byte of state Orbit keeps: test data by default, journals, facts, reports, evidence, settings, receipts ([Data](#data)). |
| Orbit Live | `src/live/`, `cli/live.mjs`, `hooks/live-pane.tsx` | A viewer of the journals: Claude Code's docked pane, a terminal (`live watch`, `live tui`), a status line. It reads; it never approves, resumes, cancels or runs anything. |
| Orbit Control | `control-server/`, `control-panel/`, started by `skills/orbit-control/` | A local panel, loopback only, on a Node of its own (>= 24.15): the one door through which a person approves, configures, adopts a proposal or crosses a protected boundary. One more viewer of the journals besides. |
| Orbit Satellite | `satellite/`, `skills/satellite/`, `agents/satellite-*.md` | A mission journal above Orbit's owners: a goal planned as a work graph, each unit a fresh least-privilege agent run, every criterion settled on an independent owner's record ([satellite/docs/README.md](../satellite/docs/README.md)). |
| The evaluator | `evaluator/` | Measures a release from outside: the same task with and without the plugin, graded by hidden tests. Export-ignored, and neither side imports the other ([evaluator/README.md](../evaluator/README.md)). |
| Orbit Web | `integrations/orbit-web/` | A self-hosted browser host: a Docker image with the official AI CLIs, git and this plugin, and a web app over them. It runs the plugin's CLIs as programs and imports nothing of it. |
| The VS Code companion | `integrations/vscode-orbit-live/` | An extension a person installs so that Orbit Live opens in a split beside an AI CLI's terminal; it runs Orbit's own viewer and nothing else. |

Orbit Control's server and Satellite are composition roots of their own beside `cli/`: they import the engine's
modules, and nothing under `src/` imports either. Neither the evaluator nor the two integrations is part of the
plugin's archive (`.gitattributes` export-ignores `evaluator/` and `integrations/`).

A host reaches the engine through three doors, and only these: its **hooks** (every payload normalized by the host's
adapter, `skills/orbit-learn/hosts/<host>.mjs`, into one lifecycle event, `src/lifecycle/event.mjs`), the **commands**
a skill's playbook names (`node <plugin>/cli/<tool>.mjs`, run through the host's shell, by path and never by name), and
the **agents** a skill dispatches. Nothing reaches the engine through a host's configuration: Orbit observes the MCP
servers a host configured and never writes them.

## The principles that shape the code

Each principle is held by rules in [AGENTS.md](../AGENTS.md) and by tests; this is the idea behind them.

**The host reasons; the engine keeps the state.** The engine calls no model. A host's model sends a decision as data --
an investigation's next step, an engineering task's next action, a workflow's next step, a mission's next step -- and
the engine judges it before anything runs: refused by name when it asserts a verdict, an outcome, a stage, a
confidence or an approval, STALE when the journal moved past the revision it read. It is recorded before its side
effect and settled with a receipt. What is still owed, why to stop and what a result concludes are derived from the
journal on every read, never taken from the host's word.

**One owner per artifact.** Every artifact has one owner, which writes it through one door: `src/run/` decides a case's
verdict, `src/task/ops.mjs` writes a task, an `ingest` door writes a requirement's facts, an engineering fact or a
knowledge claim, and `src/runtime/writer.mjs` is the one module that writes a checkout outside `ui-tests/`. Everyone
else reads it back and never re-judges it: a coordinator settles a step only on the owner's record, a viewer writes no
journal, triage prints the verdict a run earned. State is a fold over an append-only journal, rebuilt on every read;
nothing mutable sits beside it.

**PASS is earned.** `src/run/status.mjs` decides a run's final word: no verdict executed is `INCONCLUSIVE`, never PASS,
and a PASS says what it proved (`proved ui n · api n · sql n`). The same idea runs through every owner: coverage counts
only PASS; a failure its baseline also had is `failed-as-before`, visible and never a pass; a check a change does not
reach is NOT RUN, never passed; running is not ready and ready is not verified; a criterion is VERIFIED only on an
independent owner's record; `unknown` is a legal answer and never a guess.

**The checkout is untrusted data.** A command runs only as a file of the checkout declared it, as an argument list
through the Process port -- never a shell line a model, a prompt or a setting wrote. Text from a file is made
printable before a terminal sees it, a reader is bounded, and a tool's version is asked from a neutral directory.
Changes are made in a task's own workspace; the primary checkout is written only by a person's own act.

**Autonomous by default; a person decides only at a protected boundary.** Reading, planning, building, testing, QA, a
task's own workspace and local commit, its sandbox with containers and local databases, and a staging deploy wait for
nobody. Five boundaries, declared once in `src/protected/boundaries.mjs`, stop for a person: primary checkout write
(DENY), git push, production deploy and production database migration (approve once), and destructive production data
(approve once, marked destructive). An executor describes its action as a structure and asks `authorize()`
(`src/protected/authorize.mjs`); an approval is for exactly one action, granted in Orbit Control and spent before the
action starts. No run id, agent id, mode or word is authority.

**No product knowledge.** If a sentence about a change names a product, a vendor, a hostname or a stack, it belongs in
the consuming project's data. A provider is a capability behind the one `call` verb, a technology is an adapter's to
know (`orbit.adapter/v1`), and product words live in packs under `skills/` and in `catalog/`. Tests grep `src/` for
them.

**Decisions are ordered tables, and the vocabulary is data.** Where the code chooses, it reads a table of rows over
facts -- first match wins, the last row always matches, each row says its reason in a sentence -- never a chain of
branches: whether a repository must be read, which provider serves a need, what a failure is, when to stop, what a
settled action moves. The DSL is rows too (`src/dsl/core/verbs.mjs`, `src/dsl/core/fields.mjs`), and its schema, its
rules and its introspection are derived from them. A new case is a new row, and no file enumerates a vocabulary
another table owns (callers ask `verbsWhere("changes")`, never a list of verbs).

**Memory first.** What Orbit learned is kept and re-measured, not re-derived: `architecture ensure` decides whether the
repository has to be read at all, and the normal answer is CURRENT for the cost of a few git calls. Freshness is keyed
to a fact's own scope, never to HEAD, and the decision to scan is printed.

**Zero dependencies.** `package.json` has none: the engine is Node >= 20 built-ins only. A tool Orbit runs -- an MCP
server, an Azure CLI -- is installed privately from a pin into the store, never a dependency of the engine. Orbit
Control's page keeps its own dependencies in `control-panel/` and commits its build into `control-server/public/`.

**Five Lines of Code.** A function body has at most five statements, no `else` and no `switch`;
`node cli/check-five-lines.mjs src cli skills --strict` prints `0 finding(s)`, and the suite runs the same check. When a
function grows, the part that grew becomes a named function that says what it does. Together with ordered tables, this
is why the code reads as many small named functions over data.

## Layers and dependency direction

`cli → automation | orchestration → investigation → run | query | awake | plan | qa | architecture | engineering | intelligence | knowledge | help |
project-report | runtime | task | lifecycle | live → routing | trace → resources → mcp | tools | connections | extensions |
capability | skill-factory | dsl | graph | ports | store | ecosystems → project`. Never the other way.

```text
  cli/  · control-server/ · satellite/cli/     composition roots: argv → real ports and config → a subject → exit code
    │
    ▼
  automation · orchestration                   the coordinators: a workflow, an engineering task
    │
    ▼
  investigation                                autonomous QA's engine half
    │
    ▼
  run · query · awake · plan · qa · architecture · engineering · intelligence · knowledge · help ·
  project-report · runtime · task · lifecycle · live                                         the subjects
    │
    ▼
  routing · trace                              the planner, and the session trail
    │
    ▼
  resources                                    what Orbit can use here: one registry
    │
    ▼
  mcp · tools · connections · extensions · capability · skill-factory · dsl · graph · ports · store ·
  ecosystems                                                                               the mechanisms
    │
    ▼
  project                                      a checkout's paths, identity and store root

  beside every layer, the LEAVES any module may import: errors · hash · quote · scrub · printable · freshness ·
  tokens · version · tests-tree · catalog · secrets · process/env · policy · protected/ · attribution · engined
```

"Ports" are the doors to the world outside the process, each with one real adapter, and fakes in `test/fakes/`:
`src/browser/`, `src/database/`, `src/identity/`, `src/frontend/` (the source tree, through git), `src/process/` (argv
only, never a shell), `src/memory/` and `src/probe/`. A composition root parses arguments, binds the real ports and
configuration, and hands each subject what it needs; that is why the boundaries below keep saying "handed IN". A
subject is a function of what it was given, so its test substitutes a fake for every port.

Some subjects are not on the line, and their boundary is stated on its own: below for `src/task/`, `src/improvement/`,
`src/requirements/`, `src/sources/` and `src/work/`, and in the module map for the rest (`src/goal/` imports leaves
and the store only; `src/live/` imports only leaves, the store primitives and itself).

### The import boundaries

This is the full text of every import boundary, moved here whole from AGENTS.md (which keeps one line for each); it
binds every change as AGENTS.md does. The tests it names grep the imports and hold it.

#### Knowledge and the session trail

`src/knowledge/` imports none of architecture, engineering, intelligence, qa, learn's analyses or a host: the source
tree, the gates architecture's facts cite, the tracked listing, the working set, the cases, the resource registry and
the host-memory providers are bound by `cli/knowledge.mjs` and handed IN (`test/knowledge-acceptance.test.mjs` greps
the imports). `src/trace/` imports only the leaves and the argument and output helpers every view shares; the
lifecycle subscribers and the router's hook write to it, `cli/trace.mjs`, Control and Satellite's composition root
(0.2.2: which host agent carries which run) read it, and it reads none of them back.

#### Tasks, improvement and orchestration

`src/task/` imports only the leaves, the store primitives and itself: a task references a work, a requirement, a
snapshot, a runtime session and an investigation by id and reads none of them, and only `cli/task.mjs`,
`cli/autonomous-engineering.mjs`, `cli/live.mjs` and `cli/track.mjs` (readers) and `control-server/src/core.mjs`
import it (`test/task-ops.test.mjs` greps both). `src/improvement/` (0.3.0) imports only the leaves, `learn/args`,
`memory/session`, `project/boundary` and the store's primitives: the skill factory, the coordinator's skill runner and
the task door, Satellite's definitions and missions, learn and the trail are bound by `cli/improve.mjs` and handed IN,
and only it, `cli/live.mjs` and `control-server/src/core.mjs` import it (`test/improvement-boundary.test.mjs` greps
both). `src/orchestration/` sits above all of them and imports none: the task's write door, requirements, work,
runtime, the workspace's git, the check runner's Process port, project context, capabilities and investigations are
bound by `cli/autonomous-engineering.mjs` and handed IN (`test/orchestration-vocab.test.mjs` greps the imports). The
project's store root it is handed comes from `projectStoreRoot(base, key)` (`src/project/repository.mjs`), the one
definition `repositoryPaths` uses too.

#### Run and extensions

`src/run/context.mjs` binds an empty knowledge registry (`src/extensions/knowledge-parts.mjs`) beside the dsl,
capability and validator registries it already binds, because the loader registers into whatever registries a context
carries -- the one edge from `run` into `extensions`, and it is to a registry, never the loader. `src/extensions/` may
read `src/capability/`, `src/dsl/` and `src/run/verbs/` because it is what BINDS them to a project's own modules;
nothing in those may read it back, and a capability sees `src/extensions/context-v1.mjs` and nothing else of the
engine at all.

#### Resources, tools and connections

`src/resources/` is the one place that composes the resource families; `src/mcp/` and `src/tools/` never read it back,
and nothing in `src/routing/` reads a host's configuration, a PATH or a catalog file -- it reads the registry.
`src/store/archive.mjs` is the one install transaction both `src/tools/` and `src/mcp/` call, so neither reads the
other. `src/tools/pylock.mjs` (0.2.1) stages and promotes through it too. `src/tools/launch.mjs` is the one owner of
what a child of a tool that keeps identity state is given, and `src/connections/auth.mjs` the one contract every
reader, collector and probe asks for a request's authorization: `src/connections/` reads no tool, because how a
connection signs in is an adapter's (`skills/orbit-report/auth/`), bound with the tools port by the composition roots.

#### Leaves: one answer, several askers

`src/policy.mjs` is a leaf for the reason `src/freshness.mjs` is one: the resolver (routing) and the MCP invocation
gate (mcp) must give the same verdict and neither may import the other. `src/attribution.mjs` (0.2.2, ADR 0044) is a
LEAF for the same reason: the trail, Orbit Live, Satellite and Control must say one attribution word about one call,
and none may import another for it. `src/protected/` (0.2.0) is a LEAF for the reason `src/policy.mjs` is one: the
task's approvals, the orchestrator, the capability pipeline, the MCP broker, the runtime writer, automation's matrix
and Live must give the same verdict about the same action, and none may import another -- it imports only
`src/hash.mjs`, `src/scrub.mjs` and `src/printable.mjs`. `src/ecosystems/` is a leaf both architecture and
intelligence read, for the reason `src/freshness.mjs` is one.

#### Project context

`src/context/` is pure data; `cli/context.mjs` composes it with the process port. Since 0.6.0 (ADR 0058) it also holds
the relation adapter CONTRACT (`src/context/relations.mjs`) and nothing of a language: the adapters live in a pack
(`skills/orbit-develop/relations/`, JavaScript/TypeScript and Python) and are handed in with the tracked listing, the
read and the search by `cli/context-grounding.mjs` (`test/context-relations.test.mjs` greps `src/context/` for a
language, a framework or a stack).

#### Intelligence and architecture

`src/intelligence/` imports none of architecture, engineering, qa, learn or the extensions: the source port (asked of
`architecture/context.mjs` `scanRoots`), the registered capabilities, the binding engineering conventions and
engineering's untrusted door (`engineering/observe/index.mjs` `admitted`) are all bound by `cli/intelligence.mjs` and
handed IN, so it adds no lateral edge. `src/architecture/` sits beside `src/qa/` and imports neither it nor
`src/learn/`: the layer-tooling answer `capabilitiesOf` gives is computed by `cli/` and handed IN as data, which is
what keeps it from becoming a lateral edge of its own.

#### Requirements, sources and work

`src/requirements/` imports leaves, `src/memory/` and `src/store/` only. `src/sources/` and `src/work/` sit above
`src/knowledge/`'s resolver and stamped door, `src/routing/` through it, `src/resources/`, the MCP broker and the
capability pipeline; `src/work/requirement.mjs` is the ONE place a work reads `src/requirements/`, and it only reads.
Readers, the registry, the opportunity port and the clock are handed in by `cli/requirements.mjs` and `cli/work.mjs`,
so nothing under these three imports a provider, and `test/requirements-core.test.mjs` greps their imports and their
words.

#### The four lateral edges, and the composition layer

Four lateral edges exist and are one-way: `query/check.mjs` reads `qa/schema.mjs` to report a stale
`plans/schema.json`, `qa/views/suggest.mjs` reads the `learn` port, `query/triage.mjs` reads `report/` — `readRun`,
`model`, and review's own `UNJUDGED`/`WITNESSES` — and `engineering/context.mjs` reads `architecture/context.mjs`'s
`scanRoots` and `architecture/source.mjs`'s `withStoredConfig`. That fourth one is the same "which trees does this
project's code live in" question asked once: architecture and engineering reason about the identical source tree from
two different questions, and a second definition of that question is how the two subjects would drift about a
directory that moved. The `query/triage.mjs` one is deliberate for its own reason: `run-log.jsonl` has exactly ONE
reader, and a second would be a second story about the same run, the way two definitions of a session would be two
stories about one tester's day. None closes a cycle, and none may grow into `qa` deciding a run's verdict, `learn`
editing a plan, `engineering` rewriting an architecture fact, or `triage` deciding anything at all — it prints the
verdict the run earned and never re-judges it. `src/help/` reads architecture, engineering, qa and learn the same way
`cli/` does — snapshots, never mutation — so it is not a fifth lateral edge, only another caller at the composition
layer. `src/lifecycle/` is the same: its subscribers read learn, architecture and engineering, and write only through
their own ports (a lesson fold, a working-set line, `ingest`), never across them.

#### The process boundary

Only `src/project/` and the adapters may read `process.env`, `process.cwd()` or spawn a process, and each takes those
as parameters so a test can substitute them. `src/run/context.mjs` is the one place real adapters are bound to real
config.

## Ownership

### Who owns what, when a case fails

One table, and every arrow in it is one-way. Getting this wrong is expensive in one direction in
particular: reading a failure as MAP_DRIFT sends somebody to edit a record that was right, and the
defect it was hiding ships.

| | owns | may never |
|---|---|---|
| `src/dsl/` | **the DSL truth** — `fields.mjs` + `verbs.mjs`, and the rules over them | be duplicated in prose anywhere |
| `query dsl` · `verb` · `field` | the **introspection view** of that truth, generated | keep a second table |
| `skills/orbit-ui-test` | the DSL **playbook**: how to author and run | restate the vocabulary |
| `orbit-failure-analyst` | **classify** one failure into one of nine causes | mutate a case, a map, or a verdict |
| `orbit-dsl-doctor` | repair an invalid case **representation** | change what a case MEANS |
| `orbit-map-healer` | repair **one locator** on one existing edge | apply its own patch, or touch a case |
| `src/run/` | the verdict | be re-judged by any of the above |

Self-healing is never "change the test until it passes". It is: classify, repair only the artifact
that category owns, put the repair back through the engine that would have rejected the bad
artifact, then decide *separately* whether to run again.

### How a verdict flows

1. **The run decides.** `src/run/status.mjs` gives the final word; a step throws a typed outcome (`StepError` FAIL,
   `Refused` REFUSED, `Blocked` BLOCKED) or nothing, and `cli/` maps them to exit codes once. A database that cannot be
   reached is BLOCKED, never a FAIL: the product is not broken because a laptop is off the VPN.
2. **A failure is classified, not fixed.** `orbit-failure-analyst` reads the engine's own evidence and names one cause
   of nine -- `DSL_INVALID`, `AUTH`, `ENVIRONMENT`, `DATA`, `MAP_DRIFT`, `PRODUCT_FAILURE`, `TIMING`, `CASE_LOGIC`,
   `UNKNOWN` -- from `src/query/classify.mjs`, an ordered table over facts `src/query/triage.mjs` assembles from the
   run's log, never over an error message's text. Its confidence is `high` or `low`, and only `high` carries a handoff.
3. **Only the owner of that cause repairs.** `DSL_INVALID` goes to `orbit-dsl-doctor`, which repairs how the case is
   written and never what it means; `MAP_DRIFT` goes to `orbit-map-healer`, which proposes ONE locator patch and never
   applies it. Every other cause carries no handoff: its row says what settles it next, no specialist edits anything
   for it, and `UNKNOWN` is a correct answer.
4. **The repair goes back through the engine that would have refused it.** A case is validated again; a map record is
   corrected with `record-edge.mjs --replace`, through the same `check` and rollback as an append.
5. **Running again is a separate decision.** A rerun is a new run with a verdict of its own; nothing re-judges the
   first, and a test is never changed until it passes.

### Owners beyond a test case

The same shape holds for every owner: one writes, the rest read back.

| Artifact | Its owner, and the one door it is written through | Read back, never re-judged, by |
|---|---|---|
| a case's verdict | `src/run/` (`status.mjs`); the ledger through `recordRun`, which scrubs | triage, reports, coverage |
| what a requirement says | `src/requirements/` (`ingest.mjs`, the one writer); a person's word only with `--human` | work, engineering tasks, workflows, goals |
| an execution | `src/task/` (`ops.mjs`, the one write door), an append-only journal | the orchestrator, the coordinator, Live, Control |
| what a change must pass, and whether it did | an engineering task's verification plan and COMPLETION rows (`src/orchestration/obligations.mjs`, `verification.mjs`) | coordinated workflows, Satellite, goals |
| what a QA investigation found | `src/investigation/`, its journal and its oracle rules | autonomous engineering, the security auditor, Satellite |
| how this project builds code | `src/engineering/` (`ingest.mjs`, the one write door) | project context, help |
| what a project knows | `src/knowledge/` (`ingest.mjs`, the only caller of `know.save`) | knowledge queries, verification, project context |
| the checkout outside `ui-tests/` | `src/runtime/writer.mjs`, crossed only by a person's own act in Orbit Control | -- |

## Data

### The plugin, the store and the checkout

- **The plugin directory** is immutable product code and catalogs (`catalog/`: what each skill and agent is for, the
  hosts, the MCP servers and tools Orbit knows, runtimes, packs, topology, semantics, the starting knowledge
  vocabulary). An upgrade replaces it whole, so it holds no state, and no runtime is ever installed into it.
- **The machine store** keeps every byte of mutable state, outside every repository. Its base is `~/.orbit/projects/`;
  `ORBIT_STORE_DIR` is the one override and relocates all of it.
- **The checkout** is the product's repository, read as untrusted data. Its test data lives there only when a team
  chose it (an explicit `dataHome: "checkout"` stamp, `init --in-checkout`); otherwise nothing Orbit keeps is in it.

### The machine store

`node cli/query.mjs storage --json` prints the paths for this checkout before anybody constructs one, and each subject's
`where` prints its own. The main rooms, as the current layout 3 has them:

```text
<storeBase>/                          ~/.orbit/projects/, or ORBIT_STORE_DIR
  state/checkouts/<checkoutId>.json   which project a checkout is bound to: a KNOWN checkout
  state/projects/<key>.json           one line per checkout, as of a time -- never a directory scan
  control/                            what a person configured: MCP and tool resources, connections, automation
                                      settings, policies, approvals, receipts, activity, auth/<profile>/
  control/activity/trace/             the session trail: metadata by allow-list, a shard per day and host
  runtimes/                           what Orbit installed: managed MCP runtimes and private CLI tools
  organization/                       an organisation's vocabulary layers and claims, shared by its projects
  repo-<sha>/                         ONE project, keyed by repository identity (every checkout of it shares it)
    store.json                        the layout stamp, and a person's choice of data home
    ui-tests/                         test data by default: project.json, graph/, schema/, screens/
    drafts/                           agent-authored cases, kept out of shared regression
    runs/  notes/  evidence/          the run ledger, the notes, each run's evidence
    reports/                          self-contained HTML reports
    memory/  architecture/  engineering/  intelligence/  knowledge/     what Orbit knows about the project
    sources/  requirements/  work/    what a work item WAS, what a requirement says, what is being done about it
    tasks/  goals/  orchestration/  workspaces/  autonomous-qa/          executions: journals, workspaces, QA
    generated-skills/  improvement/  satellite/       project playbooks, improvement campaigns, missions
    checkouts/<checkoutId>/           per CHECKOUT: runtime understanding, proposals, environments, settings
    runtime/<host>/                   live and per host: sessions and logs
```

The rules every room keeps (AGENTS.md, "Storage contract"): a room is created on its first write and never on a read;
every writer holds a lock, checks the revision it read and is contained through symlinks; only current schemas are
read, and unsupported or corrupt state is reported and preserved byte for byte -- there is no migration, alias or dual
read. Checkouts of one repository share its project; what differs per checkout (what it takes to run it) is keyed by
checkout, and what differs per host (sessions, a browser) by host.

Two kinds of state live elsewhere on purpose. A connection's credential is never in the store: it goes to the OS secret
store (`src/secrets.mjs`, `skills/orbit-control/vault.mjs`), and Orbit keeps the reference. The evaluator's campaigns
live under `$ORBIT_EVAL_HOME` (default `~/.orbit-eval`); what a person commits of them is exported under
`evaluator/results/`, which is export-ignored.

### What never lives in a checkout

Reports, lessons, journals, evidence, drafts and runtime state; the store itself, not even in a gitignored directory;
a credential, a token, a browser profile or anything with cookies. A report is never committed: it would publish a
tenant's screenshots. `storage import` and `storage export` move test data between the store and a checkout only as a
person's explicit transfer, with digests and a preview, and writing into the checkout needs Control's door or a person
typing the preview id back at a terminal.

## The main flows

### Running a UI test case

```bash
node cli/run-case.mjs <case-id> NAME=TC-1 --report
```

1. `cli/run-case.mjs` resolves the project's paths (`src/project/`) and binds the real adapters to the real
   configuration (`src/run/context.mjs`): the browser through `playwright-cli`, the database, the identity, the
   process port. It loads the case from `ui-tests/screens/<screen>/cases/<id>.json`.
2. The case is held to the DSL (`src/dsl/`: every rule derived from the verb and field tables) and to the UI map
   (`src/graph/`); a verb that resolves from the map does so before the run (its `plan`). An invalid case is REFUSED
   before any browser call.
3. Gates run before anything acts (`src/run/gates/`: the session, the identity, the start screen, the origin, a stale
   map, a destructive case, the bindings, a fixture grant); a gate refuses with `Refused`.
4. The loop (`src/run/loop.mjs`) runs each step through `src/run/step.mjs` and its verb's file in `src/run/verbs/`,
   then the ONE wait loop (`src/run/budget.mjs`, `src/run/poll.mjs`) proves the step landed. Every declared field of
   every step, the answers and the evidence go to `run-log.jsonl` in the store's evidence room.
5. `src/run/status.mjs` gives the final word and what it proved per layer; the ledger records the run (`recordRun`,
   through `src/scrub.mjs`).
6. With `--report`, `src/report/` writes one self-contained HTML page into `<store>/reports/<screen>/<case>/`: every
   picture embedded and the case's own JSON inside, so `run-case <that-report.html>` runs the case again.
7. A run that did not pass goes to the [verdict flow](#how-a-verdict-flows).

### An autonomous engineering task

```bash
node cli/autonomous-engineering.mjs start --ref=<item>          # or: start "<objective>"
node cli/autonomous-engineering.mjs context <task>              # where it stands, and the one command that goes on
node cli/autonomous-engineering.mjs step <task> < decision.json # one decided action, as often as it takes
node cli/autonomous-engineering.mjs finish <task>
```

1. `start` reads the requirement's newest snapshot and its work back, or takes an ad-hoc objective, and creates a TASK
   (`src/task/`): an append-only journal under `<store>/tasks/<tsk-id>/`, the only state a task has.
2. `context` writes nothing. It says the stage, the attempt, the budget, the workspace, the declared checks and what
   completion still needs, and it ends with `do`, the one command that goes on.
3. The host's model sends ONE decision. `src/orchestration/decision.mjs` judges it; it is recorded before its side
   effect, run as an owner's operation (`src/orchestration/dispatch.mjs`) and settled with a receipt. Every step asks
   the protected boundaries first (`src/orchestration/policy.mjs`).
4. The change is made only in the task's OWN workspace, a local clone of the checkout
   (`src/orchestration/workspace.mjs`, `src/frontend/local-clones.mjs`). A task may also prepare its own sandbox
   (`src/runtime/sandbox/`), autonomously, every restore and container fingerprinted.
5. A check is a command the checkout DECLARED, as runtime understanding read it (`src/runtime/`), `safe` only, run
   argv-only (`src/orchestration/checks.mjs`). Which checks are REQUIRED follows from what the change reaches
   (`impact.mjs`, `obligations.mjs`). A running check is observed beside the task, never in it
   (`src/orchestration/activity/`).
6. The stages move by table -- REQUIREMENT, CONTEXT, ENVIRONMENT, WORKSPACE, PLANNING, IMPLEMENTING, BUILDING, TESTING,
   DIAGNOSING, FIXING, REGRESSION, REVIEWING (`src/task/vocab.mjs`, `src/orchestration/stages.mjs`). A failure is
   classified from facts (`failure.mjs`); three attempts on one signature is NO_PROGRESS.
7. `finish` completes the task only when every COMPLETION row holds (`src/orchestration/verification.mjs`). A verified
   change is committed autonomously, in a git directory beside the workspace; its push waits for one approval of
   exactly that push in Orbit Control (the GIT_PUSH boundary); nothing merges.
8. A step that died before it settled is read back by `reconcile`, never sent again.

### A coordinated workflow and a goal

`/orbit-help <objective>` is the entry point of a coordinated workflow (ADR 0017, 0022), and `/orbit <specification>`
of a goal (`cli/orbit.mjs`), which runs workflows of its own:

```bash
node cli/automation.mjs start --for="<objective>"     # what /orbit-help runs when a workflow fits the task
node cli/orbit.mjs goal start --stdin < spec.md        # then: goal analyze · plan · step · verify · report
```

A **coordinated workflow** is a task of its own (provider `automation`) whose every step is an owner's:

1. `start` classifies the objective -- or takes the intent the caller DECLARED -- resolves each capability it needs
   through the resolver (`src/routing/`), and plans the workflow as a graph the tables draw (`DEPENDS`,
   `src/automation/graph.mjs`): a plan artifact named by a receipt, never a state.
2. A step is a frozen requirement read back, runtime understanding, an engineering task started through autonomous
   engineering's own `start`, a QA investigation, or a project playbook. The host runs the step's skill or dispatches
   its agent; an engine step runs in the engine. One step runs at a time.
3. `settle` reads the step's evidence back from its owner's record (`src/automation/evidence.mjs`), never the host's
   word alone, and only from this workflow's own records.
4. The plan is revised only by a `TRIGGERS` row over what a journal or an owner shows (`src/automation/replan.mjs`),
   bounded by `execution.maxReplans`; each revision is a new artifact naming the one it replaced.
5. A step whose WORKFLOW nothing here provides may get a project playbook drafted by the skill factory
   (`src/skill-factory/`): instruction-only, project-scoped, verified and registered, and only while the automation
   policy allows it; a capability or a policy gap stays a person's to decide. A playbook that declares a workflow runs
   through `src/automation/skill-run.mjs`, each step through its provider's own gate.

A **goal** keeps a whole specification and plans units from it:

1. `goal start` keeps the specification as submitted (`src/goal/spec.mjs`) under `<store>/goals/`.
2. `goal analyze` takes the structured intent the host's model read the goal into -- category, work kinds,
   capabilities, verification, dependencies, missing prerequisites (`src/goal/intent.mjs`) -- held as it was sent.
3. `goal plan` draws the units from `WORK_KINDS` alone (`src/goal/plan-units.mjs`), never from the objective's words,
   so a goal and its translation plan the same; a unit a missing prerequisite blocks is UNRESOLVED.
4. `goal step` starts each unit's coordinated workflow with the intent its kind declares
   (`automation start --intent=… --goal=<goal>:<unit>`), and the coordinator links it back.
5. `goal verify` is the goal's completion gate (`src/goal/verification.mjs`), and `goal report` says what it came to.

### A Satellite mission

```bash
node satellite/cli/satellite.mjs mission start --stdin < goal.txt
node satellite/cli/satellite.mjs mission context <msn>
node satellite/cli/satellite.mjs mission step <msn> < decision.json
node satellite/cli/satellite.mjs mission finish <msn>
```

1. `mission start` keeps the goal as submitted, with its digest, under `<store>/satellite/missions/<msn>/`.
2. The host decides one step at a time; Satellite judges each decision, journals it and runs it through one execution
   gateway: analyze (facts, hypotheses, acceptance criteria, frozen after the first analysis), recall, plan (a
   bounded, acyclic graph of units, revised only on a trigger), staff (a role and an agent template, reused first),
   resolve or generate skills through Orbit's skill factory, dispatch, invoke, report.
3. Each unit is a NEW agent run under a least-privilege profile -- on Claude Code the plugin agents
   `orbit:satellite-reader`, `-designer`, `-engineer` and `-verifier`, in parallel up to the mission's limit; on the
   other hosts serially, in the main session.
4. A source change happens only inside an autonomous engineering task's own workspace, started through that owner's
   CLI; a capability is asked only through Orbit's own door (`invokeBound`).
5. `mission finish` is COMPLETED only when every criterion is VERIFIED by an independent owner -- an engineering task's
   verification rows, a check its runner ran, a QA investigation's outcome; otherwise it is REPORTED with what is owed.
   `mission reconcile` reads every open action back and resends nothing.

### A prompt, routed and followed through

On Claude Code every hook below is wired; the other hosts carry fewer of them ([docs/hosts.md](hosts.md)).

1. **The prompt.** `cli/router-hook.mjs` hands it to the prompt router (`src/routing/`): the intents it names (a table
   of generic words, English and Vietnamese), a requirement graph, ONE provider per requirement among the ELIGIBLE
   resources of the registry (`src/resources/`), and a strategy -- NONE, DIRECT, COORDINATED, SATELLITE or RESUME
   (`src/routing/strategy.mjs`). It adds at most 2 KB of context, nothing at all for NONE, and keeps no prompt: the
   trail gets a salted fingerprint and a length.
2. **Facts, not guesses.** A fact about the session's own work (`src/routing/facts.mjs`: `check.failed`,
   `check.repeats`, `knowledge.owed`) brings in a component whose catalog row `reactsTo` it, and the same resolver
   picks who provides it.
3. **Before a tool.** A skill or agent a person switched off is refused (PreToolUse).
4. **After a tool.** A working-set line and a trail event are written; at a milestone the engineering observer runs.
   After a FAILED call, at most one line of advice, and silence by the ordered `SILENCE` table
   (`src/lifecycle/advice.mjs`).
5. **At Stop.** The hold (`src/lifecycle/subscribers/hold.mjs`) may keep a turn open with the next ready step of this
   session's own workflow or goal, and the owed hold (`owed.mjs`) once per prompt when the turn edited code a component
   owns and no check passed after the edit. A hold runs nothing; its one write is `turn.held` on the trail.
6. **After an agent returns.** One line names the owner record that settles its work.

### Knowledge and learning

1. Every host event becomes ONE lifecycle event, dispatched to isolated subscribers (`cli/learn-hook.mjs`
   `SUBSCRIBERS`, `src/lifecycle/subscribers/`). Only a checkout the machine KNOWS is observed (`knownCheckout`).
2. The working set keeps what a session touched, metadata only (`src/engineering/working-set/`); the session trail
   keeps events by allow-list (`src/trace/`). Neither keeps a prompt, a response, a tool's input or output, or a file's
   contents.
3. At a milestone -- a commit, a session's end, a check passing after an edit -- the engineering observer proposes
   `observed` candidates through the one untrusted door (`src/engineering/ingest.mjs`), and an ordered table reconciles
   them. A completed engineering task teaches from its own receipts. A lesson needs two independent sessions, and
   independence is a host on a UTC day (`src/memory/session.mjs`).
4. Architecture and intelligence are memory first: `architecture ensure` and `intelligence ensure` decide whether the
   repository has to be read at all, and a fact goes stale only when its own scope moved.
5. Project knowledge (`src/knowledge/`) is claims -- a subject, a relation and an object, in a context -- written
   through one door, with rivals settled when read and authority derived. A capability nothing provides is ONE
   opportunity a person decides; nothing is installed or generated for it.
6. A task's context (`cli/context.mjs`) composes all of it, memory first, with one word for how much of it rests on
   evidence (`src/context/status.mjs`) and whether it is enough to choose a scope on: ENOUGH, DISCOVER or ASK
   (`src/context/sufficiency.mjs`).
7. Self-improvement (`src/improvement/`, ADR 0045) rides the same moments: a playbook or a role improves only when
   independent sessions show it, through its owner's one selection door.

### A release

1. **The fast tier.** `node skills/orbit-release/ship.mjs --ci` runs the definition of done as data
   (`skills/orbit-release/gates.mjs`): the suite, the strict Five Lines lint, `query check` and `plan-check` on the
   fixture, zero dependencies, one version across the five manifests, and the layout and descriptions a host reads.
   Release qualification it cannot decide, so it prints `wait`.
2. **The evaluation.** The release's pre-registration (`evaluator/prereg/<release>.json`) is committed before any model
   run; campaigns are made from it (`node evaluator/cli.mjs prereg campaign`), never by hand, run detached and resumed
   after a restart. Each run's patch is graded by hidden tests in a fresh container with no network, into one outcome
   word.
3. **The record.** `node evaluator/cli.mjs record` writes it from the campaigns' journals alone.
4. **The publish gate.** `ship.mjs --evidence --evaluation=<record>` is ONE ordered table (`PUBLISH`,
   `skills/orbit-release/ship/evidence.mjs`): a clean checkout, the fast tier on this tree, the record and its
   pre-registration, the content of `git archive` of the evaluated commit against `git archive HEAD`
   (`skills/orbit-release/ship/artifact.mjs`), every held-out run present, the comparisons worked out again, and a
   verdict that is not REGRESSED. PUBLISHABLE, and only then, is the release PR merged and `v<version>` tagged.

How a Claude Code cloud session runs the campaigns is in [AGENTS.md](../AGENTS.md#shipping-a-release-from-claude-code-cloud).

## Extension points

Orbit grows by data and by contracts, rarely by a new branch in `src/`. Find the row for a change in
[docs/agents/extend.md](agents/extend.md) before writing it; a change with no row is a design question.

| To add | It is | Where it lives | Its contract |
|---|---|---|---|
| a provider: a database, a vendor SDK, a queue | a CAPABILITY behind the one `call` verb, never a verb | a project's extension in its store room, or a pack Orbit ships that a project opts into (`project.json` `packs`) | `orbit.extension/v2`, `orbit.capability/v1`; ADR 0034 |
| a technology: a broker, a scheduler, a store, an identity system | an ADAPTER behind a family operation `orbit.<family>.<op>`: an `adapter.json` and a helper in any language | a pack under `skills/` (the reference adapters are in `skills/orbit-backend-test/`) or the project's own extension | `orbit.adapter/v1` (`src/adapters/`), proved by the kits in `skills/orbit-adapter-kit/`; ADR 0035 |
| a project's own validator, relation or interpreter | an extension module | the project's store room, outside every repository | `src/extensions/contract.mjs`; a capability sees only `src/extensions/context-v1.mjs` |
| a workflow nothing provides | an instruction-only playbook, optionally with a declared `workflow.json` | `<store>/generated-skills/` | `src/skill-factory/`; ADR 0030 |
| a host | an adapter that normalizes its payloads into one lifecycle event | `skills/orbit-learn/hosts/` | `normalize()`, held by `test/host-conformance.test.mjs` |
| a language's file relations | a relation adapter | `skills/orbit-develop/relations/` | `src/context/relations.mjs`; ADR 0058 |
| what a library means, or an idiom it is used through | a technology descriptor (data) or a pure usage analyser | a pack, such as `skills/orbit-dotnet/` | the registries of `src/intelligence/` |
| an MCP server or a CLI tool Orbit may use | a catalog row; a managed server or a pinned private install | `catalog/mcp.json`, `catalog/tools.json` | `src/mcp/` (managed by a person in Orbit Control), `src/tools/` |
| an isolation provider for generated tests | a provider that says what it proves | `src/runtime/isolation/` | `orbit.isolation-provider/v1`; ADR 0038 |
| a verb or a field of the DSL | a row and a file -- the grammar, which grows rarely | `src/dsl/core/`, `src/run/verbs/` | the registry refuses a disagreement; extend.md has the row |

## Where to read more

| Read | For |
|---|---|
| [AGENTS.md](../AGENTS.md) | the rules that bind every change, the commands, the definition of done |
| [docs/agents/layout.md](agents/layout.md) | what each directory and module is for |
| [docs/agents/extend.md](agents/extend.md) | what to touch for each kind of change, and the test that proves it |
| [docs/hosts.md](hosts.md), [codex.md](codex.md), [grok.md](grok.md), [antigravity.md](antigravity.md) | what each host can do, and how a session is bound |
| [docs/orbit-current-contract.md](orbit-current-contract.md) | the current contracts, and what a fresh install accepts |
| [satellite/docs/README.md](../satellite/docs/README.md) | Orbit Satellite |
| [evaluator/README.md](../evaluator/README.md) | the independent evaluator |
| [control-server/README.md](../control-server/README.md) | Orbit Control |
| [integrations/orbit-web/README.md](../integrations/orbit-web/README.md), [integrations/vscode-orbit-live/README.md](../integrations/vscode-orbit-live/README.md) | the two integrations |

The decisions behind the code are the ADRs in [docs/adr/](adr/), by subject:

| Subject | ADRs |
|---|---|
| the test engine, plans and evidence | [0001](adr/0001-screenless-and-draft-plans.md), [0003](adr/0003-finding-occurrences.md), [0004](adr/0004-case-digest-and-scoped-invalidation.md), [0006](adr/0006-headless-cases.md) |
| requirements, sources and work | [0007](adr/0007-requirement-authority.md), [0009](adr/0009-requirement-intelligence-and-sources.md), [0010](adr/0010-work-and-needs.md) |
| QA investigations, oracles and verification | [0002](adr/0002-receipts-and-knowledge.md), [0005](adr/0005-the-loop.md), [0008](adr/0008-benchmark-with-ground-truth.md), [0031](adr/0031-a-test-obligation-rests-on-an-accepted-oracle.md), [0032](adr/0032-verification-outcomes-and-the-assessment-lifecycle.md), [0033](adr/0033-a-system-graph-of-structural-roles-and-layered-vocabularies.md) |
| tasks, orchestration and workflows | [0012](adr/0012-a-task-is-an-execution-not-a-work.md), [0013](adr/0013-an-orchestrator-coordinates-owners.md), [0017](adr/0017-a-coordinator-is-a-task-that-dispatches-to-owners.md), [0019](adr/0019-a-change-is-held-to-what-it-reaches.md), [0022](adr/0022-a-plan-is-a-graph-revised-on-evidence-and-live-is-one-view-model.md), [0023](adr/0023-autonomy-is-the-default-and-is-enforced-per-action.md), [0030](adr/0030-a-generated-skill-declares-a-workflow-the-engine-runs-through-owner-gates.md) |
| goals and Satellite | [0023](adr/0023-orbit-goal-domain-and-spec-persistence.md), [0041](adr/0041-orbit-satellite-is-a-mission-journal-above-owners.md), [0044](adr/0044-run-identity-and-attribution.md) |
| runtime, sandboxes and isolation | [0011](adr/0011-runtime-understanding-is-checkout-scoped.md), [0014](adr/0014-a-sandbox-is-an-environment-scope-a-task-owns.md), [0036](adr/0036-bounded-helpers-and-bindings-behind-a-synchronous-call.md), [0037](adr/0037-a-test-writes-only-through-an-engine-minted-fixture-grant.md), [0038](adr/0038-generated-tests-run-only-in-a-proven-isolation-worker.md), [0039](adr/0039-a-sandbox-topology-is-composed-from-discovery.md) |
| Orbit Live and the viewers | [0015](adr/0015-live-is-delivery-not-state.md), [0016](adr/0016-a-viewer-reads-the-journals.md), [0018](adr/0018-a-full-screen-viewer-is-one-more-viewer.md), [0020](adr/0020-live-opens-itself-and-a-check-is-observed.md), [0021](adr/0021-the-right-side-is-a-viewer-beside-the-cli.md), [0027](adr/0027-orbit-live-look-and-the-orbit.md)-[0029](adr/0029-the-orbit-turns-while-the-viewer-is-open.md) |
| packs, adapters and standards | [0034](adr/0034-orbit-ships-capability-packs-a-project-opts-into.md), [0035](adr/0035-the-orbit-adapter-protocol.md), [0040](adr/0040-standards-and-policies-are-configured-in-orbit-control.md), [0052](adr/0052-an-adapter-operation-declares-what-its-request-carries.md) |
| autonomy, boundaries and sign-in | [0042](adr/0042-autonomous-by-default-protected-boundaries.md), [0043](adr/0043-orbit-signs-in-through-an-azure-cli-profile-of-its-own.md) |
| the product's identity | [0026](adr/0026-orbit-identity.md) |
| the store, learning and context | [0024](adr/0024-the-store-is-the-home-of-test-data.md), [0025](adr/0025-learning-on-by-default.md), [0058](adr/0058-a-task-knows-enough-by-levels-on-its-own-work.md) |
| activation, follow-through and self-improvement | [0045](adr/0045-autonomous-self-improvement-on-independent-evidence.md), [0050](adr/0050-the-host-activates-orbit-by-capability-and-orbit-verifies-what-happened.md), [0059](adr/0059-proactive-execution-from-facts-said-once-and-explained.md) |
| measuring a release | [0057](adr/0057-an-independent-evaluator-measures-a-release.md) (0046-0056 are the in-repo benchmark it replaced, kept as the record) |
| Orbit Web | [0060](adr/0060-orbit-web-a-browser-host-around-the-official-clis.md)-[0069](adr/0069-orbit-web-accounts-are-the-gate-and-the-host-read-again.md) |
