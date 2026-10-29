# Orbit (engine)

An Antigravity plugin: the **Orbit Engine** runs UI test cases written as plain JSON through
`playwright-cli`, verifying UI, API and SQL, with evidence on failure. It ships to every team;
each team keeps its own data in the machine store (layout 3); all stores use the current layout 3 contract. This repo holds **no
product knowledge**. The test: *if a sentence about a change names a product, a vendor, a
hostname or a stack, it belongs in the consuming project’s data* — its `project.json`, `graph/meta.json`,
map, cases or playbook — **not here**. That includes words: no queue, directory service, blob
store or identity provider is named in this code; a project declares its own in
`graph/meta.json` and `check` then holds it to what it declared.

Read `README.md` first: architecture, the DSL, the design options, best practices.
For Claude Code-specific usage, see `CLAUDE.md`.

## Storage contract

Orbit is installed fresh. Only current schemas and API versions are accepted. Do not add aliases,
conversion adapters, schema upgrades, historical directory discovery, dual reads or dual writes.
Missing state is empty; unsupported or corrupt state is reported and preserved byte for byte.

Every Git checkout is an Orbit project using layout 3, keyed by repository identity. Its test data
lives in `<store>/ui-tests/` by default. An explicit `dataHome: "checkout"` stamp selects the checkout.
An existing directory never selects itself. `ORBIT_UI_TESTS` explicitly selects a current data directory;
its store uses the same layout and is keyed by that directory. No directory walk finds old data.

`query storage --json` reports the paths before callers construct them. `/orbit-help`, `init` and a
workflow's start seat a store project without writing the checkout. A seat creates only project.json
and generated schemas, never screens or cases. Each project has one writable data home and no mirror.
`storage import` and `storage export` are explicit transfers of current test data with per-file digests,
containment checks and stale previews. Writing into the checkout requires Control's door or a person
at a terminal typing the preview id back. Transfers preserve their source and do not convert schemas.
Reports, lessons, journals, evidence, drafts and runtime state always live in the machine store.

```
ui-tests/project.json · graph/ · schema/{case,plan}.schema.json
ui-tests/screens/<screen-id>/<plan-id>.plan.json (+ .md)
ui-tests/screens/<screen-id>/cases/<case-id>.json
<store>/reports/<screen-id>/<case-id>/<case-id>-<stamp>.html
```

IDs are file names and unique across the tree. The default store base is `~/.orbit/projects/`;
`ORBIT_STORE_DIR` is the sole override. Reads never create state. Every writer enforces containment
through symlinks, holds the appropriate lock and checks stale revisions. Same repository shares its
store; runtime sessions isolate checkouts. SessionStart recalls Orbit directly.

