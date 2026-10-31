# Changelog

## Unreleased

A Docker benchmark that holds Orbit's own source to independent checks, and repairs a failure only through Orbit
(ADR 0046). This is development tooling under `benchmark/`: export-ignored, imported by nothing of the engine, and
changing no engine contract, so no version moves.

- **Cases are data.**
  - A pack under `benchmark/packs/` holds cases.
  - Each case has a `case.json` held to declared fields, a public request, a hidden spec and probe that only the
    verifier reads, variants that plant exact faults in the run's own copy (`FIXTURE_DRIFT` when one no longer
    matches), and controls that prove the checks discriminate.
- **Frozen inputs.**
  - The current branch is read through read-only git: HEAD, or HEAD plus the working tree when a person says so. A
    dirty tree with no choice is refused, and nothing in the checkout is reset, stashed or written.
  - The subject becomes a checkout with one fixed commit. The manifest pins the commit, the digests, the case, the
    image ids, the seed and the limits.
- **A run is one Orbit task** (provider `benchmark`), written only through `cli/task.mjs`. Orbit Live and Mission
  Control show its stages, the task's door holds its budget, and a person's pause or cancel stops it with nothing of
  its own left running. `resume` carries it on from its journal: a repair round is read back and never sent again.
- **Containers through Orbit's Docker provider.** Each one is attested to the isolation profile before it starts and
  has:
  - a read-only root, no capability, `no-new-privileges`, an init, and CPU, memory and PID limits;
  - a deadline the controller enforces;
  - cleanup by the run's label only.

  No container gets the Docker socket, a home directory, the developer's store or checkout. The verifier has no
  network, no credential and no model, and its judge never imports candidate code. The runner reaches only the
  model's API, through an egress proxy it checks before the host runs. A credential is passed by name only. When a
  run ends, a sentinel masks the credential's value wherever it appears in the run's room, and names those files.
- **Repair through Orbit.**
  - Claude Code, pinned in the runner image, drives ONE engineering task started with `autonomous-engineering.mjs
    start`.
  - The candidate is read back by an inspection container. `SCOPE` holds it to its scope, the harness, the checks and
    the existing tests.
  - It is verified on the hidden checks, on the repository's gates over the subject's own tests, and on its own
    regression test, before and after the change.
  - `CAUSES` and `NEXT` decide the rest: VERIFIED, NO_PROGRESS, BUDGET_EXHAUSTED, BLOCKED or BENCHMARK_INVALID.
- **The report keeps apart** correct code, work that went through Orbit, autonomy end to end, a blocker and an invalid
  benchmark. A host's numbers are REPORTED, and an unreported one is `unknown`.
- **First suite, `orbit-source`.**
  - **ORBIT-SRC-001** holds `src/improvement/oracle.mjs` and `safety.mjs` to the acceptance oracle's promises. It
    passes on the current source and fails on its planted variant, a partial fix, allow-all and reject-all.
  - **ORBIT-SRC-002** fails on the current source: a removed step that waited for a person goes unreported. It is a real
    finding, kept as its own case.

- **QA cases (ADR 0047): does Orbit's autonomous QA find a planted defect?**
  - A second suite, `orbit-qa`, plants one defect per case in Orbit's own synthetic acceptance application, with that
    application's own ground truth. One case plants nothing, so every contradiction there is a false alarm.
  - Orbit's engine runs from the run's frozen checkout beside the controller. It sets the application up on an
    isolated sandbox of its own and opens one investigation, doing once what a person does in Orbit Control.
  - A real coding host works the investigation from the runner container through a relay of files: requests it
    writes, answers it can only read. The relay admits the subcommands a host uses, about the run's own investigation;
    it never passes a person's approval, a second investigation or a path. The host's plugin withholds the ground
    truth, the reference designs and the application's source, and its `cli/autonomous-qa.mjs` is the relay's client.
  - What the investigation came to is read off the engine's own journal. Each contradicted design is replayed on the
    clean application, and counts as a defect found only when the clean application satisfies it. The verdict table
    ends in BLOCKED, FAIL (a false alarm, a defect missed, too little covered), INCONCLUSIVE or PASS.
  - `controls` proves the verifier live, with no model: a reference host using acceptance's designs must PASS, while
    an idle host and a false-alarm host must FAIL.
  - A QA worker image, built from the official Playwright image pinned by digest, needs no OS package mirror or
    browser CDN. The sentinel also looks for the sandbox's per-run tokens.
- **Best-practice names.**
  - Benchmark "packs" are SUITES (`suites/<suite>/suite.json`), matching `--suite` and kept apart from Orbit's
    capability packs.
  - A case's directory is its id in lower case. `hidden/` is `verifier/`, and `faults/` is `variants/`.
  - The modules are grouped as `lib/core/`, `lib/source/` and `lib/qa/`, and the tests as `test/benchmark-source-*`
    and `test/benchmark-qa-*`.

## 0.3.0

