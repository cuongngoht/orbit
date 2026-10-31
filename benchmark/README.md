# The Orbit benchmark

Benchmark cases that say what Orbit must do. Each case runs against the source of the branch you are on, in Docker,
and is judged by a verifier that shares nothing with what it judges. There are three kinds of case:

- **Source cases** hold Orbit's own source to independent checks. A case that fails on a cause it declares repairable
  can be handed to Orbit itself, with `--repair`: a real coding host (Claude Code, in a runner container) drives
  Orbit's own autonomous engineering loop on one engineering task, and the verifier judges the candidate in fresh
  containers.
- **QA cases** ask whether Orbit's autonomous QA *finds* a defect planted in an application. Orbit's engine sets the
  application up on an isolated sandbox of its own, beside the controller. A real coding host works one investigation
  over it from a runner container, through a relay. The verdict comes from the engine's own journal and the case's
  ground truth, and each contradiction counts only once the clean application passes the same test.
- **Engineering cases** hand a coding host a GOAL about a small frozen fixture project, with Orbit beside it as the
  plugin: the host takes the goal through Orbit's goal entry, the workflow it starts and the engineering task that
  workflow starts. The source cases' verifier judges what it left, plus record checks on what Orbit's owners say. A
  goal that leaves out the rule it needs must be refused, never invented.

Every kind can be driven by a **scripted host** instead of a model (`images/runner/scripted.mjs`): the same runner, the
same Orbit commands, the same verifier, and no credential. A scripted run proves the controller, the engine and the
verifier -- never a model -- and every report and metric keeps it apart (host basis `scripted`).

This is development tooling. It never ships (`.gitattributes` export-ignores `benchmark/`), and nothing in `src/`,
`cli/` or `skills/` imports it (`test/benchmark-lint.test.mjs`). The design and its reasons are in
[ADR 0046](../docs/adr/0046-a-docker-benchmark-holds-orbits-source-to-independent-checks.md) (the benchmark and its
source cases), [ADR 0047](../docs/adr/0047-a-qa-benchmark-asks-whether-autonomous-qa-finds-a-planted-defect.md)
(its QA cases) and [ADR 0048](../docs/adr/0048-the-benchmark-proves-orbits-self-healing-loop-and-measures-goals.md)
(repair controls, failure classes, engineering cases, metrics and CI tiers).

## Layout

```
benchmark/
  run.mjs                         the command line; its usage header is its contract
  lib/core/                       what every run shares: suites and their cases, freezing the source, mutations,
                                  the run's room, the task door, Docker, images, the runner container, the sentinel,
                                  and metrics.mjs (what the kept runs show)
  lib/source/                     a source or engineering case: verification, the judge, SCOPE, CAUSES, NEXT, repair
                                  rounds, repairs.mjs (candidate controls straight to the judge), the brief, report
  lib/qa/                         a QA case: the engine beside the controller, the relay and its client, the scripted
                                  hosts, the judge, the flow, the report, and the applications a case may name
  lib/commands.mjs                the COMMANDS table, dispatching each kind of case
  images/runner/                  the coding host (Claude Code, pinned): entry.mjs, inspect.mjs, preflight.mjs, and
                                  scripted.mjs (the scripted host a control runs in its place)
  images/verifier/                the source cases' probes and gates, and the egress proxy (egress.mjs)
  images/qa-worker/               the browser a QA case's generated page tests drive, in the engine's sandbox
  suites/<suite>/suite.json       a suite: { schema, id, version, title, cases: [<CASE-ID>, …] }
  suites/<suite>/<case-id>/       one case, its directory the case id in lower case
  fixtures/<app>/                 a project an engineering case is about; its public tests kept as checks/<name>.mjs
                                  and moved to test/<name>.test.mjs in the checkout a run makes
```

Nine suites ship:

| Suite | Cases | What they ask |
|---|---|---|
| `orbit-source` | `ORBIT-SRC-001`, `ORBIT-SRC-002` | Does Orbit's acceptance oracle hold to its promises? |
| `orbit-governance` | `ORBIT-GOV-001` … `006` | Protected boundaries, production as a declaration, the DENY door and approval fingerprints, a policy's strictest verdict, masking by shape, attribution by evidence. |
| `orbit-memory` | `ORBIT-MEM-001` … `006` | Session independence, support across sessions, failure lessons by session, authority derived, freshness, a journal that survives a crash mid-append. |
| `orbit-improvement` | `ORBIT-IMP-001` … `004` | A regression makes a candidate worse, BETTER needs independent sessions, the promotion gates in order, a regression watched by session. |
| `orbit-orchestration` | `ORBIT-ORC-001` … `006`, `ORBIT-GOAL-001` | Impact by reach, completion rows, no progress, decisions refused by name, intent as sent, signatures; two of them are known findings (`baseline: "FAIL"`). |
| `orbit-satellite` | `ORBIT-SAT-001` … `004` | Write permissions, the planning graph, handoffs every consumer validates, a mission concluded on independent evidence. |
| `orbit-verdicts` | `ORBIT-VER-001`, `ORBIT-VER-002` | PASS earned, and a failure classified by an ordered table over demonstrated facts. |
| `orbit-qa` | `ORBIT-QA-001` … `ORBIT-QA-007` | Does Orbit's autonomous QA find the defect planted in the invoice application, without false alarms? |
| `orbit-engineering` | `ORBIT-E2E-001` … `008` | Is a goal taken through Orbit's goal entry to a verified change -- a bug fix, a feature, a change across five modules, a durable write, an idempotent consumer, an escaped note, a session cut off mid-work -- and is a goal with no rule refused? |

A case whose `baseline` is `FAIL` is a **known finding**: the source as it is does not hold the behaviour the case
asks, and the case keeps that as evidence until a repair passes it -- through `--repair`, never by a hand edit here. A
report says "a known finding, still failing" for it, and "REGRESSION" when a case whose baseline is `PASS` fails.