Three more rooms are store-only, additive under layout 3, and created on first WRITE and never on
read: `<store>/sources/` (what each work item WAS, and the project's binding),
`<store>/requirements/<root>/` (facts, questions, decisions, snapshots and their journal) and
`<store>/work/<id>/` (a journal of needs, bindings, receipts and checkpoints). None of them holds
the text of a work item, and there is no migration. A fourth, `<store>/tasks/<tsk-id>/`, is one
autonomous EXECUTION of a work: an append-only journal of its stages, attempts, decisions, actions,
receipt links and approvals, and the only state a task has (src/task/).

One more is keyed by CHECKOUT and not by project, because what it takes to run a checkout differs per
checkout: `<store>/checkouts/<checkoutId>/` (the understanding, proposals, environment instances and a
person's settings) and, live and per host, `<store>/runtime/<host>/checkouts/<checkoutId>/` (sessions
and logs). Both are created on first write, never on read and never in a repository. A checkout is
KNOWN to the machine because it was bound (`state/checkouts/<id>.json`); `state/projects/<key>.json`
keeps a one-line summary of each, as of a time, and nothing ever scans a directory for projects.

## Layout and dependency direction

The module map -- what each directory and module under `cli/`, `src/`, `skills/`, `agents/`, `catalog/`,
`control-server/` and `test/` is for -- is [docs/agents/layout.md](docs/agents/layout.md). Read it before you add,
move or split a module. What follows here is what binds every change: who owns what, and which way dependencies go.

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

`cli → automation | orchestration → investigation → run | query | awake | plan | qa | architecture | engineering | intelligence | knowledge | help |
project-report | runtime | task | lifecycle | live → routing | trace → resources → mcp | tools | connections | extensions |
capability | skill-factory | dsl | graph | ports | store | ecosystems → project`. Never the other way. `src/knowledge/` imports none of
architecture, engineering, intelligence, qa, learn's analyses or a host: the source tree, the gates
architecture's facts cite, the tracked listing, the working set, the cases, the resource registry
and the host-memory providers are bound by `cli/knowledge.mjs` and handed IN
(`test/knowledge-acceptance.test.mjs` greps the imports). `src/trace/` imports only the leaves and
the argument and output helpers every view shares; the lifecycle subscribers and the router's hook
write to it, `cli/trace.mjs` and Control read it, and it reads none of them back.
`src/task/` imports only the leaves, the store primitives and itself: a task references a work, a
requirement, a snapshot, a runtime session and an investigation by id and reads none of them, and
only `cli/task.mjs`, `cli/autonomous-engineering.mjs`, `cli/live.mjs` and `cli/track.mjs` (readers) and `control-server/src/core.mjs` import it
(`test/task-ops.test.mjs` greps both). `src/orchestration/` sits above all of them and imports none:
the task's write door, requirements, work, runtime, the workspace's git, the check runner's Process
port, project context, capabilities and investigations are bound by `cli/autonomous-engineering.mjs`
and handed IN (`test/orchestration-vocab.test.mjs` greps the imports).
The project's store root it is handed comes from `projectStoreRoot(base, key)`
(`src/project/repository.mjs`), the one definition `repositoryPaths` uses too.
`src/run/context.mjs` binds an empty knowledge registry (`src/extensions/knowledge-parts.mjs`)
beside the dsl, capability and validator registries it already binds, because the loader
registers into whatever registries a context carries -- the one edge from `run` into
`extensions`, and it is to a registry, never the loader. `src/resources/` is the one place that composes the
resource families; `src/mcp/` and `src/tools/` never read it back, and nothing in `src/routing/`
reads a host's configuration, a PATH or a catalog file -- it reads the registry. `src/policy.mjs`
is a leaf for the reason `src/freshness.mjs` is one: the resolver (routing) and the MCP invocation
gate (mcp) must give the same verdict and neither may import the other. `src/store/archive.mjs` is
the one install transaction both `src/tools/` and `src/mcp/` call, so neither reads the other.
`src/tools/pylock.mjs` (0.2.1) stages and promotes through it too. `src/tools/launch.mjs` is the one owner of
what a child of a tool that keeps identity state is given, and `src/connections/auth.mjs` the one contract
every reader, collector and probe asks for a request's authorization: `src/connections/` reads no tool,
because how a connection signs in is an adapter's (`skills/orbit-report/auth/`), bound with the tools port
by the composition roots.
`src/context/` is pure data; `cli/context.mjs` composes it with the process port. `src/protected/` (0.2.0) is a
LEAF for the reason `src/policy.mjs` is one: the task's approvals, the orchestrator, the capability pipeline, the MCP
broker, the runtime writer, automation's matrix and Live must give the same verdict about the same action, and none
may import another -- it imports only `src/hash.mjs`, `src/scrub.mjs` and `src/printable.mjs`. `src/intelligence/` imports none of architecture, engineering, qa, learn or the
extensions: the source port (asked of `architecture/context.mjs` `scanRoots`), the registered
capabilities, the binding engineering conventions and engineering's untrusted door
(`engineering/observe/index.mjs` `admitted`) are all bound by `cli/intelligence.mjs` and handed
IN, so it adds no lateral edge. `src/ecosystems/` is a leaf both architecture and intelligence
read, for the reason `src/freshness.mjs` is one.
`src/extensions/` may read `src/capability/`, `src/dsl/` and `src/run/verbs/` because it is what
BINDS them to a project's own modules; nothing in those may read it back, and a capability sees
`src/extensions/context-v1.mjs` and nothing else of the engine at all. `src/architecture/` sits beside `src/qa/` and
imports neither it nor `src/learn/`: the layer-tooling answer `capabilitiesOf` gives is computed
by `cli/` and handed IN as data, which is what keeps it from becoming a lateral edge of its own.
`src/requirements/` imports leaves, `src/memory/` and `src/store/` only. `src/sources/` and `src/work/`
sit above `src/knowledge/`'s resolver and stamped door, `src/routing/` through it, `src/resources/`, the MCP
broker and the capability pipeline; `src/work/requirement.mjs` is the ONE place a work reads
`src/requirements/`, and it only reads. Readers, the registry, the opportunity port and the clock are
handed in by `cli/requirements.mjs` and `cli/work.mjs`, so nothing under these three imports a provider, and
`test/requirements-core.test.mjs` greps their imports and their words.
Four lateral edges exist and are one-way: `query/check.mjs` reads `qa/schema.mjs` to report a
stale `plans/schema.json`, `qa/views/suggest.mjs` reads the `learn` port, `query/triage.mjs`
reads `report/` — `readRun`, `model`, and review's own `UNJUDGED`/`WITNESSES` — and
`engineering/context.mjs` reads `architecture/context.mjs`'s `scanRoots` and
`architecture/source.mjs`'s `withStoredConfig`. That fourth one is the same "which trees does
this project's code live in" question asked once: architecture and engineering reason about the
identical source tree from two different questions, and a second definition of that question is
how the two subjects would drift about a directory that moved. The `query/triage.mjs` one is
deliberate for its own reason: `run-log.jsonl` has exactly ONE reader, and a second would be a
second story about the same run, the way two definitions of a session would be two stories about
one tester's day. None closes a cycle, and none may grow into `qa` deciding a run's verdict,
`learn` editing a plan, `engineering` rewriting an architecture fact, or `triage` deciding
anything at all — it prints the verdict the run earned and never re-judges it. `src/help/` reads
architecture, engineering, qa and learn the same way `cli/` does — snapshots, never mutation — so
it is not a fifth lateral edge, only another caller at the composition layer. `src/lifecycle/`
is the same: its subscribers read learn, architecture and engineering, and write only through
their own ports (a lesson fold, a working-set line, `ingest`), never across them. Only
`src/project/` and the adapters may read `process.env`, `process.cwd()` or spawn a process, and
each takes those as parameters so a test can substitute them. `src/run/context.mjs` is the one
place real adapters are bound to real config.

## Rules that are enforced, not advised

- **Autonomous by default: a person decides only at a Protected Boundary (0.2.0, ADR 0042).** Everything Orbit does is
  AUTO -- reading, planning, a task's own workspace and its local commit, building, testing, QA, a task's own sandbox
  with its restores, containers and local databases, a staging deploy, an ordinary integration write, an action kind
  nobody has seen -- unless it crosses one of five boundaries declared ONCE in `src/protected/boundaries.mjs`: primary
  checkout write (DENY; a person's own act crosses it once), git push, production deploy, production database migration
  (APPROVE_ONCE) and destructive production data (APPROVE_ONCE_DESTRUCTIVE). An executor describes what it is about to
  do as a structured action and asks `authorize()` (`src/protected/authorize.mjs`) -- never a command string; what is
  production is what a person or a project DECLARED, and unknown is never production. An approve-once is the existing
  task approval: one open request per fingerprint, granted only in Orbit Control on the revision read, consumed before
  the action starts, its fingerprint derived again just before it runs; nothing else is an approval, and no approval is
  a standing permission. The capability pipeline refuses a protected call that carries no spent approval of exactly it
  and the MCP broker refuses a protected tool call outright, so no second route crosses
  (`test/protected-boundaries.test.mjs`, `test/protected-bypass.test.mjs`, `test/orchestration-push.test.mjs`).

- **Plugin code is replaceable; the machine store is durable; neither is "memory".** The plugin
  directory is immutable product code and catalogs. The machine store (`storeBase`) keeps
  MUTABLE state: `control/` is what a person configured (resource desired state, policies,
  approvals, receipts, activity, and in `control/auth/<profile>/` the sign-in state of a tool Orbit
  signs a person in through -- Orbit's own, never the developer's), `runtimes/` is what Orbit
  installed. MEMORY is project and
  engineering KNOWLEDGE (lessons, architecture, engineering, intelligence, runs). Never call a
  resource record "memory", never put a runtime in the plugin, never persist an absolute runtime
  path: a receipt holds a room name and relative paths, re-derived every time.
- **MCP is a managed resource, and a host's configuration is observed, never written.** A server
  Orbit may use is Orbit-MANAGED (managed.json, the machine store) and reached only through the
  broker's gate table (`src/mcp/invoke.mjs`). A server a host configured is EXTERNAL: listed,
  testable, never routed to, never called by Orbit, never written -- the MCP host port has no write
  method. Identity is compound (`managed:x` ≠ `external:x`), so two owners of one name are two
  resources. MCP state uses schema 3 and only current managed or external records. Unsupported
  records are refused and preserved. A host server is always external.
- **Skills declare what they need; resources declare what they provide; the resolver joins
  them.** A component row names capabilities (`needs`, `optional`), never a server or a tool; a
  catalog server names capabilities (`provides`), never a skill (`test/developer.test.mjs`). No
  skill-by-server mapping is stored anywhere; Control's resolved-providers and potential-consumers
  views are derived on every look (`src/routing/explain.mjs`).
- **Enable is eligible-to-consider, never inject.** The resolver picks ONE provider per
  requirement, only among ELIGIBLE resources (managed, enabled, runtime ready, selection not
  disabled, policy not deny), by an ordered table ending in a stable id; an OPTIONAL requirement
  is resolved only when the task names its provider. A simple change selects no MCP server
  however many are enabled.
- **A secret is named, never kept.** A managed definition names the environment variable each
  header or variable comes from; a value, a URL with credentials or a secret-named query key, or a
  secret-shaped argument is refused. Values are read from the secret port at the moment of
  connecting, never returned, logged or stored; a managed stdio child gets BASE_ENV and its
  declared variables, never the rest of the environment. A CONNECTION's credential is the one value
  Orbit accepts, once, from a person in Orbit Control -- and it goes straight to the OS secret store
  (src/secrets.mjs, skills/orbit-control/vault.mjs); what Orbit keeps is the reference. It is never an
  argument, never in a snapshot, a log, a report or a response, never handed to a part, and never
  read from another tool's store. A connection may instead SIGN IN (0.2.1, ADR 0043), and then Orbit
  accepts no credential at all: what it keeps is `auth: { strategy }`, and what it holds while it
  works is a short-lived token asked of the tool whose session it is each time one is needed -- in
  memory, never stored, logged, traced, reported, handed to a part or put in an argument or a variable.
- **A runtime is installed by a person -- or, for a private tool a catalog row lets Orbit fetch
  itself, by Orbit -- verified, and receipted last.** remote-http installs nothing; archive and
  python-lock stage beside the final directory, check the pin (the SHA-256, or the lock's hashes),
  verify, promote, and only then write the receipt. A receipt is not proof -- the entrypoint is looked
  for on every read. Removing a server from Orbit never deletes its runtime; deleting runtime files
  is a second act, only ever inside `runtimes/mcp/`, checked through symlinks.
- **Orbit may use an Azure CLI executable present on the machine, but it never uses the developer's
  Azure CLI identity state.** Since 0.2.1 (ADR 0043) every Azure CLI process Orbit starts is given
  Orbit's own profile: `AZURE_CONFIG_DIR` is `<storeBase>/control/auth/azure-cli` (the `authSessions`
  room: machine-wide, mode 0700, created by the first sign-in, never by a read and never in a
  repository). ONE owner builds the child's environment, `launcherOf` in `src/tools/launch.mjs`, from
  the catalog row's `profile` and `launch`, so no code names the variable, a pin or a product:
  `BASE_ENV`, the names the row lets through (`launch.inherit`: a proxy, a CA bundle, a display) and
  the row's pins, with the profile variable set LAST. No other `AZURE_*` of the developer's ever
  arrives, and nothing of their account, subscription, configuration, extensions or login session
  (`~/.azure`, `%USERPROFILE%\.azure`) is read, copied, imported or changed. The pins switch off what a
  profile directory alone does not isolate: the Windows account broker (a session kept OUTSIDE the
  profile, shared with the developer's own `az`), the macOS broker, and an encrypted token cache
  everywhere but Windows (a keystore entry has FIXED names every profile shares; on Windows it is a
  DPAPI file inside the profile), plus the subscription picker and telemetry. A version probe or an
  install's verification runs in a SCRATCH profile that is removed, because `az --version` alone
  writes files into whatever directory it is given. Which program runs is a table (`ensureOne`,
  `src/tools/ensure.mjs`): a private copy Orbit installed, else the machine's own `az` as a PROGRAM
  only, else an install of Orbit's own, else BLOCKED naming every candidate -- and every candidate
  passes one gate (it starts, names a version at or above the row's `minimum`, 2.61.0, and is a
  program of THIS operating system), so whichever runs, the profile is the same. Under WSL the Orbit
  state is the Linux system's: a Windows `az` reached through interop (under a Windows-drive mount,
  or a Windows executable) is refused as a candidate, and so is a profile on a Windows drive. The
  boundary: this governs the Azure CLI
  processes Orbit starts for its OWN sign-in. A project capability that itself declares
  `tools: ["az"]`, and `query doctor`, are the project's own declared dependency and are not routed
  through it (`test/azure-cli-isolation.test.mjs`, `test/tools-launch.test.mjs`,
  `test/tools-ensure.test.mjs`).
- **Orbit never reads Azure CLI token-cache files.** Azure CLI owns its own Microsoft authentication
  session; Orbit asks it for an ephemeral Azure DevOps access token through the documented CLI:
  `az account get-access-token`, and `az login` and `az logout` against Orbit's profile only. A token is
  only ever an ANSWER: held in memory until shortly before it expires, shared by every reader that
  waits on it, and never stored, logged, traced, reported, put in an argument or a variable, or handed
  to a part. The sign-in is one sequence and never a loop: a token; when the CLI says a person must
  act, ONE `az login` however many readers wait; then ONE token. A person who cancelled is told and
  nothing retries, a service that cannot be reached is not a reason to sign in, and a connection test
  never starts one. Everything the CLI printed is masked, scrubbed and cut to one short line before it
  is shown (`excerpt`, `src/connections/auth-errors.mjs`), and a refusal is BLOCKED (3) with an
  `AUTH_*` code and the one thing a person does next. Orbit never creates a personal access token and
  never installs the Azure DevOps CLI extension (`test/auth-contract.test.mjs`,
  `test/azure-cli-adapter.test.mjs`).
- **A private tool runtime Orbit may fetch itself is a pinned archive or a pinned lock, and nothing
  else (0.2.1, ADR 0043).** A catalog row that says `install.autonomous`, whose strategy is in
  `AUTONOMOUS_STRATEGIES` (`src/tools/ensure.mjs`: `archive` and `python-lock`) and which an installer
  serves on this platform, is installed by Orbit on its own initiative when a need finds nothing
  usable. No Protected Boundary holds it -- `tool.acquire`, `auth.token` and `auth.login` are AUTO
  (`test/protected-boundaries.test.mjs`) -- so a person is not asked, and the pin is the whole trust.
  An archive is pinned by URL and SHA-256 per platform. A `python-lock` is pinned by a lock shipped
  under `catalog/locks/` (grammar in `src/tools/lock.mjs`: `name==version` and every SHA-256 pip may
  accept, no option, URL, path or marker), which pip is run over with `--isolated --require-hashes
  --only-binary=:all: --no-deps`, inside a virtual environment of ORBIT's own interpreter (the private
  install of the row `install.python` names, never the machine's Python), staged beside the final
  directory, verified the way it will be run, promoted by one rename and receipted last
  (`src/tools/pylock.mjs`). Never a package manager, never `sudo` or any privilege, nothing put on
  PATH or in a system directory, and never a distribution a lock does not name. It is a tool Orbit
  runs, never a dependency of the engine: `package.json` still has none. It is also not a gap: a
  capability nothing provides stays one opportunity a person decides (below), and this is only a tool a
  catalog row already names. A release re-pins a lock with `skills/orbit-release/pin-python-lock.mjs`,
  and a person reads each lock's `re-picked` header lines.

- **Declared is not used, a technology is not a capability, and observed is not a rule.** Project
  intelligence keeps each on its own rung of the maturity ladder, from its own kind of evidence:
  a declaring manifest relationship, code (never a comment, a literal or a file name), a
  registration, the operation the code performs. An integration fact is keyed by system AND
  operation, so "system X means client Y" cannot be written from them. `resolve` decides reuse
  or build and never acts; `propose` reaches engineering only as an untrusted `observed`
  candidate. A package name, a client type or an idiom lives in a pack under `skills/` or in a
  project's own descriptor data -- a test fails the moment one appears under `src/intelligence/`.

- **Knowledge is contextual, an unknown relation is legal, and authority is derived.** A claim is
  a triple in a context, and two contexts are two claims: nothing collapses into a global rule. A
  relation means what a vocabulary ROW says -- an extension's, `catalog/knowledge.json`'s, an
  organisation's or the project's -- and one nobody declared is still stored, scoped, evidenced,
  recalled and shown; it derives nothing until a row or an interpreter understands it. Rivals are
  settled when READ, never overwritten when written, and an unsettled rivalry is UNKNOWN with the
  dimensions that would settle it. Authority (rule · adopted · source · confirmed · host-memory ·
  inference) is computed from what a claim already says, never stored. Nothing under
  `src/knowledge/` names a technology, a product, a domain or a host -- tests grep for each.
- **A gap is an opportunity, and only a person decides one.** A capability nothing here provides
  is remembered as ONE opportunity per capability, and `knowledge` exits 0: development goes on,
  and nothing is installed, enabled, generated or provisioned. Every proof need goes through the
  EXISTING requirement graph and resolver -- `src/knowledge/verify.mjs` never selects a provider
  itself, and `unknown` is never missing. The engine moves only what evidence moves, and only for
  the subjects a run examined; defer · accept · ignore · reopen are a person's, relayed with
  `--human`. Whether to interrupt anybody is SURFACE in `src/knowledge/surface.mjs`, ordered, a
  sentence per row: never asked twice in one session and workflow, and a verification that needs a
  deferred one asks again, because deferred means not now, never never. ONE scoped exception, for
  project REPORTS: when a report lacks what a person asked for, Orbit may itself scaffold, verify
  (by running it), register and activate the smallest report part for the CURRENT project -- a
  metric, section, transform, exporter, workflow or a collector of local sources -- and never one
  that replaces a standard part, needs a package, reads the source's API or a credential, or
  reaches another project (`test/project-report-extend.test.mjs` holds the line). A SECOND scoped exception, for PLAYBOOKS:
  when a coordinated workflow's objective needs a workflow nothing here provides, Orbit may itself scaffold, verify
  (by the same instruction rules Orbit Control's editor holds a shipped SKILL.md to, and its own table), register and
  activate the smallest INSTRUCTION-ONLY, project-scoped playbook for the CURRENT project -- only while the automation
  policy's skill-factory mode allows it, never a capability, never anything executable, never one that replaces or shares
  identity with a shipped skill, never with tools wider than the shipped workflow it was drafted under, never on a need
  nothing here provides, never for another project; a CAPABILITY or POLICY gap stays a person's to decide
  (`test/skill-factory-boundary.test.mjs` holds the line). Since 1.8.6 one workflow may draft one playbook per
  capability it needs that nothing provides, within `skillFactory.maxSkillsPerTask`; its SHAPE and the contract in its
  manifest are the engine's to write, its PHASE is derived on every read, and a generated executable stays refused.
  Since 0.0.4 the playbook may DECLARE its workflow (`workflow.json`, `orbit.skill-workflow/v1`, ADR 0030): DATA the
  engine interprets -- steps, each a capability the manifest needs, typed bindings, typed outputs, an output contract,
  bounds -- and never code: a field nobody declared is refused, so it has no command, script, expression or module;
  a step whose provider is not a managed server or a project capability, or one that would run a playbook, is refused
  at registration; and the factory's lifecycle, its person-only moves and `allowExecutableCode = false` are unchanged.
- **A declared playbook runs only through the doors that exist, and a call is never an outcome (0.0.4, ADR 0030).** At
  its playbook step the coordinator runs the workflow itself (`src/automation/skill-run.mjs`, mode `engine`): the version
  is PINNED for the run (a later attempt keeps it, whatever is registered after; a playbook a person switched off runs no
  version), each step is recorded (`act-start`, `skillstep … RUNNING`) before it is asked, the RESOLVER picks its provider
  at that moment (a provider switched off since the plan blocks the step there), an approval is checked then and spent
  once, and the call goes through the provider's own gate -- the MCP broker, narrowed to reading only, or the capability
  pipeline with no case -- by `invokeBound` (`src/work/invoke.mjs`, the door `invokeNeed` uses), never a tool executor.
  An `invocation` receipt keeps the provider's key and digests of what was asked and answered, never either; outputs a
  later step binds are read off the scrubbed answer and kept nowhere. A step is VERIFIED only when the `record` it
  names is read back from its owner and proves it; a call that answered within its contract is CONTRACT_MET and the run
  REPORTED. Reconcile closes an interrupted read as INTERRUPTED (the next attempt asks again) and anything that may
  have written as AMBIGUOUS (never asked again; a person decides). `src/automation/` still imports no subject: the
  interpreter (`src/skill-factory/interpret.mjs`) and the door are handed in by `cli/automation.mjs`
  (`test/skill-run.test.mjs`, `test/skill-lifecycle-e2e.test.mjs`).
- **A coordinated workflow's journal is its engine's alone (0.0.4).** The lines a coordinator reads its own state back
  from (`ENGINE_DOMAINS`: step, plan, skill, skillrun, skillstep, invocation, goal), a verification whose subject or
  obligation names one, and every line but a person's own decision in a task an engine owns (`ENGINE_OWNED`:
  `automation`) are written only through the coordinator's door (`door: "coordinator"`, set by `cli/automation.mjs`,
  never typed) or Orbit Control's. A terminal's `task link` or `task complete` on a workflow is refused; a person there
  still pauses, cancels and rejects (`src/task/rules.mjs`, `test/skill-run.test.mjs`).
- **A goal is planned from its structured intent, never from its words (0.0.4).** The host's model reads a goal into
  `intent` (category, work kinds, capabilities, verification, dependencies, missing prerequisites), held to
  `src/goal/intent.mjs` as it was SENT -- an unknown or engine-owned field is refused, never dropped -- and units come
  from `WORK_KINDS` alone, so a Vietnamese goal and its English twin plan the same; a unit a missing prerequisite blocks
  is UNRESOLVED and never started. Each unit's workflow is started with the routing intent its kind DECLARES
  (`automation start --intent=`, never classified again) and `--goal=<goal>:<unit>`, which the coordinator links back
  (`test/goal-intent.test.mjs`).
- **A report is computed from its own frozen snapshot, and says what it stands on.** A run collects
  ONCE, every page, then freezes the snapshot; every render reads only that snapshot. Nothing after
  the cut-off is counted; a gap is "not available (needs …)", never a zero; a state is read by its
  category; the forecast never reaches past the window for history; a baseline is only a comparable
  run. A part that fails is its own section's failure, and a standard section is byte-for-byte what
  it would have been without it.
- **Learning is on by default, bounded, and opt-out (1.8.9, ADR 0025).** The engineering observer
  runs from the hooks without being turned on, exactly as bounded as before -- a milestone only, at
  most four a session, debounced, and never stronger than `observed`; a person turns it off
  (`ORBIT_ENGINEERING_OBSERVE=off`, the `engineering_observe` setting), and `ORBIT_LEARN=off` and
  `ORBIT_WORKING_SET=off` still hold. The hooks observe only a checkout the machine KNOWS
  (`knownCheckout`: bound by a person's use of Orbit, a committed `ui-tests/`, or a directory named by
  `ORBIT_UI_TESTS`), so a repository opened with the plugin enabled is written about nowhere. A
  protocol-2 host's checkpoint is drained by a process of its own bound to its session
  (`skills/orbit-learn/hosts/drain.mjs`), never inside a hook's two seconds. A COMPLETED engineering
  task teaches from its own receipts through the same untrusted door (`src/engineering/observe/task.mjs`,
  operation `task:<id>`, so a replay adds nothing): its changed places and the DECLARED checks whose
  verification a succeeded receipt satisfies -- never a failure as before, never a reported action,
  and nothing at all from a task that did not complete. `src/engineering/` imports no task: the view
  is handed in by the CLI that saw the task end. `engineering doctor` is the reader of what a refusal
  or a failed hook left, and nothing about learning can fail a turn or change a command's answer.
- **A host's memory is a hint, never a truth.** It arrives through a provider (`{id, doc, recall}`)
  that lives outside `src/`, as SESSION claims: never written to the store, never certain, never
  above `host-memory`, and a need resting on one is never persisted as an opportunity. It TARGETS
  discovery -- the subjects a hint names join the question -- and a source claim always outranks it.
- **The session trail is metadata by allow-list, and a projection stores nothing.** Every event
  type declares its fields in `src/trace/events.mjs`; an undeclared field is dropped before the
  disk and dropped again when read. Never a prompt's text (a salted fingerprint and a length), a
  response, a model's reasoning, a transcript, a tool's input or output, an argument, a path or a
  file's contents; a Orbit subcommand only when that command's own usage header documents it. The
  views are pure folds rebuilt on every read, so `cli/trace.mjs` and Control cannot disagree.
  Writing is fail-open, bounded, local to the machine store, and switched by `trace` /
  `ORBIT_TRACE`.
- **What it takes to run a CHECKOUT is checkout-scoped, and understanding it executes nothing.** `src/runtime/`
  keeps facts per checkout (`<storeRoot>/checkouts/<checkoutId>/`) because a branch's manifest, a machine's tools
  and a held port differ per checkout; nothing checkout-varying is project-scoped, and nothing there is a second
  identity, a second ecosystem registry or a second way to start a child process. Discovery reads manifests
  (through the ecosystem registry), version files, container and dev container files, pipelines and build
  files, and runs none of them. It names no stack, product or vendor (a test greps it): what a requirement id
  means, a launcher, a service or a script is a row in `catalog/runtimes.json`, an adapter's `requires`, or a
  project's own data.
- **A command is launched only as a file declared it, as an argument list.** The tokenizer
  (`discover/commands.mjs`) refuses shell syntax and an environment prefix; a start goes through the Process port
  with the environment NAMES a person set; nothing a prompt, a body or a setting says is a command -- there is no
  `command` readiness probe, because a setting is a person's preference and a read of status must never run a
  program. A session receipt is written before the launch, so a start that dies is AMBIGUOUS and is never resent,
  and the look for what is running and the launch are one step taken in turn per checkout (`exclusive.mjs`). A
  sandbox's containers are a TOPOLOGY Runtime composed from those declarations (ADR 0039): a compose file is read and
  never run, every container is created from argv, labelled and receipted, and the topology runs autonomously in the
  task's own sandbox (0.2.0), its fingerprint kept as evidence of exactly what ran.
- **A checkout is untrusted data, and Orbit contains what it can make this machine do.** A tool's version is asked
  from a neutral directory (`src/tools/real.mjs`), never from inside the checkout; text that came from a file is made
  printable before a terminal sees it (`src/printable.mjs`); a reader is linear in what it reads and a scan reads at
  most `MAX_EVIDENCE_FILES` (`test/runtime-bounds.test.mjs`). Bringing a local environment up (`validate`,
  `prepare --apply`) is ordinary development and autonomous (0.2.0), like a task's own sandbox: what ran is
  fingerprinted, receipted and owned; nothing a checkout says becomes a shell line.
- **Orbit stops only what it can prove is its own, and never takes what is held.** Ownership is a receipt, a pid and
  the pid's start time in agreement (`OWNERSHIP`); a reused pid is observed, never touched. A port in use blocks
  the start and names its owner when known -- never freed, never moved, and REUSED only when a person turned
  reuse on and the readiness a person set answers there: then it is `EXTERNAL`, with no receipt and no pid, and
  nothing Orbit does signals it. Running is not ready, ready is not verified, and runtime records no verdict:
  `verification.mjs` projects what could be checked, and the investigation gate says only that nothing answers
  where an approved environment should.
- **A reach target is a person's, and a check knocks and reads nothing.** A target is a host and a port in a
  person's settings; the CLI and Control name it by ID and never bring a host, so a check cannot be turned into a
  way to probe an arbitrary machine. From this machine it is a name lookup and one TCP connect
  (`src/probe/reach.mjs`, never the loopback probe widened); from the container, a catalog program as a fixed
  argument list, nothing installed. Nothing is sent and nothing an answer says is read; `REACHABLE` is not a
  login. Retries are bounded by the saved policy and never run in the background; an answer older than five
  minutes is STALE and moves no plan. Orbit never touches a VPN, a route, DNS, a firewall or a container's
  networking. ONE scoped exception (ADR 0039): for a task's sandbox the isolation provider creates, attaches and
  removes an INTERNAL network of the task's own -- labelled with the checkout, the environment and the task,
  receipted before it exists, joined only by containers Runtime created, and removed only when its labels and receipt
  prove it Orbit's and nothing else is attached. A network Orbit did not create is never touched.
- **`src/runtime/writer.mjs` is the one module that writes a checkout outside `ui-tests/`: the PRIMARY_CHECKOUT_WRITE
  protected boundary.** `adopt` is DENY from every terminal and every agent, `--human` or not; only a person's own act
  crosses it, once, through Orbit Control's door (`crossing`, `src/protected/authorize.mjs`: a terminal cannot prove a
  person -- an agent can make a pseudo-terminal and knows every id it was shown) -- refused before anything is read
  otherwise. It writes a proposal's files while the
  understanding and the environment files are what it was made against (`STALE_PROPOSAL`), reads each back and verifies
  it (`ADOPT_UNVERIFIED` leaves the files as written), and a JSONC edit changes the keys it names while every other
  byte stays. A grep test holds the only-writer rule; a lifecycle hook or a compose file is never rewritten
  automatically (`UNSAFE`).