Autonomous self-improvement on independent evidence (ADR 0045): Orbit now notices when one of this project's reusable
definitions -- a declared playbook the skill factory keeps, a role Satellite keeps -- fails the same way in independent
sessions, drafts the smallest successor through that definition's own factory, compares it with the version it would
replace on the same frozen inputs, chooses it for new work only when twelve gates hold and only through the owner's own
door, watches the runs that follow, and puts the replaced version back when it regresses. A campaign is a journal of
decisions in the machine store; every truth stays with its owner. All contract changes are additive.

- **Detection.** `src/improvement/` reads owners' run records into signals (a contract its definition declares that did
  not hold, an input it could not bind, its own bounds spent, a Satellite run that ended without an owner's proof) and
  keeps one opportunity per fingerprint. A single failure, retries inside one session, a provider's failure, an
  environment that blocked a run and a person's approval never start a campaign; a problem more sessions contradict than
  show is not one. It runs after a coordinated workflow ends and from the hooks (a detached, debounced `improve analyse
  --hook`, which never evaluates).
- **Diagnosis and generation.** `DIAGNOSIS` names the cause from what the evidence demonstrates; only the definition's
  own declaration, with high confidence, gets a candidate. The skill factory gains a SUCCESSOR: `scaffoldSuccessor`
  drafts it from the pinned version (`successorOf`, `campaign`), the host writes the change with `skill-factory put`,
  and `stageCandidate` keeps it under `candidates/` with status `candidate` -- pinnable, never offered; `register`
  refuses a successor (`SF_SUCCESSOR`). A role's successor is published to Satellite HELD.
- **Validation.** `SAFETY` refuses, before anything runs, a candidate that widens a tool, changes what it provides,
  carries anything but instruction text or declared data, or weakens an acceptance rule (a lowered bound, a removed rule
  or required step, a retyped output); its owner's own contract holds it too.
- **Evaluation.** A playbook's candidate and the version it would replace run the same frozen inputs side by side,
  `minRuns` times each, in an evaluation task of their own (provider and door `improvement`), through the coordinator's
  own skill runner pinned by `dispatch.pin` -- the same resolver, gates, approvals and budgets as ordinary work. A role's
  evaluation is the missions the host links. `COMPARE` judges one evaluation (a newly failed step is WORSE whatever else
  improved), `AGGREGATE` all of them (BETTER needs two independent sessions and none saying otherwise). Cost is measured
  beside the verdict, with denominators; tokens, cost and handoffs stay unknown.
- **Promotion, monitoring and rollback.** Twelve ordered `PROMOTION_GATES`, then `selectVersion` (skill factory) or
  `selectDefinition` (Satellite's `registry/selected/<id>.json`): doors `improvement` and `control`, the revision read,
  a person's withholding always winning, the replaced version kept whole and a pin a task holds never moved. With
  `improvement.promote` off a qualified candidate waits for a person. `MONITOR` reads ordinary runs afterwards; a
  regression in independent sessions selects the replaced version again and suppresses the candidate. An ended campaign
  is one finding for learn's own ladder.
- **Settings.** `improvement.*` in the automation settings (schema 3, additive): `detect`, `generate`, `evaluate`,
  `promote`, `minSessions`, `minRuns`, `maxCandidatesPerSubject`, `maxEvaluationAttempts`, `maxEvaluationMinutes`,
  `maxConcurrentEvaluations`, `isolation`, `cooldownHours`, `retentionDays`; `improvement.allowExecutableCandidates` is
  fixed false. Written only through Orbit Control's door.
- **CLI and skill.** `cli/improve.mjs`: `status`, `analyse`, `opportunities`, `candidates`, `show`, `start`, `step`,
  `resume`, `evaluate`, `candidate`, `link`, `reconcile`, `history`, `metrics`, `doctor`, `where` -- none promotes,
  reverts, rejects or changes a setting. `/orbit-improve` (switch `skill_improve`) is the host's playbook.
- **Live, Control, trail.** `IMPROVEMENT_SOURCE` sends a campaign an evaluation task names as one `improvement-view`
  frame and named events; the full-screen viewer and the pane draw an IMPROVE section; `live status --json` lists
  campaigns. Orbit Control's Advanced → Improvement shows the overview with nine metrics, the opportunities, each
  campaign (why, the successor, every evaluation, every gate, history, events) and the settings, with a person's
  promote, revert and reject on the revision read. The trail gains `improvement.detected`, `improvement.decided`,
  `improvement.promoted` and `improvement.rolled_back`.
- **Shared binding.** `skills/orbit-help/invoke.mjs` is the one binding of a declared playbook's door, which
  `cli/automation.mjs` and `cli/improve.mjs` share.
- **Independence is one machine on one UTC day,** learn's own rule (`src/memory/session.mjs`), never a session mark a
  shell can set. Another evaluation runs only when it would add an independent session: asked again on the same
  machine and day, under any session mark or none, it starts nothing. A successor whose text tells its reader to ignore its rules is refused by the factory's own injection rule,
  and no terminal writes a verdict, a qualification or a promotion (`test/improvement-manipulation.test.mjs`).
- **The hook's detached analyse never stands in the checkout, and starts only when there is something to analyse.**
  It starts in the system's temporary directory and is told its checkout (`analyse --hook --checkout=<dir>`), because
  on Windows a directory a running process stands in cannot be removed. A project that keeps no playbook, no Satellite
  mission and no campaign starts no process at all.
- **Tests.** `test/learning-default.test.mjs` waits for the drained session's trail event as well as its facts: the
  drain keeps the facts first, so a busy machine could read the trail in between.
- **Native host acceptance** goes stale with this source and is owed again.

## 0.2.2

Agent and skill run identity, and attribution on evidence (ADR 0044): every agent run, declared skill run and tool call
Orbit can see is identified once, carries its parent as its owner recorded it at the dispatch boundary, and says how
anybody knows which run it belongs to -- `RUNTIME_BOUND`, `HOST_OBSERVED`, `REPORTED`, `UNATTRIBUTED` or `CONFLICTING`
(`src/attribution.mjs`) -- never moved onto the latest skill or the nearest run. Orbit Live, Satellite Live, `trace usage`
and Orbit Control show the same identity, outcome and coverage, and every gap says so. Contract changes, all additive
except Satellite Live's view (version 2, a word renamed): new trail fields and events, two hook events, working-set line
fields, a usage section, a Satellite journal line, two envelope fields, a CLI flag, two JSONL frames.

- **Hooks.** Claude Code's `SubagentStart` and `SubagentStop` reach `cli/learn-hook.mjs` (in the background; the hook
  answers nothing). The adapter keeps a subagent's `agent_id` and `agent_type`, the `agentId` an Agent call answers with,
  and the mission run an Orbit envelope's mark names on an Agent call to a Satellite agent -- every id hashed in
  `src/lifecycle/event.mjs`; the prompt, a subagent's last message and its transcript are never read. New lifecycle
  events `agent-start` and `agent-end`.