The QA cases plant one defect each in Orbit's own synthetic invoice application (`acceptance/projects/`), on stack
`invoice-a`:

| Case | Planted | What a QA must find |
|---|---|---|
| `ORBIT-QA-001` | `toast-without-persistence` | The page confirms a create the application never stores. |
| `ORBIT-QA-002` | `no-tenant-check` | One tenant reads another tenant's invoice. |
| `ORBIT-QA-003` | `no-db-write` | The reminder worker acknowledges a message and never writes the reminder. |
| `ORBIT-QA-004` | `no-dedupe` | A message delivered twice writes a second reminder. |
| `ORBIT-QA-005` | `early-ack` | The worker acknowledges before its effect, so a crash between them loses it. |
| `ORBIT-QA-006` | `broken-auth` | Every identity is refused, which leaves the permission test inconclusive, never passed. |
| `ORBIT-QA-007` | `correct` | Nothing. Every contradiction is a false alarm, and at least half the plan must be tested. |

## Quick path

1. **Prepare.**
   - You need Node 20 or later, git, and a running Docker engine (`docker info` answers).
   - For `--repair` and for a QA `run`, you also need a credential for the coding host, exported in your shell:
     `ANTHROPIC_API_KEY`, or `CLAUDE_CODE_OAUTH_TOKEN`. It is handed to the runner container by NAME only, never
     written into an image, an argument, a file or a log.
   - `ANTHROPIC_BASE_URL` points the host at another endpoint; that endpoint's host becomes the only one the runner
     can reach.
   - Behind a network that inspects TLS, give the proxy's CA bundle with `--ca-file=<pem>` (or
     `ORBIT_BENCHMARK_CA_FILE`).
   - Run `node benchmark/run.mjs doctor` to see what is missing. `doctor --preflight` also runs the subject's own
     declared checks (`npm run lint`, `npm run test`) in the runner container, with no host.
2. **Build once.**
   - `node benchmark/run.mjs build` builds three images:
     - `verifier`, built with no network;
     - `runner`, with Claude Code at a pinned version;
     - `qa-worker`, from the official Playwright image pinned by digest, plus the browser CLI Orbit drives.
   - `--verifier`, `--runner` or `--qa-worker` builds one of them.
   - Each is tagged by the digest of its directory under `images/` and reused by id until that directory changes.
     `--rebuild` forces a rebuild.
   - No image holds any Orbit source: the source arrives as a mount, so a new commit needs no rebuild.
3. **Run.**
   - `node benchmark/run.mjs list` shows the suites, their cases, what each runs on, and their controls.
   - `node benchmark/run.mjs run ORBIT-SRC-001` runs the source as it is. It should PASS, and nothing is changed.
   - `node benchmark/run.mjs run ORBIT-SRC-001 --variant=controlled-fault` plants faults in the run's own copy of the
     source. It should FAIL, and the report labels the failure as planted.
   - `node benchmark/run.mjs run ORBIT-SRC-001 --variant=controlled-fault --repair` hands the failure to Orbit.
   - `node benchmark/run.mjs run ORBIT-QA-001` has a coding host investigate the application with its defect planted.
   - `node benchmark/run.mjs controls ORBIT-QA-001` runs the same case with each scripted host instead: the verifier
     must credit the reference host and refuse the idle and false-alarm hosts. No model is needed.
   - `node benchmark/run.mjs controls ORBIT-SRC-002` holds a source case to all its controls: the verifier's, then
     every repair control -- a reference candidate the judge must pass and each way of cheating it must refuse by
     name, then a scripted host repairing the known finding through Orbit's own engineering loop.
     `--only=<control>` runs one; `--skip-engine` leaves out the scripted-host runs.
   - `node benchmark/run.mjs run ORBIT-E2E-001` hands a coding host the case's goal about its fixture project.
     `controls ORBIT-E2E-001` runs it with scripted hosts instead: a reference goal through Orbit's goal entry must
     PASS, and an idle host must make NO_PROGRESS.
   - `node benchmark/run.mjs run --suite=orbit-qa` runs every case of a suite.
   - With uncommitted changes to what is measured, a run is refused until you say which tree to measure:
     `--source=head` (HEAD, without them) or `--source=worktree` (HEAD and them). Nothing is reset, stashed or written
     in your checkout.
4. **Read the result.**
   - `node benchmark/run.mjs status <bnr-…>` and `report <bnr-…>` show the outcome. The report is written into the
     run's room as `report.md` and `report.json`.
   - Each repair round leaves `rounds/<k>/candidate.patch`. A QA run leaves the judged rows in `judged.json`, and the
     investigation's own journal in the run's engine store.
   - The run is an Orbit task (provider `benchmark`), so Orbit Live and Mission Control show its stages. A person can
     pause or cancel it, there or with `node cli/task.mjs pause|cancel <task> --human --expect=<revision>`. The task's
     door then refuses the run's next step, and the controller stops with nothing of its own left running. A paused
     run goes on with `resume` once the person resumes its task in Orbit Control.
5. **Run it again.**
   - `node benchmark/run.mjs run --like=<bnr-…>` uses the same case, variant, host, source mode, seed, limits and images.
   - A plain `run` on a newer commit reuses the images and freezes the new source.
   - `node benchmark/run.mjs resume <bnr-…>` carries an interrupted run on from where its journal says it stands.
6. **Clean up.**
   - `node benchmark/run.mjs cleanup <bnr-…>` removes the run's containers and networks, found by the run's own label
     and nothing else.
   - `--scratch` also removes its scratch trees. The evidence stays.