- **A sandbox never reuses a developer's application, and a developer never reuses a sandbox's.** A sandbox is an
  environment instance with an owner (`{kind: "task", id}`); its sessions carry that owner, the environment and the
  source tree they were built from, and a context sees only the sessions of its own scope (`ENV_SCOPE`: a person's
  runtime is every session no task owns). `reuseExternal` does not reach inside one (a provider that says
  `reuses: false` is never offered a holder), `stop` and `release` end only sessions whose ownership is proven, and
  a sandbox of one task is unknown to another (`test/runtime-sessions-scope.test.mjs`,
  `test/runtime-sandbox-ownership.test.mjs`). A teardown that cannot be proven leaves the sandbox QUARANTINED, never
  RELEASED, and only Control releases it. A sandbox's supervisor (ADR 0036) writes heartbeats, takes the signals the
  roots that own cancel hand it, enforces deadlines and stops only what ownership proves; it launches nothing and
  knows no transport.
- **A port is leased, never taken, and a component is told one only by evidence.** A lease is a receipt in the
  machine-global lease room, written before anything listens; a candidate something answers on is somebody's and is
  passed over; nothing frees, moves or signals a holder. A component is told its port by an override its project's
  own files declared or a person set (`portOverride`), never guessed; with none it keeps the port its files declare,
  and a held one is a BLOCKED start naming its holder (`test/runtime-sandbox-ports.test.mjs`).