- **Session trail.** `tool.used`, `command.ran`, `skill.invoked` and `agent.invoked` gain `call` (the hashed call id) and
  `agent` (the subagent that made it); `agent.invoked` gains `run` (`msn-…/arn-…`). New events `agent.launched`,
  `agent.started`, `agent.ended`. A Claude Code event's id now comes from its call, as protocol 2's always did, so a hook
  delivered twice is one event; a Claude Code event names its host (`agentHost`).
- **Usage.** `trace usage --json` gains `attribution` -- per agent as the host's payload says it (`byAgent`: type, start
  and stop, who launched it, the run, events, distinct calls, failed, not reported, skills), the calls that name no agent
  (`session`), and `coverage` (how many observed tool events named an agent, per host) -- and `skills[].runs` (distinct
  starts). The `skills` heuristic is unchanged and stays labelled as one. Orbit Control's usage page has a "Which agent
  made the calls" card.
- **Working set and Orbit Live.** A line names the subagent that made it; a subagent's start and stop and a finished
  call that started a skill or an agent are kept. `live status --json` gains `session.agents`, `own`, `invocations` and
  `coverage`; the pane's NOW and events view draw an AGENTS block. A subagent's command is no longer closed by its
  parent's turn ending. Work tracking's coverage rows gain `namesAgents`, `agents` and `calls`.
- **Declared skill runs.** A run carries its id qualified by its task, its attempts and `RUNTIME_BOUND`; an approval's
  reason names the step's ref (`<run>.<step> of …`), so two runs never share a waiting request. `live watch --jsonl`
  emits `plan-view` and `skill-view`; the evidence overlay ranks `skillrun`, `skillstep` and `invocation` receipts and
  shows their pin, provider and digests.
- **Satellite.** `agent ack <msn> <arn> --host-agent=<agentId>` records the dispatcher's word as `agentrun.bound`
  (hashed, REPORTED). Satellite Live joins its runs with the session trail at read time: each run's host agent, its word
  and basis, the host's lifecycle of that agent, and its calls direct and through the agents it launched. The live view
  is version 2 (`UNOBSERVED` is now `UNATTRIBUTED`); the Tools view adds per-run counts and a coverage section; the Agents
  view selects a run (`j`/`k`) and inspects it (`enter`, `o`, `esc`). The envelope gains `parentAgentRunId` and
  `attempt`. The host matrix's `toolObservation` notes say what each host proves.
- **Identity is never authority.** No gate, approval or protected boundary reads a run id, an agent id, a mode or an
  attribution word (`test/protected-bypass.test.mjs`).
- **Tests.** `test/skill-lifecycle-e2e.test.mjs` AC-12 listens for its child's exit from the start: the wait no longer
  races a child that ends on its own.
- **Native acceptance on Claude Code 2.1.314.** Headless sessions with this plugin dispatched two Satellite runs at
  once -- in the foreground (`completed`, the agent named when the call returned) and in the background
  (`async_launched`, named at launch) -- acknowledged each with `--host-agent`, reported, interrupted one through
  reconcile and retried its unit as a new run (attempt 2): every run was HOST_OBSERVED to its own agent, eight calls
  each, the dispatcher's word agreeing with the hooks', and the mission ended REPORTED / NOT_VERIFIED. The captures are
  sanitized fixtures (`test/fixtures/hooks/claude/*-2.1.314.json`), and `satellite/acceptance/host-acceptance.json`
  holds a receipt for this source (`claude:agent-dispatch`, `claude:agent-parallel`). Orbit's four-host record
  (`docs/host-acceptance.json`) is owed again for this source, as it was for 0.2.0 and 0.2.1.

