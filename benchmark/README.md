# The Orbit benchmark

Benchmark cases that say what Orbit must do. Each case runs against the source of the branch you are on, in Docker,
and is judged by a verifier that shares nothing with what it judges. There are two kinds of case:

- **Source cases** hold Orbit's own source to independent checks. A case that fails on a cause it declares repairable
  can be handed to Orbit itself, with `--repair`: a real coding host (Claude Code, in a runner container) drives
  Orbit's own autonomous engineering loop on one engineering task, and the verifier judges the candidate in fresh
  containers.
- **QA cases** ask whether Orbit's autonomous QA *finds* a defect planted in an application. Orbit's engine sets the
  application up on an isolated sandbox of its own, beside the controller. A real coding host works one investigation
  over it from a runner container, through a relay. The verdict comes from the engine's own journal and the case's
  ground truth, and each contradiction counts only once the clean application passes the same test.

This is development tooling. It never ships (`.gitattributes` export-ignores `benchmark/`), and nothing in `src/`,
`cli/` or `skills/` imports it (`test/benchmark-lint.test.mjs`). The design and its reasons are in
[ADR 0046](../docs/adr/0046-a-docker-benchmark-holds-orbits-source-to-independent-checks.md) (the benchmark and its
source cases) and [ADR 0047](../docs/adr/0047-a-qa-benchmark-asks-whether-autonomous-qa-finds-a-planted-defect.md)
(its QA cases).

## Layout

```
benchmark/
  run.mjs                         the command line; its usage header is its contract
  lib/core/                       what every run shares: suites and their cases, freezing the source, mutations,
                                  the run's room, the task door, Docker, images, the runner container, the sentinel
  lib/source/                     a source case: verification, the judge, SCOPE, CAUSES, NEXT, repair rounds, report
  lib/qa/                         a QA case: the engine beside the controller, the relay and its client, the scripted
                                  hosts, the judge, the flow, the report, and the applications a case may name
  lib/commands.mjs                the COMMANDS table, dispatching each kind of case
  images/runner/                  the coding host (Claude Code, pinned): entry.mjs, inspect.mjs, preflight.mjs
  images/verifier/                the source cases' probes and gates, and the egress proxy (egress.mjs)
  images/qa-worker/               the browser a QA case's generated page tests drive, in the engine's sandbox
  suites/<suite>/suite.json       a suite: { schema, id, version, title, cases: [<CASE-ID>, …] }
  suites/<suite>/<case-id>/       one case, its directory the case id in lower case
```

Two suites ship:

| Suite | Cases | What they ask |
|---|---|---|
| `orbit-source` | `ORBIT-SRC-001`, `ORBIT-SRC-002` | Does Orbit's acceptance oracle hold to its promises? |
| `orbit-qa` | `ORBIT-QA-001` … `ORBIT-QA-007` | Does Orbit's autonomous QA find the defect planted in the invoice application, without false alarms? |

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

Every command takes `--json`. Runs are kept in the machine store under `<store>/benchmark/<bnr-…>/`, and
`ORBIT_STORE_DIR` moves them as it moves the rest of the store. `node benchmark/run.mjs where` lists them.

## Outcomes

| Outcome | Exit | Means |
|---|---|---|
| `PASS` | 0 | Source: every hidden check and every gate held, on both verifications. QA: every planted defect was found, each by a test the clean application passes, with no false alarm and at least the case's coverage. |
| `REPAIRED_VERIFIED` | 0 | The candidate passes the hidden checks and the gates. Its own regression test fails before the change and passes after it. Its changes stay inside the scope. |
| `FAIL` | 1 | Source: a failure that stands; under the `controlled-fault` variant it was planted, and the report says so. QA: a planted defect was missed, a test contradicted the clean application too, or too little was tested. |
| `REPAIR_REJECTED` | 1 | The engineering task ended, and the verifier did not pass what it left. |
| `NO_PROGRESS` | 1 | Two attempts in a row failed with one signature. |
| `BUDGET_EXHAUSTED` | 1 | No round, minute or dollar is left for another round. |
| `BENCHMARK_INVALID` | 2 | The case's own reference model failed its self-test, or what the run froze changed under it. This is work on the benchmark, not on Orbit. |
| `REFUSED` | 2 | Bad usage, a dirty tree with no `--source`, or a fault that no longer matches the source (`FIXTURE_DRIFT`). |
| `BLOCKED` | 3 | Docker, an image, a credential, the provider, the network or a sandbox: an environment, never a defect in Orbit. |
| `INCONCLUSIVE` | 4 | Source: two verifications of one source disagreed. QA: a contradiction could not be confirmed on the clean application. |
| `PAUSED` · `CANCELLED` | 4 | A person held the run. A paused run goes on with `resume` once they resume its task in Orbit Control. |

## Source cases

### How a run goes

A run's place is read off its task's journal every time, never kept beside it. That is what makes `resume` safe.

| Stage | What happens |
|---|---|
| `TESTING` | **Baseline**, attempt 1 (`fresh`). The subject is verified twice with the same seed. Two answers that disagree are INCONCLUSIVE, not a defect. |
| `DIAGNOSING` | The `CAUSES` table (`lib/source/classify.mjs`) over what the two verifications showed. Its first matching row is the cause, and its last row always matches. Only a cause the case declares repairable, under `--repair`, opens a round. Everything else ends the run with the verdict it earned. |
| `FIXING` | **Round k**, attempt k+1 (`fix`). The coding host works in the runner container on the run's ONE engineering task: started through `cli/autonomous-engineering.mjs start` in round 1, and named again in every later round. There is never a second task, so a budget cannot be reset by starting one. |
| `REVIEWING` | An inspection container reads back what the round left: the task, its workspace, the session trail. The candidate's changes are held to the `SCOPE` rules. |
| `TESTING` | The candidate is held to the hidden checks. |
| `REGRESSION` | The candidate is held to the gates, and to its own regression test. |

After each round, the `NEXT` table (`lib/source/decide.mjs`) settles what comes next:

- the run completes (`VERIFIED`);
- it stops on `BENCHMARK_CHANGED`, `BLOCKED`, `ENGINE_ENDED`, `NO_PROGRESS` or `BUDGET`;
- or, while the failure keeps changing and the task is open, another round runs on the same task.

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

## Adding a case

A case is a directory of a suite, named by its id in lower case, plus one line in its `suite.json`. Nothing in `lib/`
names a case.

```
suites/<suite>/<case-id>/case.json               the case, held to KINDS (lib/core/suites.mjs): kind source or qa
suites/<suite>/<case-id>/request.md              what a host is asked -- the behaviour, never the fix or the defect
suites/<suite>/<case-id>/verifier/               what only the controller reads: a source case's spec.mjs and
                                                 probe.mjs; a QA case's truth.json
suites/<suite>/<case-id>/variants/<name>.json    a source variant's mutations: { id, file, find, replace, count }
suites/<suite>/<case-id>/controls/<name>.json    a source control's mutations, with the outcome it must earn
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
