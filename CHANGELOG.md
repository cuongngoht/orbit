# Changelog

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