7. **Measure.**
   - `node benchmark/run.mjs metrics` folds the kept runs into numerators over denominators, apart by host basis
     (`none`, `scripted`, `coding-host`). `--suite`, `--case` and `--since` narrow it; `--by=revision` adds each case's
     outcome by source commit (see [Metrics](#metrics)).

Every command takes `--json`. Runs are kept in the machine store under `<store>/benchmark/<bnr-…>/`, and
`ORBIT_STORE_DIR` moves them as it moves the rest of the store. `node benchmark/run.mjs where` lists them.

## Outcomes

| Outcome | Exit | Means |
|---|---|---|
| `PASS` | 0 | Source: every hidden check and every gate held, on both verifications. QA: every planted defect was found, each by a test the clean application passes, with no false alarm and at least the case's coverage. Engineering: the goal was reached and verified -- or, for a goal with no rule, refused with nothing delivered and every behaviour as it was. |
| `REPAIRED_VERIFIED` | 0 | The candidate passes the hidden checks and the gates. Its own regression test fails before the change and passes after it. Its changes stay inside the scope. |
| `FAIL` | 1 | Source: a failure that stands; under the `controlled-fault` variant it was planted, and the report says so. QA: a planted defect was missed, a test contradicted the clean application too, or too little was tested. |
| `REPAIR_REJECTED` | 1 | The engineering task ended, and the verifier did not pass what it left. An engineering case says `FAIL`. |
| `NO_PROGRESS` | 1 | Two attempts in a row failed with one signature, or a round left exactly the candidate an earlier round left. |
| `BUDGET_EXHAUSTED` | 1 | No round, minute or dollar is left for another round. |
| `BENCHMARK_INVALID` | 2 | The case's own reference model failed its self-test, or what the run froze changed under it. This is work on the benchmark, not on Orbit. |
| `REFUSED` | 2 | Bad usage, a dirty tree with no `--source`, or a fault that no longer matches the source (`FIXTURE_DRIFT`). |
| `BLOCKED` | 3 | Docker, an image, a credential, the provider, the network or a sandbox: an environment, never a defect in Orbit. |
| `INCONCLUSIVE` | 4 | Source: two verifications of one source disagreed. QA: a contradiction could not be confirmed on the clean application. |
| `PAUSED` · `CANCELLED` | 4 | A person held the run. A paused run goes on with `resume` once they resume its task in Orbit Control. |

Every outcome that is not a pass also carries a **failure class**, so a run says WHY in one of a fixed set of words
(`FAILURE_CLASSES`, `lib/source/classify.mjs`): `ORBIT_SOURCE_DEFECT`, `BENCHMARK_DEFECT`, `VERIFIER_DEFECT`,
`ENVIRONMENT_BLOCKED`, `PROVIDER_FAILURE`, `INFRASTRUCTURE_FAILURE`, `NON_DETERMINISTIC`, `INSUFFICIENT_EVIDENCE`,
`BUDGET_EXHAUSTED`, `HUMAN_APPROVAL_REQUIRED` or `UNKNOWN`. A goal that is not met is an outcome, not a class.

## Source cases

### How a run goes

A run's place is read off its task's journal every time, never kept beside it. That is what makes `resume` safe.

| Stage | What happens |
|---|---|
| `TESTING` | **Baseline**, attempt 1 (`fresh`). The subject is verified twice with the same seed. Two answers that disagree are INCONCLUSIVE, not a defect. |
| `DIAGNOSING` | The `CAUSES` table (`lib/source/classify.mjs`) over what the two verifications showed. Its first matching row is the cause, its `class` the failure class, and its last row always matches. Only a cause the case declares repairable, under `--repair`, opens a round. Everything else ends the run with the verdict it earned. |
| `FIXING` | **Round k**, attempt k+1 (`fix`). The coding host works in the runner container on the run's ONE engineering task: started through `cli/autonomous-engineering.mjs start` in round 1, and named again in every later round. There is never a second task, so a budget cannot be reset by starting one. |
| `REVIEWING` | An inspection container reads back what the round left: the task, its workspace, the session trail. The candidate's changes are held to the `SCOPE` rules. |
| `TESTING` | The candidate is held to the hidden checks. |
| `REGRESSION` | The candidate is held to the gates, and to its own regression test. |

The causes, in the table's order, and the class each comes to:

| Cause | Class | When |
|---|---|---|
| `BENCHMARK_INVALID` | `BENCHMARK_DEFECT` | the frozen case or subject changed under the run |
| `VERIFIER_INVALID` | `VERIFIER_DEFECT` | the case's own reference model fails its self-test, or the probe could not read its own inputs |
| `ENVIRONMENT` · `CREDENTIALS` | `ENVIRONMENT_BLOCKED` | Docker, an image, the network or a credential |
| `INFRASTRUCTURE` | `INFRASTRUCTURE_FAILURE` | a verifier container on the SUBJECT was refused, ran out of time or memory, or never exited |
| `PROVIDER` | `PROVIDER_FAILURE` | the host never started, or its session ended in an error before one tool call |
| `BUDGET_EXHAUSTED` | `BUDGET_EXHAUSTED` | no round, minute or dollar is left |
| `INSUFFICIENT_EVIDENCE` | `INSUFFICIENT_EVIDENCE` | a verification did not complete |
| `NON_DETERMINISTIC` | `NON_DETERMINISTIC` | two verifications of one tree with one seed disagree |
| `CAPABILITY_MISSING` | `ORBIT_SOURCE_DEFECT` when the case declares it repairable, else `UNKNOWN` | the subject lacks an export the case needs |
| `ORBIT_SOURCE_DEFECT` | `ORBIT_SOURCE_DEFECT` | the hidden checks fail identically twice, or the subject does not load |
| `GATE_UNEXPLAINED` | `UNKNOWN` | the hidden checks hold and a gate fails |
| `PASS` | -- | everything held |
| `UNKNOWN` | `UNKNOWN` | nothing above (the last row always matches) |

A candidate's own time and memory are its own failure: a candidate whose hidden checks did not answer in time is
REJECTED (`hidden:probe:TIMEOUT`), its gates are not run, and it is never read as an environment that blocked.

After each round, the `NEXT` table (`lib/source/decide.mjs`) settles what comes next, first matching row wins:

| Row | Then |
|---|---|
| `BENCHMARK_CHANGED` | `BENCHMARK_INVALID` -- nothing judged after the change counts |
| `VERIFIED` | `REPAIRED_VERIFIED` (an engineering case: `PASS`), and `verified.json` is written |
| `BLOCKED` | the environment, the provider or the infrastructure stopped the round |
| `WAITING_FOR_PERSON` | the engineering task waits for a person's approval (`HUMAN_APPROVAL_REQUIRED`): a benchmark never approves |
| `ENGINE_ENDED` | the engineering task ended and the verifier does not pass what it left: `REPAIR_REJECTED` |
| `REPEATED_CANDIDATE` | the round left exactly the candidate an earlier round left, failing exactly as it did: `NO_PROGRESS` |
| `CUT_SHORT` | the round was stopped at its deadline with its task still open, and budget is left: another round on the same task |
| `NO_PROGRESS` | the candidate fails exactly as the attempt before it did |
| `BUDGET` | `BUDGET_EXHAUSTED` |
| `CONTINUE` | the failure changed and the task is open: another round on the same task, with what the verifier saw |

Each round's decision is kept in `rounds/<k>/outcome.json`: its signature and patch digest, the hidden groups and gates
that held before and fail now (`regressed`) or failed before and hold now (`improved`), an engineering case's record
checks, and the row that matched. A round's cost is kept with its basis: `REPORTED` when the host said it, `ESTIMATED`
when it did not -- an estimate only ever refuses a round, and never counts as a cost anywhere else.

When `NEXT` says `VERIFIED`, `verified.json` keeps the verified candidate as evidence, and only as evidence: the source
commit and digest, the case and its digest, the variant, the baseline's signature and failing groups, the engineering
task and the commit it made in the runner store, the host basis with what the host REPORTED, the candidate patch and
its digest, the changed files, the hidden, gate and regression-test results, and the commands that reproduce it in a
scratch clone. Nothing is ever applied to your checkout: that stays a person's act, at the protected boundary for a
primary checkout write.

A person's pause or cancel is read every 15 seconds while a round's container runs: the container is stopped and
removed by its label, and the round is read back on `resume`, never sent again.

A run interrupted anywhere is carried on by `resume`:

- an action that never settled is closed as interrupted;
- a verification, which changes nothing, runs again as a new action;
- a repair round is never sent again: its containers are removed by label, and what it left is read back and judged.

### What a run freezes

`manifest.json` holds everything below. The baseline and every candidate are judged with the same values.

- **Source:** branch, commit, mode (`head` or `worktree`), the uncommitted paths at freeze time, the digest of the
  whole tree, and what was skipped.
- **Subject:** the measured tree, which is the source without the benchmark's own files, with any planted mutations.
  It is recorded with its digest, the clean digest without them, and the fixed commit of the checkout made from it.
  The checkout has one commit and no history, so the original source and the faults cannot be read from its history.
- **Benchmark:** suite, case and version, the variant, the digest of the case as copied into the run, and the digest
  of the harness.
- **Environment and limits:** image ids, the Claude Code version, the Docker version, the seed, the model asked for,
  and the limits in effect. The model the host actually ran is read from its own init event.

### The containers

| Container | Image | Network | Mounts | Credential |
|---|---|---|---|---|
| runner | runner | the run's internal network; the egress proxy is its only way out | the subject checkout (read-only), the run's runner store (read-write), its out directory, the brief (read-only) | by name only |
| egress | verifier | the run's internal network, plus the default bridge | none | none |
| inspect | runner | none | the checkout and the runner store (both read-only), its out directory | none |
| probe | verifier | none | the tree under test and the case's probe (both read-only) | none |
| gate · agent | verifier | none | a fresh copy of the tree under test (read-write) | none |

Every container has:

- a read-only root, a `/tmp` tmpfs, every capability dropped and `no-new-privileges`;
- an init process, and CPU, memory and PID limits from the case;
- a label naming its run.

No container gets the Docker socket, your home directory, your store or your checkout. Before a container starts, it is
attested against Orbit's own isolation `PROFILE` rows, plus two of the benchmark's own (`RUNS_AS_DECLARED`,
`IMAGE_PINNED`). A container that does not hold to them is removed unstarted. Its deadline is enforced by the
controller: when the time runs out the container is stopped and removed, whatever is running inside it. Exit codes and
OOM kills are read from `docker inspect`, never from what a process printed.

The egress proxy (`images/verifier/egress.mjs`) passes a CONNECT only to port 443 of the hosts allowed for the run. That
is the model's API, and nothing else. Before the host runs, the runner checks this in four ways, and a round whose
network does not hold to all of them never starts the host:

- a direct connection fails;
- no outside name resolves;
- the allowed host answers through the proxy;
- a host nobody allowed is refused.

### Why the verifier can be believed

- **The judge never imports candidate code.** The probe runs the subject's code and prints raw answers. The judge
  (`lib/source/judge.mjs`, with the case's frozen `verifier/spec.mjs`) runs in the controller, so a candidate can only
  make its own answers right by computing them.
- **The probe is given inputs only.** Expectations are never sent to it.
- **Inputs are seeded.** They include negative, zero, decimal, boundary and large values. Both "must refuse" and "must
  accept" cases are present, so an oracle that allows everything and one that refuses everything both fail.
- **Gates run on the tests the subject had.** Every existing test file is restored to the subject's own version
  before a gate runs, and a gate must run as many tests as the subject's run did.
- **Regression tests are proved, not trusted.** The candidate's own tests must fail on the subject and pass on the
  candidate.
- **`SCOPE` refuses by name, before anything runs:** a path outside the case's scope, the harness itself, how a check
  runs, a deleted, weakened or skipped test, a process or the global object brought into the source, a new import, a
  file that is not regular text, and a candidate with no regression test.
- **Bytes are matched to their digests.** Every byte a candidate brings must match the digest the inspection
  reported.
- **The frozen case and subject are re-checked.** Their digests are checked before and after every round. A change
  ends the run as `BENCHMARK_INVALID`.
- **Nothing a host says is evidence.** A "done", a self-reported PASS, or a field in the runner's output is never
  evidence.

### Repair controls: the self-healing loop, proved without a model

A source case may declare `repairs[]`: candidate controls, each a definition in `controls/<id>.json` -- the exact edits
a candidate would make (`mutations`, each matching exactly `count` times), the files it brings (as `lines`, so no test
file ever sits under `benchmark/`) and the files it deletes -- with the outcome it must earn and, when it must be
refused, the names that must refuse it (`rejects`). Each is carried one of two ways:

- **`through: "judge"`** -- the candidate built from its definition over the run's own copy of the variant, with no
  runner and no host, then held to `SCOPE`, laid over the subject and verified in the verifier's containers with its
  regression test run before and after it, and judged by the very rule a round's candidate is (`lib/source/repairs.mjs`).
- **`through: "engine"`** -- a whole `run --repair` whose host is `scripted:<id>`: the scripted host drives the round's
  ONE engineering task through `cli/autonomous-engineering.mjs` -- context, environment, workspace, plan, implement,
  the edits, record-changes, each required check, commit, review -- in the runner container with no network and no
  credential, and the unchanged inspection, candidate assembly, verification and `NEXT` judge it.

`ORBIT-SRC-001` and `ORBIT-SRC-002` carry the set. What each control must come to:

| Control | Carried | Must come to |
|---|---|---|
| `reference` | judge, engine | `REPAIRED_VERIFIED`: a real repair with a regression test that fails before it and passes after |
| `delete-test` · `weaken-test` · `skip-test` | judge | refused by `TEST_DELETED`, `TEST_WEAKENED`, `TEST_SKIPPED` |
| `edit-harness` · `edit-check` | judge | refused by `BENCHMARK_TOUCHED`, `CHECK_TAMPERED` |
| `smuggle-global` · `new-import` · `out-of-scope` | judge | refused by `UNSAFE_CODE`, `NEW_IMPORT`, `OUT_OF_SCOPE` |
| `no-regression-test` · `test-passes-before` | judge | refused by `NO_REGRESSION_TEST`, and by `agent:passes-before` -- a "regression test" that does not discriminate |
| `partial-repair` | judge | refused: hidden checks still fail |
| `hang` | judge | refused by `hidden:probe:TIMEOUT` -- a candidate that never answers is REJECTED, never BLOCKED |
| `fake-success` | judge | refused: the source untouched, a test that only prints a passing summary -- nothing printed is evidence |
| `idle` | engine | `NO_PROGRESS`: a host that changes nothing is never passed |

`controls <case>` runs them all (and `--only=<id>` one); `test/benchmark-repairs.test.mjs` runs every judge control of
every case through a Docker double, and `test/benchmark-scripted-host.test.mjs` the scripted host over Orbit's real CLIs.

## QA cases

### How a run goes

| Stage | Phase | What happens |
|---|---|---|
| `ENVIRONMENT` | `benchmark.target` | The application is assembled from the run's frozen copy with the case's variant planted, and committed. Orbit's engine, run from the frozen checkout beside the controller, seats it in a store of the run's own and records its system graph. What a person sets in Orbit Control is set once, the way `acceptance/run.mjs` sets it: autonomous QA enabled with its tenancy contract, the sandbox policy (isolation required, the QA worker image, the writes a test may make on its own fixture), and each fingerprint the sandbox asks to be trusted. Then the task's isolated sandbox is prepared and started, and ONE investigation is opened on it. |
| `TESTING` | `benchmark.qa` | The host's round. For `run`, it is a coding host in the runner container; for a control, it is one of the scripted hosts (below). |
| `REVIEWING` | `benchmark.readback` | Every dispatch that never settled is reconciled, and the investigation is finished if its host did not finish it. What it came to is read off the engine's journal: each test shape's latest verification, as the engine decided it from its own check of the worker's envelope. The sandbox is released. |
| `REGRESSION` | `benchmark.confirm` | Each design that contradicted the planted application is replayed on the clean one: same design, new sandbox, new investigation. A contradiction counts as a defect found only when the clean application satisfies the same design. |

The verdict is an ordered table (`lib/qa/judge.mjs`):

1. **BLOCKED** when the environment kept a planted defect's test from running.
2. **FAIL** on a false alarm.
3. **FAIL** on a planted defect not found.
4. **FAIL** when coverage is under the case's `minCoverage`.
5. **INCONCLUSIVE** when a contradiction could not be confirmed.
6. **PASS** otherwise.

A shape the environment blocked is neither coverage nor a miss. A contradiction the ground truth does not list, but
that the clean application does not share, is reported as found beyond it.

`resume` never re-sends the host's round. A round that started and never settled is closed as interrupted, its runner
is stopped by the run's label, and what it left in the investigation is read back and judged. The setup and the
confirmation change nothing anyone measured, so they are done again. A round the provider blocked is spent all the
same: once the credential or the provider is fixed, run the case again with `run --like=<bnr-…>`.

### What the coding host sees, and what it never does

The engine runs beside the controller because an isolated sandbox needs Docker, and no container of the benchmark is
ever given a Docker socket. The coding host reaches the investigation through a **relay** made of two directories:

- `requests/`, which the runner writes;
- `responses/`, which the runner can only read.

In the plugin the host is given, `cli/autonomous-qa.mjs` is the relay's client (`lib/qa/relay-client.mjs`), so the
`orbit-qa` skill's own commands work unchanged. The controller answers each request through the engine, one at a time,
only for the run's own investigation, as the `RELAY` table allows (`lib/qa/relay.mjs`):

- the subcommands a host works with: `context`, `step` (a decision on stdin), `derive`, `checkpoint`, `reconcile`,
  `show`, `report --json`, `investigate`, `reproduce`, `draft`, `draft-plan` (a plan on stdin), `finish` and
  `resume`;
- never a person's approval (`settings`, `answer`, `release`, `cancel`);
- never a second investigation (`plan`), and never the browser of an environment (`explore`, `act`, `check-data`,
  `security`);
- never a path. A `--decision` or `--file` is read on the client's side and sent as stdin.

A request that is not a regular file of a request's size is removed unread. The log keeps each request's subcommand,
flags, and the size and digest of its decision, never the decision itself: the engine's own journal keeps that.

The host is handed:

- the plugin, without the case's withheld paths. Those are the ground truth, acceptance's reference designs and the
  one test that names a variant; every QA case withholds the same set, so what is missing says nothing of what is
  planted;
- the application's public material: its accepted requirement (`contracts/pbi.md`), its contracts, and its accepted
  plan;
- a request that is the same for every QA case, plus the investigation's id.

It never sees the application's source, where the variant is planted, and it cannot reach the application itself:
every test it designs runs in the sandbox, through the engine. Its network reaches only the model's API, as in a
repair round.

### The controls: the verifier, proved without a model

`node benchmark/run.mjs controls <ORBIT-QA-…>` runs the case once with each scripted host (`lib/qa/hosts.mjs`). Each
host goes through the same relay admission, the same engine and the same judge as a coding host.

| Host | What it does | The verdict it must earn |
|---|---|---|
| `reference` | Designs every test obligation the engine owes with acceptance's own designs. | PASS |
| `idle` | Tests nothing and finishes the investigation. | FAIL |
| `false-alarm` | Uses the reference designs, but one of them reads back a record nothing writes, so it contradicts the clean application too. The broken design is the one the application names (`falseAlarm` in `TARGETS`): a test that runs to a verdict whatever is planted, so the false alarm shows in every case. | FAIL |

## Engineering cases

An engineering case asks whether a GOAL is taken end to end: through Orbit's goal entry, the coordinated workflow its
step starts, and the engineering task that workflow starts, to a change an independent verifier passes -- or, for a goal
that leaves out the rule it needs, to a refusal with nothing delivered.

### How a run goes

- **The target** is a fixture project (`fixtures/<app>/`, named by the case's `fixture`) with the case's `real` variant
  applied: a definition like a repair control's (mutations, files, deletes) that takes one behaviour away and deletes
  the public tests that would reveal it. It is checked out as a one-commit repository with no history of the clean
  fixture. A fixture's public tests are kept as `checks/<name>.mjs` and moved to `test/<name>.test.mjs` in the checkout,
  so nothing under `benchmark/` is a test file.
- **The plugin** is Orbit's own frozen source without the harness, mounted read-only at `/work/orbit` beside the target
  at `/work/repo`. No task is started for the host: the goal's own step starts what it needs.
- **The baseline** is verified twice, as a source case's is. A goal that asks for a change must start from a target
  that fails the hidden checks (`measures.expects: "change"`, `baseline: "FAIL"`); a goal that must be refused, from one
  that holds them (`expects: "blocked"`, `baseline: "PASS"`). Anything else is `BENCHMARK_INVALID`.
- **A round** hands the host the goal (the case's `request.md`), where a change may go, and the budget left -- never a
  hidden input, an expected answer or a failing check. A later round adds only the BEHAVIOURS (the spec's own group
  sentences) the verifier still saw fail. Nobody answers questions: a rule the goal leaves out is to be recorded as a
  missing prerequisite that blocks the change, and the host stops.
- **The verdict** is the source cases' -- the hidden probe checks from a reference model written from the goal, the
  project's public tests as gates, the host's own regression test before and after, `SCOPE` (with the case's
  `scope.imports`, so a feature may import its sibling modules) -- plus **record checks** on what Orbit's owners say,
  read back by the inspection through Orbit's own commands:
  - a goal for a change: the change was delivered by an engineering task that COMPLETED on its own journal's proof;
  - a goal with no rule: the goal's plan left the change UNRESOLVED for a missing rule, and no engineering task
    completed a change;
  - and whatever the case's spec adds (`records(readBack)`).

  A record check reads an owner's word about its own state and never judges code. Whether the task came through a goal
  -- a goal whose workflow is the engineering task's parent -- is reported, OBSERVED, beside the verdict.

### The cases

| Case | The goal | Its controls |
|---|---|---|
| `ORBIT-E2E-001` | discounted totals round half up to the nearest minor unit, in the money module and the API | reference, idle |
| `ORBIT-E2E-002` | an open order can be cancelled through the API; every other route keeps its contract | reference, cheat (deletes a test), idle |
| `ORBIT-E2E-003` | orders kept and shown in their own currency, across money, orders, API, view and invoices | reference, half (verifier), idle |
| `ORBIT-E2E-004` | a payment's invoice is on disk before the payment is acknowledged | reference, idle |
| `ORBIT-E2E-005` | a payment delivered more than once has one effect, across a restart | reference, idle |
| `ORBIT-E2E-006` | an order keeps a note, read back and after a restart, and the view draws it escaped | reference, half (verifier), idle |
| `ORBIT-E2E-007` | ORBIT-E2E-004's goal, with the first round cut off mid-work (`interrupt`) | interrupted, idle |
| `ORBIT-E2E-008` | a loyalty discount with no rule for who is loyal or how much: refused, never invented | blocked, inventor, idle |

### Scripted hosts for a goal

| Script | What it does |
|---|---|
| `goal` | `orbit.mjs goal start` with the goal, `analyze` (one change), `plan`, `step`; then the workflow the step started, step by step in its own plan's order (`automation.mjs context`, `step`, and `settle` for the engineering step with the task as its evidence), driving that engineering task through its loop with the control's edits; then `goal resume` and `verify` |
| `blocked` | the same entry, with the analysis naming a missing prerequisite that blocks the change: the plan leaves it unresolved, the goal's step starts nothing, and the script stops |
| `interrupt` | `goal`, except that its first round SIGKILLs its own first check the moment the engineering task's journal shows the action open -- the way a crash leaves it. The next round finds the same goal and task, reconciles the open action (closed as interrupted, no outcome taken from it), runs the check again as a new action and goes on |
| `idle` | nothing at all |

A case's `interrupt: { round, afterMinutes }` cuts that round's runner at its minute for a coding host; a scripted host
interrupts itself at a moment it can name. The round after a cut is `CUT_SHORT` or `CONTINUE`, on the same task. Every
container of a run's runner store goes by one host name, so a later round can ask whether the process an earlier round
recorded still runs.

## Metrics

`node benchmark/run.mjs metrics` is a pure fold over the kept runs' own records -- `manifest.json`, `ending.json`,
`report.json`, `rounds/<k>/outcome.json` -- newest 500, written nowhere (`lib/core/metrics.mjs`). Each metric is a
numerator over a denominator with the runs it left out by why (BLOCKED, BENCHMARK_INVALID, INCONCLUSIVE, PAUSED,
CANCELLED), and `unknown` -- never 0 -- when nothing qualifies. Each is computed apart for host basis `none`
(verification only), `scripted` and `coding-host`: a scripted PASS proves the controller, and is never autonomy.

| Metric | Numerator over denominator |
|---|---|
| `autonomous_task_success` | coding-host runs that reached PASS or REPAIRED_VERIFIED, over coding-host runs that ended in a verdict |
| `self_healing_success` | REPAIRED_VERIFIED, over runs with at least one repair round |
| `defect_detection` | planted faults that FAILed (controlled-fault source runs, planted QA defects found), over those judged |
| `false_positive` | QA false alarms and verifier controls that failed what should PASS, over those judged |
| `regression` | candidates whose `regressed` is not empty, over candidates judged |
| `human_intervention` | runs whose task shows a pause, resume, cancel or approval, over runs whose report says |
| `avg_repair_rounds` | rounds, over runs with at least one round |
| `avg_time_to_verified_ms` | time from freeze to ending, over verified outcomes |
| `cost_per_verified_usd` | REPORTED cost, over verified outcomes whose every round reported one (an ESTIMATED cost never counts) |

Beside them: **reproducibility** (groups of runs with one case digest, variant, subject digest, host basis and model,
two or more of them valid, that came to one outcome -- and the groups that did not), the **verifier's own controls**
from every kept `controls.json`, and with `--by=revision` each case's outcomes by source commit. A known finding
(`baseline: "FAIL"`) that still fails is never counted as a regression.

## CI tiers

| Tier | Where | What |
|---|---|---|
| fast | `ci.yml`, every push and pull request | every `test/benchmark-*.test.mjs` inside the definition of done's `node --test`: no Docker, no network |
| conformance | `benchmark.yml`, a pull request that touches the benchmark, or on request | every case's verifier and judge controls in real containers, by suite; scripted hosts through Orbit's engineering loop and goal entry; no model, no secret |
| autonomous | `benchmark.yml`, only when a person dispatches it | a real coding host on one case or one suite with `--repair`, from the `benchmark` environment that holds the credential, inside a budget the person gives (at most 50 USD and 5 rounds); a missing credential ends it BLOCKED |

Every tier uploads what its runs kept, PASS or not. Nothing model-backed runs on a push.

## Adding a case

A case is a directory of a suite, named by its id in lower case, plus one line in its `suite.json`. Nothing in `lib/`
names a case.

```
suites/<suite>/<case-id>/case.json               the case, held to KINDS (lib/core/suites.mjs): source, qa or engineering
suites/<suite>/<case-id>/request.md              what a host is asked -- the behaviour, never the fix or the defect
suites/<suite>/<case-id>/verifier/               what only the controller reads: a source case's spec.mjs and
                                                 probe.mjs; a QA case's truth.json
suites/<suite>/<case-id>/variants/<name>.json    a source variant's mutations: { id, file, find, replace, count }
suites/<suite>/<case-id>/controls/<name>.json    a source control's mutations; a repair control's or an engineering
                                                 case's definition: { mutations, files: [{ rel, lines }], deletes }
```

**A source case.**

1. Write `case.json`: `kind: "source"`, `id`, `version`, `title`, `goal`, `measures` (what it measures, and which
   causes are `repairable`), `subject` (the paths it reads, and the exports the probe needs), `request`, `reproduce`,
   `acceptance` (owner `verifier`, `spec`, `probe`, `samples`), `scope` (`allow`, `deny`), `checks` (the repository's
   gates as argument lists, plus `agentTests`), `limits`, `artifacts`, `cleanup`, `variants` and `controls`.
2. Write the spec. `cases(seed, samples)` returns `{ id, group, input, expect }`, where `expect` is `has`, `lacks` or
   `exactly` over a list of ids. `selfTest()` returns `[]` when the reference model agrees with a table written by hand;
   anything else makes the case `BENCHMARK_INVALID`.
3. Write the probe. It prints `{ "answers": [{ "id", "got": [ids] }] }`, or `{ "error": { "code" } }` (`IMPORT`,
   `MISSING_EXPORT`) when the subject cannot answer. It never sees an expectation.
4. Prove the checks discriminate: a control that must PASS and controls that must FAIL (a planted fault, a partial
   fix, allow-all and reject-all), with `node benchmark/run.mjs controls <case>`, and without Docker in a
   `test/benchmark-*.test.mjs`.
5. Plant faults only in mutation files. A mutation must match exactly `count` times, or the run is refused as
   `FIXTURE_DRIFT`; a fault that does not make the baseline fail is a benchmark that is wrong.
6. Say what the source as it is comes to: `baseline: "PASS"`, or `"FAIL"` for a known finding -- with a `known-good`
   control that PASSes, so the case can be passed at all. `test/benchmark-cases.test.mjs` holds every source case of
   every suite to its baseline, its controls and its reference model, without Docker.
7. Optionally, `repairs[]`: candidate controls carried to the judge or through the engine (see
   [Repair controls](#repair-controls-the-self-healing-loop-proved-without-a-model)), each with the outcome it must earn
   and, when it must be refused, the names that must refuse it.

**An engineering case.**

1. Write `case.json`: `kind: "engineering"`, the common fields, `baseline`, `fixture` (a directory of `fixtures/`),
   `measures` (`kind: "engineering"`, a `capability`, `expects: "change" | "blocked"`), `subject` (the target's paths the
   probe imports, and their exports), `reproduce`, `acceptance`, `scope` (with `imports`), `checks` (the target's public
   tests as explicit files, and `agentTests`), `limits`, `artifacts`, `cleanup`, `variants` (`real`, and `solved` -- the
   clean fixture -- for a change), `controls` and `repairs` (`through: "engine"`, a `script` of `goal`, `blocked`,
   `interrupt` or `idle`, and `expect` one of `PASS`, `FAIL`, `NO_PROGRESS`, `BLOCKED`). `interrupt` is optional.
2. Write the goal as a person would: the behaviour, never the fault. Every behaviour a hidden check holds must be said.
3. Write the spec and probe as for a source case. The probe imports the target's own modules and uses a store of its own
   under the container's `/tmp`. Let each group judge the fields its sentence is about (`has`), so a half-made change
   fails only what it left out. `records(readBack)` may add record checks.
4. Prove it: `solved` PASSes, `real` FAILs (or, for a goal to refuse, `real` PASSes and an invented change FAILs), the
   public tests pass on the target, and every scripted control that must PASS leaves a tree that holds every hidden
   check and public test, with a regression test that fails before it and passes after --
   `test/benchmark-cases.test.mjs` holds all of it without Docker; `controls <case>` runs it in containers.

**A QA case.**

1. Write `case.json`: `kind: "qa"`, the common fields, and `target`:
   - `app` (an application `lib/qa/invoice.mjs` `TARGETS` names);
   - `stack`, `variant` (the defect planted) and `clean` (the variant with nothing planted);
   - `plan` (the accepted plan the investigation is held to) and `mode`;
   - `withheld` (the globs the host's plugin never carries).

   Then `acceptance` (`truth`, `minCoverage`), `limits` (`rounds`, `minutes`, `usd`, the `runner`'s box and the
   `engine`'s `stepSeconds` and `callSeconds`), `cleanup` (with `sandbox: "release"`) and `controls`
   (`{ id, host, expect }`).
2. Write `verifier/truth.json`: `{ schema, from: { file, stack, variant }, default, shapes, expect }`, the engine's own
   outcome words per shape. `test/benchmark-qa-cases.test.mjs` holds each truth to `acceptance/truth.json`.
3. Keep the request the same for every case on one application. Name no variant and no shape in it.
4. Prove the verifier with `node benchmark/run.mjs controls <case>`: reference must PASS; idle and false-alarm must
   FAIL.

Keep hidden things hidden. The subject handed to a runner never contains `benchmark/` or `test/benchmark-*.test.mjs`,
and a QA host's plugin never contains what its case withholds. Documentation elsewhere in the repository does reach
the runner, so it describes the mechanism only: never a fault, a planted variant, a hidden input or a fix
(`test/benchmark-qa-cases.test.mjs` checks every file a QA plugin would carry).

## Known limits

- **Container user.** Containers run as the invoking user's uid:gid, so a run's room stays owned by that user. On a
  host where the benchmark runs as root, the containers run as root too, still with a read-only root, no capabilities
  and `no-new-privileges`. Run the benchmark as an ordinary user, or under a rootless engine.
- **The credential is visible to the runner.** Code running in the runner can read its own environment, so the
  credential is visible to whatever the host runs there. That is why the runner is the only container that gets it,
  and why its network reaches only the model's API.
- **The sentinel.** When a run ends, its room is searched for every secret the run handed out: the coding host's
  credential, and a QA run's sandbox tokens. It looks for each value as typed, in base64 and percent-encoded. Any file
  that holds one is masked in place, or removed when it cannot be rewritten, and is named in `leaks.json`, in the
  report and on the command line (`LEAK`). Links are never followed. The subject checkout and the frozen case, which
  were copied from your own files, are not rewritten. A QA run resumed in a new process makes new tokens, and the old
  ones are not kept anywhere, so they cannot be looked for.
- **TLS inspection.** On a network that inspects TLS, the runner and its build, and the QA worker's build, need
  `--ca-file`. The CA is a build secret and a read-only runtime mount, never a layer of an image.
- **The QA worker's browser.** The browser CLI's own Playwright may name a Chromium revision a release from the one
  the Playwright image ships. The build links the revision it names to the one that is there, and prints the link.
- **The QA engine runs beside the controller.** It is Orbit's own engine from the frozen checkout, acting on the
  coding host's decisions within its own gates, with the run's own store. The host never gets a Docker socket; the
  engine's sandbox does the isolating, as it does for any Orbit user.
- **Reported, not proven.** The host's model, turns, cost and tool calls, and for a source repair whether the work went
  through Orbit, are read from what the host and the agent could also write. The report marks them REPORTED, and an
  unreported number is `unknown`. The verdict never rests on them. A QA host's requests are OBSERVED instead: the
  relay logged each one.
- **No promotion evidence.** A benchmark run's own engineering task lives in the run's runner store, and a QA run's
  investigation in its engine store. Neither is an independent session for learning or self-improvement, and neither
  passes a promotion gate.
- **Scripted is not autonomous.** A scripted host's PASS shows that the controller, Orbit's loops and the verifier work
  together, on the edits its control defines. It says nothing of what a model would do; only a `coding-host` run does,
  and only with a credential. Where none is set, a repair or goal run with a real host ends BLOCKED, and its command is
  in the report.
- **A goal's own verdict.** An engineering case's verdict rests on the verifier. What the goal says of itself (`goal
  verify`) is read, never trusted; a goal whose units' tasks ended may still say it is partial, and a case keeps such a
  finding apart as a source case of its own.
- **An interrupted check's lock.** A step killed mid-run leaves its task's lock behind; Orbit breaks it once it is stale
  (a minute), so the round after an interruption waits that long before it reconciles.
