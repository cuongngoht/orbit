# Changelog

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