## 0.2.1

Microsoft sign-in for Azure DevOps (ADR 0043): a person signs in once with their Microsoft account, and a connection reads
Azure DevOps with a short-lived token, through an Azure CLI profile that Orbit owns. Orbit may use an `az` program the
machine already has, but it never uses the developer's Azure CLI identity state: it never reads, copies, asks about or
changes their login, account, subscription, configuration or extensions, so a person can be signed in as account A in a
terminal and as account B in Orbit. Contract changes: a connection's `auth` field, new catalog row fields and a new
install strategy, two commands and a flag, a trace event, three Control routes and a new store room, all additive; one
changed default, because a NEW Azure DevOps connection now signs in with Microsoft unless `--auth=credential` says
otherwise or the command names the variable a credential is read from (`--credential-env`); and one removal, the azure-devops provider's `az devops configure --list` hint (below).

- **A connection says how it gets in.** A connection record gains `auth: { strategy, ...options }`, and a provider
  descriptor gains `authentication` (`default` and `strategies`, each `kind: "credential"` or `"broker"`). Azure DevOps
  offers `azure-cli` (Microsoft sign-in, options `tenant` and `deviceCode`, the default for a new connection) and
  `credential`; GitHub offers `credential` only. A record with no `auth` is a credential connection and is never rewritten.
  A `broker` connection accepts no credential at all. `src/connections/auth.mjs` is the one contract every reader, collector
  and probe asks for a request's authorization.
- **Commands.** `node <engine>/cli/project-report.mjs sign-in <connection-id> [--tenant=<id>] [--device-code]` and
  `sign-out <connection-id>`; `connect` gains `--auth=azure-cli|credential` (the default for azure-devops is `azure-cli`; naming `--credential-env` on a
  new connection makes it a credential one, and `--auth=azure-cli` changes it back).
  A connection test never starts a sign-in.
- **Orbit Control routes.** `POST /api/v1/connections/:id/auth/check`, `.../auth/sign-in` and `.../auth/sign-out`: the
  connection's state, a sign-in and a sign-out. Control's Connections page shows the state and offers all three.
- **Catalog row fields** (`catalog/tools.json`). A row may declare `profile` (`env`, `name`), `launch` (`env`,
  `platformEnv`, `inherit`, `args`), `detection.native`, `detection.wrapper`, `detection.sources`, `detection.timeoutMs`,
  `install.autonomous`, `install.python` and `install.package`; an asset may carry its own `launch`, and a locked asset names
  its `lock` and `bin`. A new install strategy, `python-lock`, is pinned by a lock under the new `catalog/locks/`. New rows:
  `azure-cli-private` (macOS and Linux) and `azure-cli-private-win` (Windows x64). The `azure-cli` row now says it is used as
  a program only and declares the profile and the pins; the `python` row is `autonomous`.
- **New trace event** `connection.auth`: which phase ran (a token request, a sign-in, a sign-out) and how it ended, from an
  allow-list; never a token, an account or what the CLI printed.
- **New codes.** A sign-in that cannot proceed is BLOCKED (3) with one of `AUTH_TOOL_MISSING`, `AUTH_TOOL_UNSUPPORTED`,
  `AUTH_TOOL_UNVERIFIED`, `AUTH_LOGIN_REQUIRED`, `AUTH_LOGIN_CANCELLED`, `AUTH_LOGIN_FAILED`, `AUTH_TOKEN_FAILED`,
  `AUTH_TENANT_AMBIGUOUS`, `AUTH_REJECTED`, `AUTH_FORBIDDEN`, `AUTH_CREDENTIAL_MISSING` or `AUTH_PROFILE_LOCATION` and the one
  thing a person does next; a tool that cannot be had is `TOOL_MISSING`, `TOOL_UNSUPPORTED`, `TOOL_UNVERIFIED` or
  `TOOL_INSTALL_FAILED`.
- **New store room.** `authSessions`, `<storeBase>/control/auth/`: machine-wide, mode 0700, created by the first sign-in
  and never by a read. The Azure CLI's profile is `<storeBase>/control/auth/azure-cli`.