- **A task's own sandbox is autonomous, and what it ran is evidence (0.2.0, ADR 0042).** Restoring a workspace's
  dependencies, bringing its container definition up and starting its isolated topology wait for nobody: each is
  fingerprinted by the whole SHA-256 of exactly what runs, taken again immediately before the run, and kept in the
  sandbox's receipts. A person's list of fingerprints (`sandbox.restore.trusted`, `sandbox.trustedDefinitions`,
  `isolation.trusted*`) is a REVIEW MARK those receipts name -- never a gate; the `trust` command that sets one refuses
  unless the context has `door: "control"` (`test/runtime-trust.test.mjs`). `restore.mode: manual` stays a person's
  opt-out. ONE technical rule keeps what runs on the HOST the developer's: a dev container definition whose host-side
  command (`initializeCommand`, outside any container) the task's workspace adds or changes against the developer's
  own checkout waits for a person's review mark on exactly that definition's fingerprint
  (`test/runtime-sandbox-devcontainer.test.mjs`); every other part of a definition runs inside the container.
- **An active generated test runs only where isolation is PROVEN (ADR 0038).** An isolation provider
  (`orbit.isolation-provider/v1`, Docker first) says what it proves, and the PROFILE is attested at prepare and again at
  every dispatch; a native process or a dev container proves nothing, and with no provider an active generated test is
  BLOCKED while discovery and validation go on. The worker never holds the store, a journal, the vault, a control
  socket or a home directory; a worker's claimed status is never taken: only the HOST, after validating its envelope
  (`src/run/envelope.mjs`: digests, attestation, files, status and `proved` re-derived from the frozen case), writes
  the ledger line, the evidence and the investigation's run line. A generated PAGE test drives a browser of its own in
  that worker (0.1.0): the host proposes what to wait for and read, the engine writes every script the page runs from
  templates that only read the DOM, and ONE engine-written route carries the approved identity's credential to the
  bound origin alone -- never along a redirect, never in an argument or a file the host reads back -- and lets a write
  through only under a page grant this run was minted (`src/qa/generation/page.mjs`, `src/run/worker.mjs`).
- **A test writes only through a grant (ADR 0037).** `mutates` does not imply destructive: a write, publish, enqueue,
  trigger, consume, settle (an ack or a commit), replay or workload control on a resource of the run's own fixture
  needs a grant the engine mints at dispatch through the ordered `MINT` rows (`src/runtime/sandbox/test-grants.mjs`)
  -- owned, isolated, the mode, the capability's declared effects, the fixture, indirect effects inside fixture
  sinks, a bound oracle and design, the allow-list, the budget, the tree, whatever a person narrowed -- and spends one use
  before the effect. Nothing an
  agent sends (a field, a flag, `--human`) mints one; a destructive test outside the fixture stays refused in every
  mode; a lost answer is read back, never resent, and an intentional duplicate or a replay is a grant of its own.
- **Live evidence names a source tree.** A sandbox session, a task's `sandbox` and `runtime` receipts and an
  investigation bound to a sandbox carry the `write-tree` id they ran on; a workspace that moved past it makes the
  sandbox STALE (derived on read, never written by whoever edited), the QA gate `RUNTIME_STALE` holds every browser
  action, and `currentRuntimeEvidence` says whether the evidence is current. Once a task links an
  investigation, the `LIVE` completion row refuses evidence that is stale or still pending
  (`test/orchestration-sandbox.test.mjs`, `test/autonomous-qa-sandbox.test.mjs`, `test/orchestration-tables.test.mjs`).
- **Declared is not required: a change is held to what it REACHES (ADR 0019).** `src/orchestration/impact.mjs`
  derives a change's reach from its paths (the plan's scope, then its own files) and the component graph runtime
  understanding read from the checkout's files (`dependency` facts: a unit named by path or by its own name, a
  shared file that reaches it). `obligations.mjs` turns that into the REQUIRED checks; every other declared check
  is NOT AFFECTED, NOT RUN, and never a pass. Unknown is never unrelated: an unresolved reference holds its
  component to its checks, no graph holds every component (WIDENED), and a path nothing holds or a changed
  component nothing tests is MISSING, which blocks completion. A failure is a regression unless its baseline (the
  last run before the code first changed) failed with the same signature, which makes it `failed-as-before`. That
  stays visible, is never a pass, and at least one required test or verify command must pass. A baseline is
  pinned to the base revision's own tree, "as before" compares the whole output (`exactOf`), never the
  coarse signature, a check counts only on the tree `record-changes` recorded (named before and
  after it runs, through a fresh temporary anchor git with no system, global or workspace
  configuration, and a change-time stamp an edit put back still moves), a run beside anything ignored is never a baseline, and a review fails on unrecorded edits. No row names a kind of
  task, a component name or a stack; the host reads the plan and never defines it (`test/orchestration-impact.test.mjs`).
- **The registry is membership by binding, and a page is told which checkout in its path.** A checkout is known
  because Orbit was used from it; nothing scans a directory. Control's runtime routes take project and checkout from
  the path and never from a body, and a settings write names the revision it read.
- **Zero dependencies.** `package.json` has none and stays that way. Node ≥ 20 built-ins only.
- **Five Lines of Code**, checked structurally: a function body has ≤ 5 statements, no `else`,
  no `switch`, 30 is a hard ceiling. `node cli/check-five-lines.mjs src cli skills --strict` must print
  `0 finding(s)`; `test/lint.test.mjs` runs the same check, so a violation fails the suite.
  Write one statement per line (the counter treats `a(); b();` as two). When a function grows,
  extract a named function that says *what*, never add a branch.
- **The vocabulary is data.** A verb exists in exactly two places: a row in
  `src/dsl/core/verbs.mjs` and a file in `src/run/verbs/`. The registry refuses the registration
  if the two disagree — including when a row offers `into` and the verb file has no `capture()` —
  and `agree()` refuses a vocabulary holding a verb nothing can run. Fields exist once, in
  `src/dsl/core/fields.mjs`, with the sentence the editor will show and the `esc` language its
  value is read as. Everything else — the editor schema, unknown-field and misplaced-field rules, per-verb
  `needs`, interpolation, escaping — is derived. Never hand-edit a generated `schema.json`.
- **No file may enumerate verbs.** `ACTS.has(st.do) && st.do !== "goto"` and
  `new Set([...ACTS, "as"])` were lists pretending to be concepts, and a new verb would have
  slipped past both. What a verb DOES to the run around it is a column — `changes`, `navigates`,
  `requests: "mark" | "since"` — and callers ask `verbsWhere("changes")`. Behaviour keyed by verb
  goes on the verb: `plan` (resolve from the map before the run), `after` (what the run keeps),
  `stops` (this result ends the case), `capture` (turn the result into one bound value),
  `proves` (which of ui/api/sql this verdict rules on — `provedBy(step)`, `LAYERS`). The one
  allowed exception is a **rule naming its own subject** — `dsl/rules/` is the Specification
  pattern, and "a click with no wait after it" is what that rule is.
- **Every port has a fake.** A new method on `createBrowser()` gets the same method on
  `test/fakes/browser.mjs` in the same change, or the runner tests stop meaning anything.
- **Outcomes are typed.** `StepError` = FAIL (1), `Refused` = REFUSED (2), `Blocked` = BLOCKED (3).
  A step throws one of these or nothing; `cli/` maps them to exit codes once. A database that
  cannot be reached is *Blocked*, never *StepError* — the product is not broken because a laptop
  is off the VPN, and neither is it broken because a child process had to be killed or the run
  deadline was spent. A `Refused` raised **mid-run** stays REFUSED: the same condition cannot mean
  two things depending on whether a gate or a step noticed it.
- **PASS is earned, not defaulted.** `src/run/status.mjs` decides the final word: no verdict
  executed ⇒ `INCONCLUSIVE` (4), a `--from`/`--to` slice ⇒ `PARTIAL` (0). Never widen what PASS
  covers — it is the one word that means *this case was verified*. It also has to SAY what it
  proved: the run tallies verdicts per layer and the RESULT line, the `--json`, the ledger and the
  report all carry `proved ui n · api n · sql n`. A count could not tell three asserts on one
  screen from the screen, the call and the row.
- **A constraint is declared once and enforced from the declaration.** A field's type, enum,
  pattern or minimum lives in its row in `dsl/fields.mjs`; `dsl/schema.mjs` publishes it and
  `src/constraints.mjs` enforces it. Never hand-write a rule for something a row already says.
- **A case that writes must be witnessed below the screen.** A screen can show a write that never
  happened — an optimistic render, a cached list. So a case declaring `creates` and ruling only
  on the screen is a finding, and the layers it owes are derived (`LAYERS` minus `SCREEN_LAYER`),
  never a list of verb names. The map is held against it too: `graph/effects.json` already records
  the call a control makes and the table it writes, so a case re-typing that can re-type it wrong.
  The map says which table, the case says which row — a predicate is never guessed.
- **A plan verdict is not a runner verdict, and neither is a coverage number.** `src/qa/` may
  report only what it can DEMONSTRATE as an error; everything else is advice and cannot change an
  exit code, and what it cannot tell is `unknown` and counted as neither. Exactly one row in
  `RUN_STATES` says `verifies`, and it is PASS -- SKIP, PARTIAL, REFUSED, BLOCKED and
  INCONCLUSIVE never raise coverage, nor does a PASS whose build, environment or plan revision no
  longer matches. An empty scope reports `—`, never 100%. Which layers a plan may speak about
  comes from `LAYERS`, so nothing in `src/qa/` names a layer.
- **A map record is corrected, never re-recorded.** `record-edge.mjs --replace` is the inverse of the
  append: the key must already exist, only the fields the line carries are touched, and the record
  keeps its place in the file. A note somebody wrote at 2am and a `destructive` guard are not
  collateral. `seen: "live"` in a correction must bring its own `fe_commit`, because the record's
  old one pins the old observation. Hand-editing `graph/edges.json` skips the `check` and the
  rollback, and is how a map ends up with a dangling `to` nobody can date.
- **A timeout is not a diagnosis.** `src/query/triage.mjs` may print only what the log
  DEMONSTRATES; everything else is a named hypothesis with the command that settles it, and what
  no command settles is said out loud. A spent wait is equally consistent with a drifted record,
  a product that never reached that state, and a wait asking the wrong question — and only
  `query verify` may promote one of those to a cause. Nothing in `src/query/triage.mjs` decides a
  verdict, and nothing in it names a verb.
- **A cause is not a verdict, and a low confidence routes nowhere.** `src/query/classify.mjs` is
  an ordered table over facts a caller can DEMONSTRATE — never over the text of an error message.
  The field that makes that possible is `phase` (`bind` · `act` · `wait`), recorded by whoever
  threw: a browser command that failed is news about the locator, a spent wait is news about the
  product reaching a state. A log that predates `phase` reports `null` and classifies UNKNOWN —
  **never** a guessed `act`, which would read every historical timeout as a drifted record.
  `confidence` is two-valued, and `high` is the only one that may carry a `handoff`: a specialist
  given an uncertain classification repairs the wrong artifact and then reports a fix. `UNKNOWN`
  is a correct answer, and the table's last row always matches.
- **A map record is REPLACED field by field, never re-recorded.** `record-edge.mjs --replace`
  touches only the fields each line names, so a locator repair cannot drop a `destructive` guard,
  a combobox's `options`, or the note somebody wrote at 2am. Same `check`, same rollback, and the
  record keeps its position in the file.
- **A PROVIDER IS NOT A VERB.** A verb is grammar: the set of them shapes every case, every
  report column and every coverage denominator, so it has grown once in five releases. A provider
  is a thing you can ask. So `postgres`, `redis`, `msgraph` and everything like them are
  CAPABILITIES behind the one `call` verb, registered by a project from OUTSIDE this repo -- or
  shipped by Orbit as a PACK that stays inert until a project opts in by id (`project.json` `packs`,
  ADR 0034) -- and a row here naming one would be a product learned. Providers grow; the grammar does not.