- **Orbit's own profile.** Every Azure CLI process Orbit starts is given `AZURE_CONFIG_DIR` set to that directory, by one owner
  (`src/tools/launch.mjs`) from the catalog row: the child gets the few names any process needs, the names the row lets
  through (proxy, CA bundle, display) and the row's pins, and no other `AZURE_*` of the developer's. The pins switch off the
  Windows account broker (it keeps a session outside the profile, shared with the developer's own `az`), the macOS broker,
  an encrypted token cache outside Windows (its keystore entry has fixed names every profile shares), the subscription
  picker and telemetry. A version probe or an install's verification runs in a scratch profile that is removed. On Windows
  the sign-in is therefore the browser flow, not the account broker: a tenant that requires a compliant device through the
  broker may refuse it, and a personal access token is the way in there.
- **Which `az` runs.** A private copy Orbit installed, else the machine's own `az` as a program only, else Orbit installs a
  private copy itself, else BLOCKED naming every candidate. Each candidate passes one gate: it starts, names a version of 2.61.0
  or newer, and is a program of this operating system (under WSL a Windows `az` reached through interop is refused). To make
  the private copy win over a machine `az`, a person installs it from Orbit Control's Tools page.
- **What Orbit installs by itself.** On Windows x64, Microsoft's official ZIP (`azure-cli-2.91.0-x64.zip`, SHA-256 checked),
  started as `python.exe -IBm azure.cli`. On macOS and Linux (x64 and arm64), a Python of Orbit's own and the official
  `azure-cli` 2.91.0 wheels from PyPI: every distribution pinned and every SHA-256 locked (150 distributions per lock),
  installed by pip with `--isolated --require-hashes --only-binary=:all: --no-deps` into a virtual environment, staged beside
  the final directory, verified, promoted and receipted last (about 200 MB downloaded, about 700 MB on disk). Windows ARM64
  has no private copy: Microsoft publishes no ARM64 build. Only a pinned archive or a pinned lock is ever fetched on Orbit's own
  initiative (AUTO: `tool.acquire`, `auth.token` and `auth.login` cross no Protected Boundary), never through a package manager,
  `sudo`, PATH, Program Files, Homebrew or the machine's Python.
- **Tokens.** Orbit asks `az account get-access-token` each time, keeps the answer in memory until shortly before it expires
  and never reads a token-cache file. The sign-in is one sequence and never a loop: a token, then `az login` ONCE when the
  CLI says a person must act, then ONE token. `sign-out` is `az logout` against Orbit's profile only.
- **Removed.** The azure-devops provider no longer looks up a default organization with `az devops configure --list`, which
  read the developer's `~/.azure/config` and needed the Azure DevOps CLI extension. A bare `#123` resolves only through the
  project's binding or the connection registry.
- **Release tooling.** `skills/orbit-release/pin-python-lock.mjs` writes a lock for each platform (pip for the host, uv for the
  others, preferring the host's picks and recording every re-pick in the lock's header); `skills/orbit-release/SKILL.md` says
  how to re-pin and how to re-verify the Windows ZIP pin.
- **Platform evidence.** What has really been run, and what is only resolved or faked, is the table at the end of ADR 0043.
  At this release Orbit's own installer has run for real on macOS (arm64 and Intel), Linux (x64 and arm64) and Windows x64
  -- the private copy installed, answered as 2.91.0, and left a decoy developer profile untouched -- and a real Windows ARM64
  runner refused with the unsupported answer; the machine's own `az` as a program has run for real on macOS arm64. The
  Windows `az.cmd` wrapper, WSL and Alpine are `fakes-only`, and a real sign-in (a person in a browser) is `pending`.

## 0.2.0

Autonomous by default, with Protected Boundaries (ADR 0042): everything Orbit does runs on its own, and a person is
asked only where work would leave the autonomous development boundary -- writing the developer's checkout (denied),
a git push, a production deploy, a production database migration (approved once) and destroying production data
(approved once, marked destructive). Contract changes: new engineering actions (`commit`, `push`), new approval fields,
new capability field and effects, runtime commands that no longer ask for `--human`, and `adopt` that only a person's
own act crosses.

- **One table of where a person decides.** `src/protected/` is a leaf every executor and viewer reads: five boundary
  rows over STRUCTURED actions (never command strings), one `authorize(action)`, one fingerprint, declared environments
  read onto one tier (unknown is never production). Anything that is not a boundary -- an unknown action included --
  is AUTO; there is no allow-list.
- **Delivery.** An engineering task commits its verified change on its own branch (`orbit/<task>`), autonomously, and
  pushes exactly that commit only once a person approved exactly that push (repository, remote, URL digest, ref,
  commit, force) in Orbit Control; a changed push, a moved remote or a second use is refused, and an interrupted push is
  read back from the remote. Neither goes through the workspace's own `.git`, which the task writes: the commit is made
  in a bare git directory beside the workspace that only Orbit writes, and the push from one made for that push alone,
  so a hook, a rewritten URL or a `.git` naming the checkout cannot move either. A task workspace keeps no `origin`,
  and a clone whose `.git` is a link or names another repository is never read or written through.
- **Production through what is declared.** A capability declares `environment` and the new effects `deploy`, `migrate`,
  `delete`, `truncate`, `drop`, `purge`, `reset`; the capability pipeline refuses a protected call that carries no
  spent approval of exactly it, from every route (a UI case, a work's need, a playbook step, a mission, a worker), and
  an ordinary production write that declares what it is stays autonomous. The MCP broker refuses a tool a catalog row
  declares protected (the github row: its ref-writing tools), so a push or a merge never goes around the boundary.
- **The existing approval, carrying the boundary.** `request-approval` keeps `boundary`, `destructive` and `shows`; the
  type is the protected kind, the risk sentence says exactly what is approved (DESTRUCTIVE first), and Orbit Control's
  approval card shows it unchanged. One open request per fingerprint, granted only in Control on the revision read,
  consumed before the action starts, its fingerprint derived again just before it runs.
- **Friction removed.** A capability that changes state outside the workspace no longer asks a person; a task's own
  sandbox restores, builds and starts autonomously (a trust list is now a review mark its receipts name -- the one
  exception: a host-side `initializeCommand` the task itself added or changed waits for a mark on that definition); `validate`,
  `prepare --apply` and `forget` ask nobody; autonomous QA is on by default; a task's sandbox opens every mode the
  engine's gates allow and a fixture grant every declared effect -- `qa.modes` and `qa.writes` only narrow.
- **The primary checkout.** `runtime adopt` is the PRIMARY_CHECKOUT_WRITE boundary: refused for any agent, `--human` or
  not, from any terminal; a person adopts in Orbit Control, whose door is the one that proves a person.
- **Live.** Protected approvals are worded from the journal's own fields (waiting for approval, granted, executing,
  completed, failed), and `src/live/protected.mjs` names the transitions (`protected.detected`, `approval.*`,
  `protected.executing|completed|failed`).

## 0.1.1

Orbit Satellite (ADR 0041): any goal taken through an autonomous, multi-agent mission whose every step is journaled,
judged and observable -- a structured intent, an investigated and revisable work graph, reusable roles, agent
templates, skills and workflows, fresh agent runs under least-privilege profiles, and a verdict only an independent
owner's evidence can earn. Additive: `satellite/`, `skills/satellite/` and `agents/satellite-*.md`; nothing else in the
engine changed.

- **A mission journal above the owners.** `satellite/cli/satellite.mjs` keeps one append-only journal per mission under
  `<storeRoot>/satellite/missions/`, folded into its state on every read. The host decides one step at a time; every
  action passes one gateway -- proposal, contract, policy, durable intent, provider, observation, evidence, journal --
  and its mode, operation kind and profile are derived, never sent.
- **Understand first, then plan on evidence.** A goal in any language becomes facts, hypotheses, assumptions,
  constraints, acceptance criteria and unknowns kept apart; criteria freeze after the first analysis. A work graph of
  `explore`, `diagnose`, `design`, `review`, `verify`, `implement`, `build` and `test` units is validated (cycles,
  bounds, effects) and revised only by a trigger, each revision an immutable file naming what it replaced and why.
- **Reuse first, generate only the gap.** Roles are reused, composed or generated and named from their
  responsibilities, and request a profile without granting anything. Agent templates are reused across missions.
  Skills go through Orbit's own skill factory, instruction-only and within its limits, never around a capability a
  person disabled. Workflow templates (`orbit.satellite.workflow/v1`) carry parameters and bounds and never a state.
  Every definition is immutable and pinned by its digest.
- **Owners do the work, and keep the proof.** An implement unit's change is an Orbit autonomous-engineering task in its
  own workspace; a build or test unit drives the task its dependency handed off; a capability is asked once, read only,
  through `invokeBound`, nested on its run's mode. A criterion is VERIFIED only by an engineering task's own
  verification, a declared check or a QA investigation, read back when the run reports.
- **Typed handoffs, honest hosts.** A run's handoff is published immutably and consumed only after scope, freshness and
  contract checks. Claude Code dispatches runs natively and in parallel as `orbit:satellite-reader`, `-designer`,
  `-engineer` and `-verifier`; Codex, Antigravity CLI and Grok Build run them serially and say so. A host capability is
  verified only on a native acceptance receipt for the same source (`satellite/acceptance/`).
- **Recovery never resends.** A worker holds a lease while its provider runs and is fenced if reconcile closed its
  action; reconcile reads every open action back from its owner and leaves a write it cannot prove AMBIGUOUS.
- **Satellite Live.** `live status`, `live watch` (`--plain`, `--jsonl`, `--since=o=<n>`), the full-screen `live tui`
  with nine views, and `live open` beside the session: every line as an `orbit.satellite.event/v1` event, each run in its
  own mode, the viewer's state apart from the mission's, and this session's tool calls beside it.

## 0.1.0

Autonomous test generation and sandbox verification (ADR 0031-0040): from an accepted requirement to a generated test
that runs in an isolated sandbox, earns a verification outcome its host decides, and reaches a frozen assessment and a
report -- for a frontend, a synchronous backend, a scheduler, messaging and security alike.

- **Obligations, derived, never guessed.** An investigation's ACCEPTED plans, read against a frozen System Graph, become
  test obligations (`autonomous-qa derive`): a criterion's structured expectations, the graph node it is about and the
  SHAPE of each kind of property (`src/qa/obligations/shapes.mjs`), with applicability, unknowns and authority derived.
  An obligation's slots are the expectations that state it (`for`), and a design must rule on each of them.
- **Designs, compiled, never trusted.** A host proposes a skeleton; the engine compiles every verdict from an accepted
  criterion into a predicate TREE the evaluator interprets (never `new Function`), every window from that criterion's
  own `within`, and -- for a page -- every wait and reader script from templates that only read the DOM. A skeleton
  carries no `expect`, `js`, `wait` or `status`. Controls are held to what the test can show of them.
- **Runs in an isolated sandbox, judged by the host.** A frozen version runs only in a worker whose isolation is
  attested (Docker: an internal network of the task's own, a read-only root, no capabilities, egress proven to fail),
  with its refs SEALED by the host, its secrets on stdin, identities issued inside the task's network, and every write
  under a grant the engine mints for its fixture (ADR 0037). The worker's envelope is checked and the claim re-derived
  before anything is written; RESULT rows give the word (SATISFIED, CONTRADICTED, INCONCLUSIVE with its reason,
  AMBIGUOUS, FLAKY across attempts …). A dispatch that never settled is read back and reconciled, never resent
  (`autonomous-qa reconcile`).
- **Adapters, not clients.** Backends are reached through family operations (`orbit.<family>.<op>`) answered by the
  adapter a binding selects (`orbit.adapter/v1`); reference adapters ship as packs a project opts into: HTTP
  (`orbit-api-test`), AMQP 0-9-1, NATS JetStream, PostgreSQL state reads and the test-hook protocols for a project's
  scheduler, clock, workloads and identities (`orbit-backend-test`). Support is COMPUTED from conformance-kit receipts on
  real systems (`query adapters --matrix`).
- **Pages in the worker.** A generated UI test drives its own headless browser in the worker, as the identity its
  design approved: one engine-written route carries that identity's credential to the bound origin alone, never along a
  redirect or to another host, and lets a write through only under a page grant this run was minted.
- **Security, from evidence.** The Security Auditor assesses the controls in effect (ASVS 5.0.0 L1 by default, labelled
  with the OWASP Top 10 2025 and the API Security Top 10 2023; catalogs a person adds, adopts and enables in Orbit
  Control) from an investigation's own record (`security-audit assess --investigation=<id>`): verified, a finding with
  what it stands on, inconclusive when a positive control did not hold, pending while a role is owed.
- **The system graph and reverse engineering.** Architecture keeps node and relation facts; `architecture graph`
  projects them with their evidence and freshness; `orbit-reverse-engineer` is a standalone pass.
- **Contract readers.** `qa-plan expects <contract.json>` reads an accepted OpenAPI 3.x, AsyncAPI 2/3 or schedule policy
  into candidate expectations a person puts in a criterion -- stating only what the document states.
- **Live and Control.** `o` in the full-screen viewer inspects the generated tests a viewer follows; Orbit Control shows
  an investigation's generated tests, their designs and frozen cases, and the limits a generation is held to.
- **Native acceptance.** `node acceptance/run.mjs` takes an example project on two stacks (RabbitMQ, NATS JetStream)
  through the real CLIs from nothing, in every planted-defect variant, and holds every generated test and every security
  control to `acceptance/truth.json`, with no container, network, volume or secret left behind.

## 0.0.4

- Reusable, governed skills (ADR 0030). A generated playbook may DECLARE its workflow (`workflow.json`,
  `orbit.skill-workflow/v1`): steps, each a capability the playbook needs, typed input bindings, typed outputs, an output
  contract, evidence, retries, a timeout, an approval -- data the engine interprets, never code. Validation refuses any
  undeclared field, cycles, unsafe bindings, recursion, bounds past their limits and a step no owner gate can serve, and
  a dry run carries the workflow over typed stand-ins.
- The coordinator RUNS a declared playbook at its playbook step: pinned to one version for the whole run, each step
  recorded before it is asked, its provider picked by the resolver at that moment, every call through the MCP broker
  (now reading only for these calls) or the capability pipeline -- `invokeBound`, the door `invokeNeed` uses. A step is
  VERIFIED only by a record its owner proves; a call that answered within its contract is reported. Reconcile closes an
  interrupted read as INTERRUPTED and anything that may have written as AMBIGUOUS, never replayed.
- Goals plan from a validated structured `intent` (category, work kinds, capabilities, verification, dependencies,
  missing prerequisites) instead of English keywords: the same goal in Vietnamese and in English plans the same. Units
  declare their routing intent (`automation start --intent=`) and their goal (`--goal=<goal>:<unit>`, linked back); a
  unit a missing prerequisite blocks is unresolved and never started; planning again writes `plan-2`.
- Skill discovery and review: `skill-factory discover --for=<capability>` (REUSABLE with its pin, or which gap it is --
  a provider present but not ready here is now an ENVIRONMENT_GAP), `workflow <id|pin>`, `runs <id>` and `review <id>`,
  read from the project's coordinated workflows; a review proposes a successor and never writes one.
- Orbit Live draws a declared run nested under its plan step -- the pinned version, each step's word, its tool, the
  provider it went through, how long, its retries and the approval it waits for -- and NOW names the step being
  carried. The feed sends one `skill-view` per pin; `planViewOf` is the one projection of a plan the pane, the Plan view,
  `live status --json` (new `plan` field) and Mission Control share. Mission Control: `GET …/tasks/:id/plan`, a Plan card
  on a workflow's page, and a declared skill's workflow, runs and review on its Automation page.
- Hardening: a coordinated workflow's journal is its engine's alone -- what it reads back (steps, plans, pins, runs,
  goals, a child task) and every non-person line need the coordinator's door or Control's, so a terminal can no longer
  forge them; `automation settle` and `reconcile` load the project's capabilities as `step` does.

## 0.0.3

- Orbit Live's orbit turns the whole time a viewer is open (ADR 0029), in every state of the task -- ORBITING, IDLE,
  WAITING, BLOCKED, COMPLETED, DISCONNECTED -- on the viewer's own monotonic clock, never on evidence. The badge's word
  is still the indicator's, moved only by evidence (ADR 0022); the orbit changes only its satellite's tone, peach while
  the task moves and grey otherwise. `pane.animation: off` keeps it still, and the new `pane.orbitSpeed` (slow,
  normal, fast) sets its pace.
- The orbit is geometry: a planet and a satellite on an ellipse of Braille dots, sampled a dot at a time
  (`src/live/orbit/`), in three sizes -- the header's (5 cells, 3 in a narrow pane), the badge's (3) at the same angle,
  and a 9×3 one in the middle of a viewer waiting for its task. The satellite is brighter in front of the planet than
  behind it, a dim track draws the ring where there is colour, and ASCII has frames of its own.
- An orbit tick draws only the rows that hold the orbit (`orbitFrameOf`): `live tui` keeps its one paint and adds no
  timer, a tick costs about 0.03 ms against 0.4-2 ms for the whole frame it drew before, and a terminal that has not
  drained skips a tick, never a line. `test/perf/live-orbit.bench.mjs` measures it; `live tui` itself spent about
  0.35% of a core more with the orbit turning than still.
- The screen is a table of REGIONS (`src/live/tui/regions.mjs`): top, body, bottom. Beside an AI CLI on bands the rules
  under the header and over the footer give way to the bands, as Orbit Live's look draws them.
- The pane, closer to its look: the badge has edges, peach while the task orbits and the indicator's colour otherwise;
  the tabs are each key over its label with the view's words over two rows, one row where everything fits, and two rows
  of three in a pane of 40 to 55 columns so no label is cut; NOW's labels share one column; a header names a task's
  kind (`engineering`, `workflow`); below 60 columns the header keeps the badge whole and the footer is compact.
- `live pane`'s `orbit` is `{ moving, revMs, variant, rings }`: Claude Code's docked pane turns the header's two
  orbits at one angle, in every state, on its own clock, with a border round the badge in the state's colour.
- Tests in a real pseudo-terminal: left alone the viewer draws many header frames with one clear of the screen, and
  `q`, Ctrl+C and SIGTERM each give the terminal back and end the process.

## 0.0.2

- Orbit Live's pane as drawn (ADR 0028): a bordered badge on the header (the orbit, a dot, `ORBITING`) with the
  workflow's age, the views' keys over their labels with the view's words beside them, `TASK EXECUTION` with `NOW` on
  its right, the baseline as a bordered card, the step in focus in the brand's tone, a workflow's milestones under the
  step whose turn it was, progress bars on the right edge and a status bar spread across the width -- in a terminal and
  in Claude Code's docked pane alike. `live pane` adds `headerParts`, a row's `box` and a view's `hint` (version 2).
- `live tui` draws every frame of the orbit while it turns, instead of one a second.
- The release skill lists all eleven gates `ship.mjs` runs.
- Found by running a consumer-style project end to end (six cases, ui · api · sql): a pretty-printed `eval` result is
  read whole; a `${PARAM}` in an api match stands for the map's templated segment; an exclusion may name the
  `technique` that settles a security obligation (plan schema, optional); effect coverage asks only controls that
  commit; a log or report outside the checkout prints whole; `init`, `draft write` and `qa-plan` say what is next.
- Antigravity CLI 1.4.2's file tools (`read_file`, `write_file`, `edit_file`) are observed, with captures; a command
  whose result a host did not report shows `not reported` in the trail, never failed; a host session's missing browser
  names its own run directory.
- Windows: one checkout is one id whatever way its path is spelled (the file system's own real path, so a short 8.3
  name and its long form agree); text checks out with LF and frontmatter is read across CRLF; the anchor git reads an
  empty config file of its own instead of the null device; process ancestry is asked the way a cold machine answers.
- A hook Claude Code delivers twice is one call: its `tool_use_id` is now the call's delivery key, as Codex's and
  Grok's are.
- CI runs `ship.mjs --ci`: native host acceptance is awaited there (`wait`), never failed; a release still requires it.
  The pane's own test runner is `skills/orbit-release/pane-check.mjs`, so `node --test` leaves it alone.

## 0.0.1

Orbit's first open-source release, under the MIT License ([LICENSE](LICENSE)): plugin `orbit`, skills `orbit-*`, CLI `orbit`, store `~/.orbit`, configuration `ORBIT_*`. Repository: [cuongngoht/orbit](https://github.com/cuongngoht/orbit).

- Goal orchestration (`orbit`, `src/goal/`, API `orbit.goal/v1`).
- Orbit Help (`orbit-help`) for navigation and bounded coordination.
- Direct extension API `orbit.extension/v2` and capability API `orbit.capability/v1`.
- Fresh-install-only layout 3 storage, MCP state schema 3 and automation settings schema 3.
- Unsupported state and contracts are refused unchanged; no automatic conversion or aliases.
- Orbit Live's terminal look (ADR 0027): a palette at 256 or 24-bit colour with bands (none on a light background), tabs under the header, an orbit that circles only while the task moves, and `ORBITING` as the moving state's word. The starship lane and `pane.starship` are gone.
- `/orbit` opens Orbit Live as `/orbit-help` does.