- **A technology is an adapter's to know, and the engine reasons only over what an adapter DECLARES
  (ADR 0035).** A broker, a scheduler, a store or an identity system is reached through a family
  operation (`orbit.<family>.<op>`) whose adapter (`orbit.adapter/v1`, a helper in any language, using
  the technology's own SDK, CLI or API) is chosen at run time by what discovery found and the
  semantics the adapter declared; `unknown` is a legal semantics value that switches off what needs
  it. No adapter is a boundary-scoped CAPABILITY_MISSING gap and one knowledge opportunity -- never a
  fallback to another transport, an emulator or a fake -- and `supported` is COMPUTED from
  declarations and conformance-kit receipts, never written in a file. Nothing under `src/adapters/`,
  `src/topology/` or the new `src/qa/` subjects names a product, a transport's vendor or an example
  project (`test/backend-neutral.test.mjs`).
- **A project extends Orbit through its current contract.** Project extensions live outside repositories.
  `orbit.extension/v2` is the sole accepted manifest API. The loader validates default exports directly,
  before registration. Capabilities explicitly declare `orbit.capability/v1`. No adapter converts older
  manifests, module shapes or identifiers. A changed contract receives a new explicit version and its
  producers, consumers and current fixtures change together.
- **Generated executable code is a trust boundary, and the boundary is a FACADE.** A capability
  is handed `src/extensions/context-v1.mjs` and nothing else — seven surfaces, and the absences
  are the argument: no memory store, no ledger, no identity, no `process.env`, no graph, no run
  object, and no way to write a binding or a verdict. A capability that could write the ledger
  could write a PASS. It observes and reports; `expect` in the case rules. Nothing it can reach
  spawns through a shell, so a value containing `;` is an argument and never a second command.
  A GENERATED predicate is compiled and interpreted (`src/run/evaluator.mjs`, ADR 0038) and is never
  handed to `new Function` in a process that writes an authoritative record: there it could reach
  `process.getBuiltinModule` and `import()`, which is the whole host.
- **A candidate is held to the contract BEFORE it is trusted, by the same loader.** There is no
  validation mode: `verifyTool` loads it for real into a throwaway context. A `draft` is never
  loaded, so something generated and unproved is inert rather than quietly live, and
  `registerTool` refuses anything that did not verify. A capability's own crash is BLOCKED, never
  FAIL — a generated tool's bug must never ship as a defect in somebody's feature.
- **No speculative code.** A verb, field, flag or adapter needs a real case that needs it today.
- **A concrete tool lives in `skills/`, never in `src/`.** When a real adapter is worth shipping
  (`skills/orbit-sql`: SQL Server via sqlcmd), it is a command a project opts into through
  `project.json`, with its own `ORBIT_<TOOL>_*` variables. `src/` keeps knowing only "a command".
  The Five Lines check and the suite cover `skills/` too — shipped code is code. A shipped capability
  PACK (ADR 0034) lives there too: loaded in place by the same loader and contract, only for a project
  whose `packs` lists it, and `orbit.*` ids belong to the engine and its packs alone.
- **The entry points live in `cli/`, and there is no top-level `bin/`.** A hosted plugin archive
  is **rejected at upload** for one: the CLI would put that directory on PATH, while the approval
  surface a team's admin reads never mentions it, so the host refuses to be what adds it. Every
  command is `node <plugin>/cli/<tool>.mjs`, invoked by path and never by name, and `ship.mjs`
  gates the layout — the alternative is learning it from a failed release. The same gate reads
  every `SKILL.md` and `agents/*.md` **description**: one containing `<angle brackets>` reads as
  XML and is refused. A placeholder belongs in `argument-hint`, which no host parses. A third rule
  joined them the same expensive way: a **symlink** anywhere in the zip is refused whatever it
  points at, and this repo keeps one on purpose (`.agents/cli`, for Antigravity), so `.gitattributes`
  `export-ignore`s it and the gate asks whether a TRACKED symlink would reach the archive —
  which is why the archive is built with `git archive` and never by zipping a directory.
- **Memory first, and a scan is the exception.** `architecture ensure` decides whether the
  repository has to be read at all, and the normal answer is CURRENT: a few git calls, no
  listing and no file read. A scan happens when nothing has been learned, when a scope some
  fact depends on moved, or when the task names a capability nobody has asked about — and the
  decision is PRINTED, because a tool that decides silently cannot be audited. Freshness is
  keyed to a fact's own SCOPE, never to HEAD: keying it to the commit would make every fact
  stale on every push, and a tool whose answer is always "re-do everything" is one people
  learn to ignore. `stale` means needs revalidation and never means false; an uncommitted edit
  the index cannot see is `unknown`, which is neither.
- **Test data has one home and all generated state is store-only.** Read and write the selected dataRoot.
  Nothing automatically replicates a checkout write. The store never goes into a working tree, including a
  gitignored directory. A typed store path that fails is Refused; an unwritable default is Blocked.
  Two independent sessions earn a lesson; one is an observation. Independence is `(host, UTC date)` from
  `src/memory/session.mjs`. `pickRun` allow-lists evidence and `quote()` bounds free text.
- **Security.** No password is ever read, stored or passed. Only token *claims* are logged, never
  a token string. SQL is read-only (`SELECT`/`WITH` only, enforced by a rule). Profiles and
  anything with cookies live outside any repo. The memory store (`src/memory/`) is the opposite —
  the run ledger and the notes, and leaving the repository did NOT make them private: its contents
  can be recalled into a session, quoted into a lesson's evidence, and rendered into a
  report that gets mailed. So both of its doors — `recordRun` and `makeNote` — pass through
  `src/scrub.mjs`, which masks
  by SHAPE and never by name: `TARGET_UPN` is a word this engine must not know, while "what a
  UPN looks like" needs no product knowledge. What is masked is declared once, in `FREE_TEXT`,
  and it is the same list `learn/evidence.mjs` refuses to READ — one declaration, both doors.
  Structural fields are deliberately left alone: mask `fe_commit` and coverage can no longer
  tell a current PASS from a stale one.
- **A REPORT is written into the store, and it is self-contained.** A run's
  report goes under `<store>/reports/<screen>/<case>/`, a page about many runs into `_screens/`,
  `_plans/`, `_sessions/` or `_investigations/` (`REPORT_ROOMS`, `src/tests-tree.mjs`). Every
  picture is a base64 `data:` URI and the case's own JSON travels with it, so it cites nothing
  beside it: `run-case <that-report.html>` runs the case again when the file is gone
  (`src/case-block.mjs` is the one escaping table both the writer and the reader share). That is
  also what makes evidence DISPOSABLE — `retention` prunes the room, keeping the last N per case
  and always the newest run that did not exit 0. An HTML file existing is not sufficient:
  only complete exports whose metadata matches the recorded run qualify; active runs never do. `reports` defaults to
  `<store>/reports/` for layout 3, shared by every checkout of the repository the way the ledger
  it cites is . A report is generated, so it is never committed: it
  would publish the tenant's screenshots as text, and a `.gitignore` line makes files invisible,
  not absent. A project may still point `reports` into its checkout; it is explicitly configured,
  and `query check` advises against it.
- **A report shows an ALLOW-LIST and masks the rest.** run-log.jsonl is raw — it is the run
  talking to itself, inside the store — and the rendering is where that stops. `STRUCTURAL` in
  `src/report/model.mjs` is what a reader needs to NAVIGATE a run and nothing a product typed;
  everything else goes through `src/scrub.mjs`. Inverted for the reason `pickRun` is
  (`AGENTS.md` already gives it): `loop.mjs asked()` logs EVERY declared field of a step with its
  `${PARAM}`s filled in, so a deny-list would fall behind the day `dsl/fields.mjs` gains a row
  and **nothing here would fail**. A list of what to hide is a list pretending to be a concept.
  `VERBATIM` is the two disclosures made ON PURPOSE, at any depth and asserted by name in
  `test/security.test.mjs`: the SQL and the line that repeats it, because a masked query is one
  nobody can run, and the case JSON, because a masked case is one that runs a different test. The
  page says so, next to the query.
- **A plan works out its own security obligations.** `src/qa/rules/security.mjs` derives them
  from what a plan already declares — roles, an owner or a tenant, a write — and `owedBy` on a
  technique's row says which signals it discharges. Advice, never an error: it can demonstrate
  nobody considered the question, never that they were wrong not to.
- **Standards and policies are a person's sources, configured in Orbit Control (ADR 0040).** A
  security catalog (`orbit.control-catalog/v1`) is added by URL or file, fetched, previewed and
  ADOPTED with its digest pinned, or written in Control's editor, and enabled per project -- as many
  as a person wants; budgets, limits and vocabulary layers are set the same way, through Control's
  door and naming the revision read. Orbit ships defaults as DATA (ASVS 5.0.0 L1 with OWASP Top 10
  2025 and API Security Top 10 2023 as labels; ids, links and Orbit's own summaries, never a
  standard's text). No agent or CLI fetches or edits a catalog; an assessment pins the catalog it
  used, a change makes what was derived from the old one STALE, and nothing is ever called
  "compliant".
- **The host reasons; the engine keeps the state, and a decision carries no verdict.** An
  investigation's loop is the host's choice of ONE next step, sent as a decision
  (`src/investigation/decision.mjs`) the engine judges before anything runs. The decision's
  `verdict`, `outcome`, `confidence`, `authority`, `approved`, `oracle`, `status` and `severity`
  fields are refused by name. Its `hypothesis` and `reason` are short, scrubbed and never a chain
  of thought. Every action is an EXISTING gated operation named in `ACTIONS`, never a command
  string. What is still owed, why to stop and what a finding concludes are DERIVED from the
  journal on every read. A decision that started a write and never settled is `AMBIGUOUS`: it is
  read back, never resent, and only a person releases it. A requirement from a draft source (a
  PBI nobody accepted, a plan an agent wrote) prepares tests and never confirms a defect. A
  receipt reaches knowledge only against an ACCEPTED oracle, through `judgeStamped` and `ingest`,
  under the receipt's own session, so a replay adds no support.
- **A requirement is what a requirement's own source says, and nothing built ever says it.** A
  source kind carries `authorityBearing`; a work item, its criteria, its discussion and a document a
  person named do, and a pull request, a commit, a test and the code do not. `requirements record`
  refuses any other citation, and a `work:` reference by name. What the product does today is how it
  was BUILT, never what it should do: a playbook never reads code, a screen or data to fill an
  unknown, it asks. `decided` is a person's and `unknown`, `conflict` and `superseded` are the
  engine's, so a candidate carrying one is refused. Authority (accepted or draft) and clarity
  (complete, partial or blocked) are derived on every read and are two different things.
- **A roundtable proposes, challenges and decides nothing.** The engine calls no model: a host's model
  reviews, and the engine keeps the state -- a round is two journal lines (`reviewed`, `round-closed`)
  and a fold, tied to the digest of the requirement state it reviewed AND the one it left behind
  (asking stands unknown facts, which is itself a change of state). A hand-in is judged whole and
  refused whole, naming an answer, a decision, authority, a field the engine stamps and a reasoning
  trace, and what is retained reaches the room only through `ingest.mjs ask`: nothing under
  `src/requirements/roundtable/` writes a fact, a question or a decision, and a test greps for it. Which
  questions a person is asked is never what makes anything true: only `answer --human` does.
- **A source record keeps what an item WAS, never what it said.** Identity, revision, digest, whose
  word, when, state and relations as references. The text is handed to the caller once as an
  untrusted envelope, scrubbed and bounded, and is never stored, logged, traced or reported.
  Content that moved without a new revision is an `anomaly`, and nothing standing changes.
- **A work names capabilities, and a provider is a binding.** A need holds a capability word, never a
  server, a tool or a URL. Which provider serves it is written by the resolver knowledge already
  uses, as its kind AND key (a skill and an agent of one plugin share a key) with a fingerprint of
  what made it eligible. A moved binding is resolved again and the need is unchanged. A gap is one
  knowledge opportunity, and nothing is installed, enabled or generated.
- **A provider is asked through the gates that exist, and a receipt keeps digests.** A managed
  server only through the MCP broker, a project's capability only through the capability pipeline
  with no page, and a host's server never. A receipt holds the need, the provider, the tool, a
  digest of what was asked, a digest of what came back, the references the answer named and how it
  ended; the answer is printed once, scrubbed and bounded. `work-receipt` is a stamped knowledge
  source: never verified, never typed in, an observation only when the answer named its source.
- **A person's word is relayed, never invented.** `answer`, `withdraw`, `bind` and `accept` take
  `--human`. An answered question reopens only when a LATER revision of a source it depends on says
  something different about its slots -- asking it again changes nothing, for an answered or a
  withdrawn one -- and a work adopts a newer snapshot only by a choice.
- **An orchestrator decides the next step; it owns no lifecycle, and it never asserts success.**
  `src/orchestration/` writes only through the task's one door and reads only the task's fold: no
  second journal, no state a page could disagree with. A host's decision is judged before anything
  runs (refused by name if it asserts an outcome, a stage, a signature, a confidence or an approval;
  STALE on a moved revision), recorded before its side effect, and settled with receipts; the engine
  moves the stage, classifies and signs a failure, concludes NO_PROGRESS (three attempts on one
  signature) and completes a task only when every COMPLETION row holds. A change is made only in the
  task's OWN workspace -- a local clone, owner written first, detached, no hook run -- and the
  primary checkout is never written, not even its `.git`. A check is a command the checkout DECLARED, `safe`, chosen by
  id and run argv-only; nothing a model writes becomes a command, and there is no command endpoint.
  An action that never settled is read back by `reconcile`, never re-sent. Only a person grants an
  approval or resumes a paused task (the orchestrator's task context has no door); a cancel makes it
  ask runtime to stop only the sessions this task started. A verified change is committed autonomously (`commit`);
  that exact commit is pushed only through the GIT_PUSH protected boundary (`push`, approved once in Control, to the
  URL the checkout names -- a workspace keeps no `origin`); it never merges (`NOT_ORCHESTRATION`). Neither goes through
  the workspace's own `.git`, which is the task's to write: the commit is made in a bare git directory beside the tree
  that only the clone port writes, and the push from one made for that push alone (`src/frontend/local-clones.mjs`, THE
  DELIVERY), so a hook, a rewritten URL or a `.git` naming the checkout cannot move either.
- **Live is delivery, never state (ADR 0015).** A page follows the journals the engine already keeps; nothing in Orbit
  Live writes a line anywhere -- an orchestrator's decision is STALE on ANY line after the revision it read, so QA
  activity is never written into a task's journal. Every line is numbered with its store's own keep-rule, so a live
  page and a reload agree; a stream is a GET that never mutates and refuses before any header; a heartbeat is an
  event; what an investigation shows a page is an allow-list a test holds whole; a sandbox log is read only through
  the runtime's command after the ownership chain, and a read from an offset masks the WHOLE log first (`scrubLines`
  keeps line ends, so a piece is a slice of the whole-log mask) and holds back a quoted secret value still open
  (`openSecretLine`): a piece never shows what the whole-log read masks. `run-log.jsonl` keeps its one reader: a run-case case is one unit
  in the feed. The LIVE pulse says the page's connection is healthy, never that a task runs.
- **A running check is observed beside the task, never in it, and an observation is never a verdict (ADR 0020).**
  With an observer bound, the check runner hands every chunk to it as it arrives (`runObserved`: run()'s answer to the
  byte) and what it reads goes to `orchestration/<task>/activity/<act>.jsonl` -- allow-listed lines with a sequence,
  authority `observation`, bounded per action and per task with the end always written. Nothing reads it to move a
  task: the receipt, the verification rows and failed-as-before are decided on the same output as before, because an
  adapter READS what the declared command prints and adds no argument, variable or reporter. A protocol's adapter
  lives in `src/orchestration/activity/`, a stack's in `skills/orbit-engineer/observers/`; each says what
  it can show, and a total is shown only when a runner said it (`test/orchestration-activity.test.mjs` holds the
  journal byte for byte with and without an observer; `test/activity-vertical-slice.test.mjs` a case delivered before
  the child exits).
- **Orbit opens a viewer by itself only through the session's lease, and opening one grants nothing (ADR 0020).**
  `live ensure` is the one launcher: `src/live/ensure.mjs` POLICY says why nothing opens (a person's switches first,
  then the host's own word that a person is at the session, never a guess from a terminal), the lease (one per host ·
  session · checkout, reserved under a lock) says whether to reuse, offer, wait or open, and only the viewer's own
  `ready` makes it OPENED. A viewer writes only its own lease; a workflow's ask never brings back a viewer a person
  closed (`test/live-ensure.test.mjs`, `test/live-ensure-cli.test.mjs`). A pane a HOST docks (`live pane`, drawn by
  the plugin's Claude Code pane module `hooks/live-pane.tsx`) is a viewer like any other: it holds the same lease only while it is drawn,
  honours the person's switches and nothing else (`--auto` writes nothing), and whether anything here could OPEN a
  viewer is asked only when one would be opened, so an attached pane is ALREADY_ATTACHED in any terminal
  (`test/live-pane.test.mjs`).
- **The right side is a viewer beside the AI CLI, never in it (ADR 0021).** It never draws in the CLI's terminal, reads
  its input or takes its keyboard, and nothing about the execution is its to own. It opens on the right where the
  terminal can (an `OPENERS` row: tmux, Windows Terminal through a launcher in the store, iTerm2, a window said to be
  one, else printed), at the share a person set (`pane.widthPercent`), with the keyboard handed back
  (`pane.focusCli`). VS Code is reached only through the companion a person installs (`integrations/vscode-orbit-live`):
  Orbit leaves a request in its store, and the companion splits the asking terminal and runs Orbit's viewer and
  nothing else. What runs is the companion's choice, never the request's, because an agent runs as the person and
  can write their files from inside its sandbox, so owning a file proves nothing: `node` only as the person named it
  (`orbit.live.nodePath`, no PATH search), and only the `cli/live.mjs` of a Orbit install inside a host's own plugin
  folder in their home, the whole install and the folders above it nobody else's to write. Requests come only from
  their own stores (machine-scoped settings, a workspace's value ignored), from a room and a file of theirs nobody
  else may write (never through a link, checked and read through one descriptor), and speak only for the store they
  were left in; a request from the future or with a chain longer than 32 is refused. No environment variable makes a headless run interactive. The workspace pane
  (`src/live/tui/workspace.mjs`) draws only steps a journal recorded, in seven status words that each need their
  evidence, and a runner that aborted before any case is BLOCKED, never a pass (`test/live-workspace.test.mjs`,
  `test/vscode-companion.test.mjs`, `test/live-open.test.mjs`).
- **A viewer reads the journals, and Control is one viewer (ADR 0016).** Orbit Live's core (`src/live/`) is what Orbit
  Control streams, a terminal's `live watch` paints and Claude Code's status line prints once and exits: one feed, one
  cursor, one fold, so a page and a terminal on one journal agree on every line. No viewer writes a journal, approves,
  resumes, cancels, stops a sandbox or runs anything; the only writes are a person's preferences (a pin, how Live
  looks) and, with `--human`, ONE owned key in their own Claude Code settings -- a status line they already have is
  refused unless they replace it (it returns on remove) or keep it. Which task a viewer shows is a TABLE
  (`src/live/association.mjs`): a task is this session's only when its journal says so (`created.session`, the mark
  the session start exports), and two candidates are AMBIGUOUS, never the newest on the machine. A viewer's own
  state (LIVE, IDLE, DEGRADED ...) is never the task's lifecycle, and a tick or a refresh is never progress: LIVE needs
  EVIDENCE the task moved -- a running action, a journal line or a running check's observation, written lately -- and
  the LIVE pulse's phase is the newest evidence's, never the clock that redraws (ADR 0022). Since 0.0.1 a terminal and a
  docked pane SAY that state as ORBITING (the key stays LIVE). The header's orbit, which replaced the starship lane, is
  the VIEWER's motion and never the task's (ADR 0029): it turns the whole time a viewer is open, in every state, on the
  viewer's own monotonic clock -- never `nowMs`, never evidence -- still only for `pane.animation: off`; the indicator,
  a lifecycle and a count are the same at every moment of it, and a tick draws the orbit's rows alone
  (`test/live-orbit.test.mjs`, `test/live-tui-pty.test.mjs`). Every viewer draws ONE view
  model (`src/live/tui/pane.mjs`): a host's docked pane and the terminal's pane layout alike; a host with no pane API
  says so in a surface matrix and never gets a dock it does not have (`test/live-pane2.test.mjs`,
  `test/live-hosts.test.mjs`). Every
  string from a journal passes `printable()` before `src/live/render/ansi.mjs`, the one emitter of escape sequences
  (`test/live-core.test.mjs`, `test/live-render.test.mjs`).
- **Automation is current and autonomous by default.** Schema 3 settings contain only the declared limits,
  execution preferences and display settings. Removed switches and unsupported schemas are refused. There is
  no migration or lift operation. Action classes, resource verdicts, owner gates and Control approvals still
  govern each action. Machine and project limits only narrow each other.
- **A coordinator dispatches to owners and proves nothing itself (ADR 0017).** `orbit-help` is the ENTRY point of a
  coordinated workflow and nothing more: for a task a workflow fits it starts one by default, for anything else it is
  the navigator it always was, and a manual `orbit-*` skill never starts one. The engineering task a workflow starts
  names it as its `parent`; the link decides nothing. A coordinated workflow is a task of its own whose every step is an OWNER's -- a frozen
  requirement read back, runtime understanding, an engineering task started through autonomous engineering's own `start`,
  an investigation, a project playbook -- and a step is settled only on that owner's record, and only on this workflow's
  own (`src/automation/evidence.mjs`): a host's `executionState` is a report, and a word the engine derives is refused by
  name. Its facts live in its own journal, never the engineering task's (whose loop would refuse them); a plan is an
  artifact named by a receipt, never a state. The engine calls no model and runs no command line; the limits it is
  held to are a person's, set only through Orbit Control's door (`src/automation/settings.mjs`), narrowed machine →
  project, and never wider than a resource's own verdict. It never cancels the engineering task it started -- a person does
  (`test/automation-loop.test.mjs`, `test/automation-vocab.test.mjs`).
- **A plan is a graph the tables draw, and it is revised only on evidence (ADR 0022).** A coordinated workflow's plan
  says what each step waits for from `DEPENDS` (`src/automation/graph.mjs`), never from an edge a model drew; steps that
  wait for nothing in common are ready together, the host picks one, and a workflow still runs ONE step at a time. A
  plan is REVISED only by a row of `TRIGGERS` (`src/automation/replan.mjs`) over what a journal or an owner shows -- a
  playbook step nothing provides once a person lets the factory close the gap, a requirement that moved, discovery
  finding something to start, a failure -- bounded by `execution.maxReplans`, each revision a new artifact naming the
  one it replaced and why, no receipt rewritten. A trigger past its budget answers BUDGET_EXHAUSTED with its fallback
  and never builds on a requirement that moved. There is no "new evidence" trigger: the engine calls no model
  (`test/automation-graph.test.mjs`, `test/automation-replan.test.mjs`).
- **A tracked work is identity, links and what was reported; its evidence is read back from the owners (1.8.8).**
  `src/work/track/` follows ONE request from `/orbit-help` through the host (`developer`) or an engineering task or
  workflow (`autonomous`) to what it came to, in the work journal and nowhere else: five kinds of line (`bound`,
  `handoff`, `linked`, `state`, `report`), each allow-listed, scrubbed and safe to repeat (an `eid` is folded once; a
  closed work moves only on an explicit reopening, so a late line changes nothing). It creates no task, sandbox or
  workflow, and grants nothing; a `/orbit-help` with no concrete task creates no work; a task that
  starts beside no tracked work creates none; and tracking never blocks the work it sits beside. Which work a request
  is comes from `--continue`, `--ref`, or the session mark, the checkout, the request's digest and a generation --
  never from a title alone, so two sessions never merge. What a task did, which verdict a check earned and what was
  changed stay with their owners and are READ BACK on every view (`workViewOf`, the one read model Live, the terminal
  and Control share): lifecycle, evidence (`none` < `observed` < `reported` < `verified`) and liveness are three axes,
  never one word, and `verified` is only a completed linked task's, lost the moment an edit is observed after it. Files
  are the paths an edit tool was seen writing, inside the intervals a session was bound -- never the checkout's dirty
  files -- and a check is a command NAMED like one with how it ended, never "passed". `src/work/track/` imports no task, no
  live core and no host: the roots bind them (`test/work-track-boundary.test.mjs`).
- **A task is a journal, its state is derived, and a person's decision names the revision it read.**
  A task (src/task/) is one execution of a work, never the work: its lifecycle, stage, attempt and
  stop reason are read off ONE fold every time, and nothing mutable is kept beside the journal. The
  session trail may carry four ids-only moments of it and is never read back. A decision records
  observed, hypothesis, next action and evidence -- never a prompt, a response or a chain of thought
  -- and an action with no receipt shows as reported, never as proven; `satisfied` and `violated`
  need a linked receipt. An approval binds a FINGERPRINT of one action (its params hashed, never
  kept), is decided once by a person, spent once (consumed before the action starts) and never
  becomes a standing permission. A decision that ALLOWS something (approve, resume: `grants` on its
  OPS row) is written only through a door that proves a person -- Orbit Control, after its mutation
  token, sets `door: "control"` on the task context -- because a terminal cannot prove who typed
  `--human`, and an agent could approve its own action; from a terminal a person only stops work
  (pause, cancel, reject). A person's pause, resume, cancel, approve or reject on a
  task that MATERIALLY moved since the revision they read is refused (`STALE_REVISION`), never
  retried; `material` is a column on the journal's kinds. Pausing interrupts nothing and cancelling
  stops no process: how something already running ended is always recorded. The machine-wide view
  is a projection over the registry and the task rooms -- no scan, no index, no write.

## How to extend

The table of every kind of change -- a verb, a field, a rule, a section of Live, a key of the full-screen viewer, a
provider, a gate -- with what to touch and the test that proves it is
[docs/agents/extend.md](docs/agents/extend.md). Find your change's row there before you write it; a change with no
row is a design question to raise, not a place to improvise.

## Commands

```bash
node --test                                                  # the suite; no browser, no network, no sleeps
node cli/check-five-lines.mjs src cli skills --strict         # structural Five Lines check
ORBIT_UI_TESTS=test/fixtures/ui-tests node cli/query.mjs check  # must stay clean AND exit 0 (it exits 1 on findings)
ORBIT_UI_TESTS=test/fixtures/ui-tests node cli/query.mjs dsl           # the vocabulary, summarised
ORBIT_UI_TESTS=test/fixtures/ui-tests node cli/query.mjs verb sql      # one verb's whole contract
ORBIT_UI_TESTS=test/fixtures/ui-tests node cli/query.mjs field into    # one field, and who allows it
ORBIT_UI_TESTS=test/fixtures/ui-tests node cli/query.mjs triage [--json]  # one run: bands + a class
ORBIT_UI_TESTS=test/fixtures/ui-tests node cli/plan-check.mjs   # the plans: 0 clean · 1 errors · 2 no such plan
node cli/query.mjs doctor                                    # are this project's declared tools usable here?
node cli/setup.mjs --install                                 # install the ones that have a package name
ORBIT_UI_TESTS=test/fixtures/ui-tests node cli/run-case.mjs create-thing NAME=TC-1 --dry
node cli/run-case.mjs <a-report.html> NAME=TC-1   # re-run a case from the report that ran it
# NB: EVERYTHING writes to ~/.orbit by default — one store, six rooms. Always set
# ORBIT_STORE_DIR when trying any of these here; it relocates all of it. (A run against
# test/fixtures/ui-tests no longer touches a committed fixture: the ledger left the repo in 1.4.2.)
ORBIT_STORE_DIR=/tmp/l node cli/learn.mjs where|lessons|analyse   # the lessons (README §4.3)
ORBIT_STORE_DIR=/tmp/l node cli/architecture.mjs ensure           # decide, and say why (README §4.4)
ORBIT_STORE_DIR=/tmp/l node cli/architecture.mjs ensure --for="… through Acme Vault"  # a capability question
ORBIT_STORE_DIR=/tmp/l node cli/architecture.mjs facts|why <id>|capabilities|diff|where
ORBIT_STORE_DIR=/tmp/l node cli/engineering.mjs facts|why <id>|where     # how this project builds code (README §4.6)
ORBIT_STORE_DIR=/tmp/l node cli/engineering.mjs record [<file>] [--human]  # validated candidates only
ORBIT_STORE_DIR=/tmp/l node cli/intelligence.mjs ensure [--for="…"]   # which technologies, what each is used for (README §4.7)
ORBIT_STORE_DIR=/tmp/l node cli/intelligence.mjs technologies|integrations|wiring|dependencies|why <id>
ORBIT_STORE_DIR=/tmp/l node cli/intelligence.mjs resolve <intent> [--json]   # reuse · build · unknown · blocked
ORBIT_UI_TESTS=test/fixtures/ui-tests ORBIT_STORE_DIR=/tmp/l node cli/help.mjs  # where to start, and why (README §4.5)
node cli/record-edge.mjs <p.jsonl> [--replace] [--dry]       # append new controls · --replace edits in place
ORBIT_STORE_DIR=/tmp/l node cli/storage.mjs where|import [--apply]|export (--all|--screen=…|--case=…|--plan=…) [--apply --human]   # where test data lives; a person moves it
ORBIT_STORE_DIR=/tmp/l node cli/engineering.mjs doctor [--json]   # is the observer on here, has it run, what stopped it
node cli/report.mjs [<evidence-dir>]                         # that run as report.html, into reports/
node cli/report.mjs --screen=<id>                            # ONE SCREEN, every case that touched it
node cli/review.mjs [--since=… --case=… --all --out=…]       # the whole session as review.html
node cli/explore.mjs <observations.jsonl> [--out=…]          # one exploration session as a page
# NB: the seed ledgers a test needs live in test/fixtures/ledger/ -- its README says why.
ORBIT_UI_TESTS=test/fixtures/ui-tests ORBIT_STORE_DIR=/tmp/l \
  node cli/qa-plan.mjs coverage things   # plans|show|render|coverage|select|impact|suggest|new
ORBIT_STORE_DIR=/tmp/l node cli/autonomous-qa.mjs derive|reconcile --investigation=<id>   # obligations from accepted plans; a dispatch that never settled, read back
ORBIT_STORE_DIR=/tmp/l node cli/security-audit.mjs assess --investigation=<id>   # the controls in effect, from an investigation's own record
node cli/qa-plan.mjs expects <openapi|asyncapi|schedule>.json [--operation=… --status=… | --channel=… --within=… | --at=…]   # candidate expectations
node acceptance/run.mjs [--stack=…] [--variant=…] [--keep] [--record]   # native acceptance: two stacks, planted defects, a ground truth (Docker)
ORBIT_STORE_DIR=/tmp/l node cli/qc-tool.mjs where|list        # this project's own QC tools (README §7.2)
ORBIT_STORE_DIR=/tmp/l node cli/qc-tool.mjs new <id> <scratch-dir> [--tool=psql] [--mutates]
ORBIT_STORE_DIR=/tmp/l node cli/qc-tool.mjs verify|register <dir>   # exit 2 if it would not load
ORBIT_STORE_DIR=/tmp/l node cli/qc-tool.mjs status <id> <status>    # draft→verified→active→stale→retired
ORBIT_STORE_DIR=/tmp/l node cli/resources.mjs list|observe|route "<prompt>"  # the registry, the snapshots, a dry route
ORBIT_STORE_DIR=/tmp/l node cli/mcp.mjs list|tools <server>  # managed · external MCP (no add/enable/install)
ORBIT_STORE_DIR=/tmp/l node cli/mcp.mjs call <server> <tool> --for=<capability> --input='{…}'  # through every gate
ORBIT_UI_TESTS=test/fixtures/ui-tests ORBIT_STORE_DIR=/tmp/l node cli/context.mjs --for="<task>"  # project.context, memory first
ORBIT_UI_TESTS=test/fixtures/ui-tests ORBIT_STORE_DIR=/tmp/l node cli/help.mjs --for="<task>"     # one NEXT for a task
ORBIT_UI_TESTS=test/fixtures/ui-tests node cli/query.mjs extensions   # loaded, refused, and WHY
ORBIT_UI_TESTS=test/fixtures/ui-tests node cli/query.mjs capabilities # what {"do":"call"} may ask
ORBIT_STORE_DIR=/tmp/l node cli/knowledge.mjs claims --for="…" [--context=k=v]   # project knowledge (README §4.9)
ORBIT_STORE_DIR=/tmp/l node cli/knowledge.mjs record [<file>] [--human]          # candidate claims, all or nothing
ORBIT_STORE_DIR=/tmp/l node cli/knowledge.mjs verify --for="…" [--purpose=verification] [--workflow=<skill>]
ORBIT_STORE_DIR=/tmp/l node cli/knowledge.mjs opportunities|vocabulary|where|why <id>
ORBIT_STORE_DIR=/tmp/l node cli/knowledge.mjs decide <opp-id> defer|accept|ignore|reopen --human
ORBIT_STORE_DIR=/tmp/l node cli/trace.mjs turns|turn <id>|usage|where           # the session trail (README §4.8)
ORBIT_STORE_DIR=/tmp/l node cli/live.mjs status|watch [<task>] [--plain|--jsonl|--logs]   # Orbit Live in a terminal (README §4.16)
ORBIT_STORE_DIR=/tmp/l node cli/live.mjs tui [<task>] [--ascii] [--logs] [--until-done[=<s>]]   # full screen, an interactive terminal only (ADR 0018)
ORBIT_STORE_DIR=/tmp/l node cli/live.mjs open [<task>] [--print]   # that viewer beside this session (tmux · Windows Terminal · macOS window), a person's choice
ORBIT_STORE_DIR=/tmp/l node cli/live.mjs ensure [<task>] [--json]   # what /orbit and /orbit-help run: this session's viewer, opened once and reused (ADR 0020)
ORBIT_STORE_DIR=/tmp/l node cli/live.mjs pane --host=claude [--auto] < session.json   # the view a docked pane draws (hooks/live-pane.tsx), one JSON object
claude plugin validate . && node skills/orbit-release/pane-check.mjs   # the Claude Code pane module, by the host's own tools (tested staged: Orbit Control's vitest files sit under this root)
ORBIT_STORE_DIR=/tmp/l node cli/live.mjs settings --apply='{"pane":{"widthPercent":36,"focusCli":true}}' --revision=<r>   # how wide the viewer beside the CLI is
ORBIT_BENCH=1 node --test --test-reporter=spec test/perf/activity.bench.mjs   # what observing a running check costs, measured
ORBIT_STORE_DIR=/tmp/l node cli/live.mjs pin <task> | unpin | settings | where | doctor [--claude]
ORBIT_STORE_DIR=/tmp/l node cli/automation.mjs status | doctor | plan --for="…" | where   # automation, read (README §4.17)
ORBIT_STORE_DIR=/tmp/l node cli/automation.mjs start --for="…" [--ref=<item>] | context <task> | step <task> | settle <task> | reconcile <task> | finish <task>
ORBIT_STORE_DIR=/tmp/l node cli/skill-factory.mjs list | drafts | show <id|pin> | put <id> <file.md> | verify <id> | where   # generated playbooks
ORBIT_STORE_DIR=/tmp/l node cli/host.mjs render|apply|remove --host=claude --kind=statusline [--human]   # Claude Code's status line
ORBIT_STORE_DIR=/tmp/l node cli/requirements.mjs resolve <ref>|acquire <ref>|status <root>|record <root>|ask <root>|snapshot <root>|show <rs>|where   # a requirement (README §4.12)
ORBIT_STORE_DIR=/tmp/l node cli/requirements.mjs answer <root> --question=rq-… --says="…" --human   # a person's word, relayed
ORBIT_STORE_DIR=/tmp/l node cli/work.mjs start "<objective>" --ref=<id> [--snapshot=rs-…]   # the one work a requirement has
ORBIT_STORE_DIR=/tmp/l node cli/work.mjs show|need|resolve|invoke|settle|claim|checkpoint|resume|recall|list|where   # a work (README §4.12)
ORBIT_STORE_DIR=/tmp/l node cli/runtime.mjs discover|status|doctor|design|proposal|settings|projects   # what a checkout needs to run (README §4.13)
ORBIT_STORE_DIR=/tmp/l node cli/runtime.mjs start|stop [--component=<key>]   # what a file declared; only what Orbit can prove it started
ORBIT_STORE_DIR=/tmp/l node cli/runtime.mjs adopt <id> --human              # the one command that writes the repository
ORBIT_STORE_DIR=/tmp/l node cli/runtime.mjs sandboxes|sandbox|sandbox-prepare|sandbox-start|sandbox-stop|sandbox-release --task=<tsk>   # a task's own application (README §4.13)
ORBIT_STORE_DIR=/tmp/l node cli/task.mjs create "<objective>" [--work=w-…] | stage | attempt | act | link | decide   # record an execution (README §4.14)
ORBIT_STORE_DIR=/tmp/l node cli/task.mjs pause|cancel <task> --human --expect=<revision>   # a person's, on the revision read; approve and resume are Control's
ORBIT_STORE_DIR=/tmp/l node cli/task.mjs show <task> | events <task> | list | machine [--json]   # one task, or every task on this machine
ORBIT_STORE_DIR=/tmp/l node cli/autonomous-engineering.mjs start --ref=<item> | start "<objective>"   # a task taken to a verified change (README §4.15)
ORBIT_STORE_DIR=/tmp/l node cli/autonomous-engineering.mjs context <task> | step <task> < decision.json | reconcile <task> | finish <task> | resume <ref>
ORBIT_STORE_DIR=/tmp/l node cli/project-report.mjs status|settings|runs|parts|where   # a PO report (README §4.10)
ORBIT_STORE_DIR=/tmp/l node cli/project-report.mjs run [--dry] [--months=N|--from=D --to=D|--all] [--as-of=D]
ORBIT_STORE_DIR=/tmp/l node cli/project-report.mjs render [<run-id>|latest]          # again, asking no source
ORBIT_STORE_DIR=/tmp/l node cli/project-report.mjs probe | connections | connect <id> --provider=… --organization=… [--auth=azure-cli|credential] [--credential-env=<NAME>]
ORBIT_STORE_DIR=/tmp/l node cli/project-report.mjs sign-in <id> [--tenant=<id>] [--device-code] | sign-out <id>   # Microsoft sign-in, in Orbit's own Azure CLI profile (ADR 0043)
ORBIT_STORE_DIR=/tmp/l node cli/qc-tool.mjs new <id> --report=<kind> --for="…" | put <id> <file> | rollback <id>
node skills/orbit-sql/sqlcmd.mjs preflight            # can this machine read the database?
node cli/schema.mjs [--plan]                                 # print the generated case (or plan) schema
node skills/orbit-release/ship.mjs                        # the whole definition of done, one command
node skills/orbit-release/pin-python-lock.mjs --python=<Orbit's own Python> --package=azure-cli==<v> [--platform=…]   # re-pin a python-lock tool's locks (network; uv for the other platforms)
agy                                                          # run antigravity with skills/hooks discovered
```

## Definition of done

All of 1-4 are one command — `node skills/orbit-release/ship.mjs`, which CI runs too (`--ci`), so the
gate and the pipeline cannot disagree about what done means. The one gate a pipeline cannot hold -- native host
acceptance, recorded from live runs on every host -- is `wait` under `--ci` and still refuses a release without it.

1. `node --test` passes, and the gate prints the test count.
2. The strict lint prints `0 finding(s)`.
3. `query check` and `plan-check` on `test/fixtures/ui-tests` print no findings/errors.
4. Any behaviour a consumer can observe — CLI names and flags under `cli/`, exit codes,
   `run-log.jsonl` record kinds, `ORBIT_*` variables, `ui-tests/` layout, `project.json` and
   `graph/meta.json` keys, the DSL — is a **contract**. Changing one is a major version; adding
   to one is a minor version. While a **prerelease** is current the same rule reads differently:
   a beta publishes no contract, so any change advances it (`1.0.0-beta` -> `1.0.0-beta.2`) and
   `ship.mjs --bump=release` is what ends it. Bump `version` in **all five** of `package.json`,
   `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, the root `plugin.json` and
   `.codex-plugin/plugin.json` — the gate checks every one (`VERSIONS`), and a fourth once drifted
   silently through two releases before it did. The same gate holds every other marketplace entry to
   that version too: they ship with the release. The two shipped packs' `extension.json` carry it as
   well, and `test/packs.test.mjs` holds them to the same number.
5. `README.md` and the `skills/*/SKILL.md` playbooks say what the code now does.
6. New agent-authored cases stay in machine-store drafts, including after PASS. Agents use
   `--report` for every live run; promotion to shared regression requires an explicit request.
   Discussion decisions and open questions belong in notes, not full conversation archives.

## Consumers

A team adopts the engine by asking for it: `/orbit-help` in the checkout (or `node <engine>/cli/init.mjs
<repo> --origin=…`) seats the project in the machine store -- nothing in the repository. It then sets
`origin` in the seat's `project.json` (`query storage --json` prints where), records screens/controls in
`graph/`, designs `screens/<screen>/<id>.plan.json` (`qa-plan new <id> --screen=<screen>`), and adds
`screens/<screen>/cases/*.json` linked from the scenarios. A team that commits its test data with the
product's code keeps `ui-tests/` in the checkout (`init --in-checkout`, or a person's `storage export
--all --move`), and that home is read and written directly, without a second copy.
Install in Grok Build: `grok plugin install cuongngoht/orbit --trust` (the root `plugin.json` names
`hooks/grok.json`; docs/grok.md). Install in Antigravity: `agy plugin install <engine>`; the root `hooks.json` uses the current native protocol.
A consuming repo also keeps its own playbook skill (product traps, preflight rules) and its own
launcher script — product-specific tooling that deliberately stays out of this repo. Name neither
here: every consuming repo is one of many.
