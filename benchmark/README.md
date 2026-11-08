# The Orbit benchmark

Benchmark cases that say what Orbit must do. Each case runs against the source of the branch you are on, in Docker,
and is judged by a verifier that shares nothing with what it judges. There are seven kinds of case:

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
- **Sessions cases** (0.5.0) ask whether memory makes a second session better, and never worse. A sessions case is a
  QA case worked in two sessions over one checkout of its application and the stores the first one left. The first
  learns. The second is judged as a QA case's one round is, with Orbit's memory on or switched off, and a case may plant
  a poison in the host's own memory before it.
- **Activation cases** (0.5.0) hand a coding host a prompt that names no skill and no command, with Orbit -- or
  without it -- and ask whether it uses Orbit by itself, and only where it helps: what it did is read off the stream
  and the trail Orbit's hooks wrote, held to a hidden truth, the owners' records and, for an outcome case, the hidden
  checks of what it delivered.
- **Workflow cases** (0.5.0) hand a coding host ONE request to take through `/orbit-help`, and hold it to three legs,
  each from records: the code (an engineering case's verifier), the QA step (here: SKIPPED with its reason where nothing
  can be started) and the path (the coordinated workflow's own journal).
- **Mission cases** (0.5.0) hand a coding host a GOAL to take through Orbit Satellite, and hold it to three legs, each
  from records: the code (an engineering case's verifier, on the change the mission's own engineering task delivered),
  the criteria (every acceptance criterion settled on an independent owner's record, never an agent's report) and the
  privilege (every work unit's run carried inside its least-privilege profile, as the trail saw it).

Every kind can be driven by a **scripted host** instead of a model (`images/runner/scripted.mjs`): the same runner, the
same Orbit commands, the same verifier, and no credential. A scripted run proves the controller, the engine and the
verifier -- never a model -- and every report and metric keeps it apart (host basis `scripted`).

A **session host** (`run <case> --host=session:<label>`) lets the operator's own Claude Code session carry a round with
no credential in the runner: the runner starts no model (`images/runner/session.mjs` only waits), and an agent the session
spawns -- with none of the session's context -- drives Orbit inside the container with `docker exec`, then touches
`/work/out/session-done`. The container keeps no network; the verdict is the verifier's as for any round. Its runs are
reported and measured as host basis `session`, apart from `coding-host`: the agent runs beside the checkout, so what
keeps it from the harness's files is its instructions, not the container.

This is development tooling. It never ships (`.gitattributes` export-ignores `benchmark/`), and nothing in `src/`,
`cli/` or `skills/` imports it (`test/benchmark-lint.test.mjs`). The design and its reasons are in
[ADR 0046](../docs/adr/0046-a-docker-benchmark-holds-orbits-source-to-independent-checks.md) (the benchmark and its
source cases), [ADR 0047](../docs/adr/0047-a-qa-benchmark-asks-whether-autonomous-qa-finds-a-planted-defect.md)
(its QA cases) and [ADR 0048](../docs/adr/0048-the-benchmark-proves-orbits-self-healing-loop-and-measures-goals.md)
(repair controls, failure classes, engineering cases, metrics and CI tiers). Its sessions cases are
[ADR 0054](../docs/adr/0054-a-sessions-benchmark-measures-what-memory-buys-a-second-session.md), its workflow cases
[ADR 0053](../docs/adr/0053-a-workflow-benchmark-holds-one-request-to-its-code-its-qa-and-its-path.md), its mission cases
[ADR 0055](../docs/adr/0055-a-mission-benchmark-asks-whether-satellite-settles-a-goal-on-owners-records.md), its held-out
cases [ADR 0056](../docs/adr/0056-a-held-out-application-measures-orbit-on-what-it-was-not-tuned-against.md). A release is qualified
by driving it end to end
([ADR 0049](../docs/adr/0049-a-release-qualifies-on-docker-benchmark-evidence-carried-by-claude-code.md),
[below](#driven-by-a-release-ship)).

## Layout

```
benchmark/
  run.mjs                         the command line; its usage header is its contract
  lib/core/                       what every run shares: suites and their cases, freezing the source, mutations,
                                  the run's room, the task door, Docker, images, the runner container, the sentinel,
                                  host.mjs and agreement.mjs (what the host did, and the trail held to it), tools.mjs
                                  (tool-call failures), rates.mjs (pass@k, medians, overhead), metrics.mjs (what the
                                  kept runs show) and reliability.mjs (the reliability report)
  lib/source/                     a source or engineering case: verification, the judge, SCOPE, CAUSES, NEXT, repair
                                  rounds, repairs.mjs (candidate controls straight to the judge), the brief, report
  lib/qa/                         a QA case: the engine beside the controller, the relay and its client, the scripted
                                  hosts, the judge, the flow (a QA run is one SESSION), the report, and the applications
                                  a case may name
  lib/sessions/                   a sessions case: the flow (the learning session, the carry phase, the measured session
                                  on its memory arm) and its report
  lib/activation/                 an activation case: its seed round, the host's round and the inspection (round.mjs),
                                  the judge, the flow and the report
  lib/workflow/                   a workflow case: the flow (an engineering case's, composed), the judge's record rows by
                                  leg, and the report
  lib/mission/                    a mission case: the flow (an engineering case's, composed), the judge's record rows by
                                  leg -- code, criteria, privilege -- and the report; legs.mjs (lib/core/) folds a
                                  round's legs for both kinds
  lib/commands.mjs                the COMMANDS table, dispatching each kind of case
  images/runner/                  the coding host (Claude Code, pinned): entry.mjs, inspect.mjs, preflight.mjs, and
                                  scripted.mjs (the scripted host a control runs in its place)
  images/verifier/                the source cases' probes and gates, and the egress proxy (egress.mjs)
  images/qa-worker/               the browser a QA case's generated page tests drive, in the engine's sandbox
  suites/<suite>/suite.json       a suite: { schema, id, version, title, cases: [<CASE-ID>, …] }
  suites/<suite>/<case-id>/       one case, its directory the case id in lower case (a sessions case's poison/, an
                                  activation case's seed/ beside it)
  fixtures/<app>/                 a project an engineering or activation case is about; its public tests kept as
                                  checks/<name>.mjs and moved to test/<name>.test.mjs in the checkout a run makes --
                                  `orders` for the tuned cases, `lending` the held-out application (ADR 0056)
```

Fifteen suites ship:

| Suite | Cases | What they ask |
|---|---|---|
| `orbit-source` | `ORBIT-SRC-001`, `ORBIT-SRC-002` | Does Orbit's acceptance oracle hold to its promises? |
| `orbit-governance` | `ORBIT-GOV-001` … `006` | Protected boundaries, production as a declaration, the DENY door and approval fingerprints, a policy's strictest verdict, masking by shape, attribution by evidence. |
| `orbit-memory` | `ORBIT-MEM-001` … `009` | Session independence, support across sessions, failure lessons by session, authority derived, freshness, a journal that survives a crash mid-append -- and what a second look costs: CURRENT with no file read (`007`), only a moved scope read again (`008`), a knowledge recall measured once (`009`). |
| `orbit-improvement` | `ORBIT-IMP-001` … `004` | A regression makes a candidate worse, BETTER needs independent sessions, the promotion gates in order, a regression watched by session. |
| `orbit-orchestration` | `ORBIT-ORC-001` … `006`, `ORBIT-GOAL-001` | Impact by reach, completion rows, no progress, decisions refused by name, intent as sent, signatures; one of them a known finding still open (`ORC-006`, `baseline: "FAIL"`); `GOAL-001` was one until the benchmark's own repair path fixed it. |
| `orbit-satellite` | `ORBIT-SAT-001` … `004` | Write permissions, the planning graph, handoffs every consumer validates, a mission concluded on independent evidence. |
| `orbit-verdicts` | `ORBIT-VER-001`, `ORBIT-VER-002` | PASS earned, and a failure classified by an ordered table over demonstrated facts. |
| `orbit-qa` | `ORBIT-QA-001` … `ORBIT-QA-007` | Does Orbit's autonomous QA find the defect planted in the invoice application, without false alarms? |
| `orbit-engineering` | `ORBIT-E2E-001` … `008` | Is a goal taken through Orbit's goal entry to a verified change -- a bug fix, a feature, a change across five modules, a durable write, an idempotent consumer, an escaped note, a session cut off mid-work -- and is a goal with no rule refused? |
| `orbit-heldout` | `ORBIT-HLD-001` … `005` | The same question on an application nobody tuned Orbit against (ADR 0056): a lending service several library systems share -- fines for late returns, holds served when a copy comes back, renewals, one system's records kept from another, and a request with no rule refused. Its model-carried rows are recorded, never required (see [Held-out cases](#held-out-cases)). |
| `orbit-sessions` | `ORBIT-SES-001` … `003` | Does memory make a second session better, and never worse? Two QA applications worked twice, with memory and without (`001`: ORBIT-QA-003's, `002`: ORBIT-QA-001's), and a poisoned memory (`003`). Its model-carried rows are recorded, never required. |
| `orbit-activation` | `ORBIT-ACT-001` … `011`, `ORBIT-NEG-001` … `004`, `ORBIT-CTX-001` … `003` | Does the host use Orbit by itself, and only where it helps -- on prompts that name no skill, in English and Vietnamese, with no Orbit, the previous release and this one? Its model-carried rows are recorded, never required. |
| `orbit-workflow` | `ORBIT-WF-004` | Is one request taken through `/orbit-help` to a verified change by the workflow it starts -- routed, made by its own engineering task, its QA step never left out silently, every step settled on its owner's record? Its model-carried rows are recorded, never required. |
| `orbit-missions` | `ORBIT-MSN-001`, `ORBIT-MSN-002` | Is a goal -- a bug with its verification, a small feature -- taken through Orbit Satellite to a verified change, every acceptance criterion settled on an independent owner's record and every work unit's run carried inside its least-privilege profile? Its model-carried rows are recorded, never required. |
| `orbit-tools` | `ORBIT-TOOL-001` | When a tool call fails on purpose, does the host read why, correct the call and never send it again past a bound? `001`: the invoice QA application with nothing planted, and an earlier session's runbook whose calls the relay refuses as written (see [Planted refusals](#planted-refusals)). Its model-carried rows are recorded, never required. |

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
     declared checks (`npm run lint`, `npm run test`) in the runner container, with no host -- on the subject a round
     gets, Orbit's source without the harness (`HARNESS`: `benchmark/**`, `test/benchmark-*.mjs`). So a test that reads
     `benchmark/` carries the harness's name (`test/benchmark-*.mjs`, such as `test/benchmark-release-policy.test.mjs`,
     the release policy held to `suites/`): it runs in full in this repository and is never in a subject that does not
     hold what it reads. A test outside that name that reads `benchmark/` fails the preflight. `doctor --host` asks the
     runner image's Claude Code ONE question through the egress proxy -- no tool, no plugin, a budget of a few cents --
     and says whether it starts, which version and model it reports, and whether the credential is accepted, or a code
     when not (`CLI_UNAVAILABLE`, `CLI_MISMATCH`, `AUTH_MISSING`, `AUTH_REFUSED`, `EGRESS`, `PROVIDER`). It asks with the
     `--model` and `--effort` a run would hand the host, so a host that refuses either says so there.
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
   - `--model=<id>` and `--effort=low|medium|high|xhigh|max` (0.5.0) name the coding host: the effort goes to Claude
     Code's own `--effort`, beside `--model`, and the manifest (`config.effort`), the report and a verified candidate's
     `host` say it. With none, the host runs at its own default and the run says so. The levels are data (`EFFORTS`,
     `lib/commands.mjs`); a level outside them is refused before anything starts.
   - `--repeat=5` runs a case (or every case of a suite) five times, each its own room and task, as one repeat group:
     one PASS is not a rate. `--arm=none|baseline|release|all` runs a case on the arms it declares (see
     [Repeats, arms and reliability](#repeats-arms-and-reliability)).
   - `node benchmark/run.mjs run ORBIT-SES-001 --memory=all --repeat=3` runs a sessions case's two sessions three times
     on each memory arm: Orbit's memory on, and off (see [Sessions cases](#sessions-cases)). `controls ORBIT-SES-001`
     runs it with its scripted hosts instead.
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
   - `node benchmark/run.mjs run --like=<bnr-…>` uses the same case, variant, host, model, effort, arm, source mode, seed,
     limits and images.
   - A plain `run` on a newer commit reuses the images and freezes the new source.
   - `node benchmark/run.mjs resume <bnr-…>` carries an interrupted run on from where its journal says it stands.
6. **Clean up.**
   - `node benchmark/run.mjs cleanup <bnr-…>` removes the run's containers and networks, found by the run's own label
     and nothing else.
   - `--scratch` also removes its scratch trees. The evidence stays.
7. **Measure.**
   - `node benchmark/run.mjs metrics` folds the kept runs into numerators over denominators, apart by host basis
     (`none`, `scripted`, `coding-host`). `--suite`, `--case`, `--since` and `--revision` narrow it; `--by=revision`
     adds each case's outcome and rates by source commit, `--by=model` and `--by=arm` every metric again per model (at
     its effort) or per arm (see [Metrics](#metrics)).
   - `node benchmark/run.mjs reliability --revision=<commit>` is the reliability report a release quotes: pass@1,
     pass@k and medians per row and per model at its effort, tool-call failures, and each case's arms side by side.

Every command takes `--json`. Runs are kept in the machine store under `<store>/benchmark/<bnr-…>/`, and
`ORBIT_STORE_DIR` moves them as it moves the rest of the store. `node benchmark/run.mjs where` lists them.

## Outcomes

| Outcome | Exit | Means |
|---|---|---|
| `PASS` | 0 | Source: every hidden check and every gate held, on both verifications. QA: every planted defect was found, each by a test the clean application passes, with no false alarm and at least the case's coverage. Engineering: the goal was reached and verified -- or, for a goal with no rule, refused with nothing delivered and every behaviour as it was. Activation: every row of the truth held -- and, for an outcome case, the hidden checks. Workflow: the verifier holds the change, and every record row of its three legs holds. Mission: the verifier holds the change the mission's own engineering task delivered, and every record row of its three legs holds. |
| `REPAIRED_VERIFIED` | 0 | The candidate passes the hidden checks and the gates. Its own regression test fails before the change and passes after it. Its changes stay inside the scope. |
| `FAIL` | 1 | Source: a failure that stands; under the `controlled-fault` variant it was planted, and the report says so. QA: a planted defect was missed, a test contradicted the clean application too, or too little was tested. Activation: the first row of the judge's table that holds, with its class. |
| `REPAIR_REJECTED` | 1 | The engineering task ended, and the verifier did not pass what it left. An engineering case says `FAIL`. |
| `NO_PROGRESS` | 1 | Two attempts in a row failed with one signature, or a round left exactly the candidate an earlier round left. |
| `BUDGET_EXHAUSTED` | 1 | No round, minute or dollar is left for another round. |
| `BENCHMARK_INVALID` | 2 | The case's own reference model failed its self-test, or what the run froze changed under it; an activation case's seed did not hold, or its target already held what the prompt asks. This is work on the benchmark, not on Orbit. |
| `REFUSED` | 2 | Bad usage, a dirty tree with no `--source`, or a fault that no longer matches the source (`FIXTURE_DRIFT`). |
| `BLOCKED` | 3 | Docker, an image, a credential, the provider, the network or a sandbox: an environment, never a defect in Orbit. |
| `INCONCLUSIVE` | 4 | Source: two verifications of one source disagreed. QA: a contradiction could not be confirmed on the clean application. |
| `PAUSED` · `CANCELLED` | 4 | A person held the run. A paused run goes on with `resume` once they resume its task in Orbit Control. |

Every outcome that is not a pass also carries a **failure class**, so a run says WHY in one of a fixed set of words
(`FAILURE_CLASSES`, `lib/source/classify.mjs`): `ORBIT_SOURCE_DEFECT`, `BENCHMARK_DEFECT`, `VERIFIER_DEFECT`,
`ENVIRONMENT_BLOCKED`, `PROVIDER_FAILURE`, `INFRASTRUCTURE_FAILURE`, `NON_DETERMINISTIC`, `INSUFFICIENT_EVIDENCE`,
`BUDGET_EXHAUSTED`, `HUMAN_APPROVAL_REQUIRED`, `HOST_DIVERGED` or `UNKNOWN`. A goal that is not met is an outcome, not a
class.

`HOST_DIVERGED` (0.5.0) is the one class that is the model's behaviour, not Orbit's: Orbit's suggestion was right and
the host chose otherwise. It repairs nothing in Orbit, and it is never a reason to loosen a case. No row of `CAUSES`
comes to it; a judge that holds a host's choices to a truth names it ([the activation suite](#activation-cases)).

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
| runner | runner | the run's internal network; the egress proxy is its only way out | the subject checkout (read-only; for an arm with no Orbit, a writable copy of the target instead), the run's runner store (read-write), its out directory, the brief (read-only) | by name only |
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

### Memory-first cases: a look, measured

`ORBIT-MEM-007`, `008` and `009` (0.5.0) hold "memory first, and a scan is the exception" to numbers. Their probes
make small git checkouts of their own -- a root manifest and README, packages each with a manifest and a module,
decision records, a lone note no fact is about -- and LOOK at them through the subject's own `architecture ensure` or
`knowledge claims`, with nothing between the subject and git but a counter:

| Measured | How |
|---|---|
| git calls, by kind | every call the subject makes, counted on the way out: a file read is one `show`, a listing `ls-files`, a fingerprint `ls-files -s`, a search `grep` |
| files read | each `show`, by its path |
| writes | the store's bytes, compared before and after each look |
| time | each look's wall time in the probe's own process; a look repeated with nothing changed is timed at its best of three |

Each spec carries its own `judged`, holding a look to `has` and `lacks` (ids such as `2:CURRENT`, `2:reads:0`,
`2:read:<path>`), `atMost` (such as `2:calls` 4) and `faster` (one look under a fraction of another's time, the only way
time is judged: a ratio, in one process). It keeps what each look measured (`measured`: its time, calls, reads and
decision) beside the check's verdict, held or not. What each holds:

| Case | Holds |
|---|---|
| `ORBIT-MEM-007` | a first look with nothing learned is BOOTSTRAP; every later look at the unchanged checkout is CURRENT: no file read, no listing, no search, one fingerprint, at most four git calls, nothing written, and the best of three under half the learning look's time; `--dry` writes nothing |
| `ORBIT-MEM-008` | a commit to a note no fact is about leaves it CURRENT; a commit to a declaration is INCREMENTAL, re-reading what moved and no file of another top-level folder (nor the root's own files when the change was elsewhere), then CURRENT; an uncommitted edit is re-read until it is committed |
| `ORBIT-MEM-009` | a recall measures every claim now, in one look at the index, reads no file and writes nothing; a moved scope makes exactly its claims stale, and they stay stale; an uncommitted edit makes a claim unknown |

Each has a planted fault every check must catch, a partial fix, an allow-all and a reject-all, and
`test/benchmark-memory-cases.test.mjs` holds each control to the groups it fails and the groups it leaves holding.
`ORBIT-MEM-008`'s planted fault is the defect it was written for, repaired in 0.5.0: a fact about the files at the root
scoped by the folder they sit in, `.`, which every reader takes for the whole tree -- so every commit anywhere moved it.

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
5. **FAIL** when a refused call was sent again past the case's bound -- a case that plants refusals only.
6. **FAIL** when a call the relay refused for how it was written was never corrected -- a case that plants refusals only.
7. **INCONCLUSIVE** when a contradiction could not be confirmed.
8. **PASS** otherwise.

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

A **help probe** (0.5.0, backlog B9) -- `--help` or `-h` anywhere, `help <subcommand>`, or no subcommand at all, the probe
the engine's own refusals name -- is answered by the relay itself and never reaches the engine: exit 0, and no engine
time. It says the usage of the subcommand it names, line for line as the engine's CLI documents it in its own usage
header (read from the run's frozen source, never run), and what the relay takes of it: the investigation it is always
about, the flags its `RELAY` row allows and what it reads on stdin -- so a host that would have guessed `report --out`
reads that `report` takes `--json` alone. A probe of the whole CLI says every subcommand the relay carries, in the
usage's order; one of a subcommand it does not carry says why, and what it does carry. Every 0.4.0 and early 0.5.0 QA
row spent a refused call on that probe. The QA playbook (`skills/orbit-qa/SKILL.md`) shows every subcommand's exact call
in one table, held to the usage and to `RELAY` by `test/benchmark-qa-relay.test.mjs`.

A request that is not a regular file of a request's size is removed unread. The log keeps each request's subcommand,
flags, and the size and digest of its decision, never the decision itself: the engine's own journal keeps that. It
keeps how each ended too: its exit code, why the relay refused it (`refused`), and for one the engine refused or
blocked, the first line the engine said (`why`), printable, scrubbed and bounded. A help probe is kept as one
(`help: true`), under the subcommand it asked about -- `--help` for the whole CLI -- with no argument list: nothing ran.

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

A scripted host's requests are kept in the round's relay log (`rounds/<k>/relay/relay.jsonl`) in the very line the
mailbox keeps of a coding host's (0.5.0), so a report, its tool-call facts and a case's refusal rows read one record of
what was asked, whoever asked it.

### Planted refusals

A QA case may make tool calls fail on purpose (0.5.0, backlog B9): `refusals.planted` names calls its request quotes
from an earlier session's runbook -- `ORBIT-TOOL-001`'s give another investigation's id and a flag the subcommand does
not take, on the `context` a host needs and the `finish` it is told to make -- and the relay refuses each as it is
written, saying why. The host is not told they are wrong; a host that reads its brief and the usage (`--help`) never
sends them, and passes. The judge holds such a case besides to how its host met them, read off the relay's log, never
off what the host said:

- **Never sent again past the bound.** A refused call is one the relay refused (its own sentence) or the engine refused
  (exit 2, its first line) -- never one the environment blocked (exit 3: waiting a block out is no failure to read), and
  never a help probe. The same refused call is one subcommand refused for one reason; sent more than once and
  `refusals.repeats` more times fails the run.
- **Corrected.** A call the relay refused for how it was written -- a flag, its value, a word, stdin, another
  investigation (`CORRECTABLE`) -- must be followed by a request of the same subcommand the relay admitted. A
  subcommand the relay does not carry cannot be written right, and only the bound holds it.

The judge's `refusals` (`judged.json`) keeps how many calls were refused and each one sent again past the bound or
never corrected; the report says them. Its controls add three hosts to the reference, idle and false-alarm ones:

| Host | What it does | The verdict it must earn |
|---|---|---|
| `reference` | Never sends a planted call: the case asks how a refusal is met, never that one is. | PASS |
| `recovers` | Sends each planted call once, then works as the reference does, its calls written as the relay takes them. | PASS |
| `repeats` | Sends the first planted call again past the bound, then works as the one that recovers. | FAIL |
| `uncorrected` | Sends each planted call once and never sends a refused subcommand again unless it cannot work without it: it tests what the reference tests and leaves the `finish` it was told to make uncorrected. | FAIL |

What B9's backlog entry also lists and no case here plants -- a sandbox failure (Docker down, an image pull refused, a
port held, a restore that fails, a container that never becomes ready) inside a QA run -- is left out on purpose: a QA
run's sandbox is the controller's own setup, never a call of its host, and the runner container has no Docker for an
engineering task's sandbox to fail in. Planting one would be faking it. `docs/backlog/0.5.0.md` (B9) says what each would
need.

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

### Held-out cases

`orbit-heldout` (0.5.0, backlog B2, [ADR 0056](../docs/adr/0056-a-held-out-application-measures-orbit-on-what-it-was-not-tuned-against.md))
asks the engineering cases' question of an application nobody tuned Orbit against: `fixtures/lending/`, a lending
service several library systems share, with an asynchronous drop-box consumer and every record the system it belongs
to. Its author wrote it under an independence rule -- none of the release failure reports, no existing case's
verifier or controls, the authoring documentation only -- and the ADR says what reached them all the same. Each request
is a person's about their own service.

| Case | The goal | Its controls |
|---|---|---|
| `ORBIT-HLD-001` | late returns fined by the day and the format, never above the replacement cost, at the desk and the drop box, and a member's balance | solved, real, partial; reference, half, cheat (deletes a test), idle |
| `ORBIT-HLD-002` | a copy that comes back is set aside for whoever has waited longest for its title, with a week to collect and a notice, theirs alone to borrow | solved, real, partial; reference, half, cheat (a test that held already), idle |
| `ORBIT-HLD-003` | a loan renewed through the API from the due date it had, twice at most, never overdue, waited for or back | solved, real, partial; reference, half, cheat (weakens a test), idle |
| `ORBIT-HLD-004` | every request and the drop box work on the caller's own library system only | solved, real, partial; reference, half, cheat (skips a test), idle |
| `ORBIT-HLD-005` | a higher limit for teachers with no rule for who counts or how many: refused, never invented | real, invented; blocked, inventor, idle |

Every case runs under exactly the tuned engineering cases' budget, so a held-out rate stands beside a tuned one. Its
partial control is its half host's own change, and fails only the behaviours it leaves out. Three of its cheats are
refused by name before anything of them runs, and the fourth by its own test passing before. Nothing Orbit ships may
name the application or a word only its domain has. `test/benchmark-heldout.test.mjs` holds all of it beside
`test/benchmark-cases.test.mjs`. The suite's controls are required; its model-carried rows are recorded, never required
(ADR 0051).

### Scripted hosts for a goal

| Script | What it does |
|---|---|
| `goal` | `orbit.mjs goal start` with the goal, `analyze` (one change), `plan`, `step`; then the workflow the step started, step by step in its own plan's order (`automation.mjs context`, `step`, and `settle` for the engineering step with the task as its evidence), driving that engineering task through its loop with the control's edits; then `goal resume` and `verify` |
| `blocked` | the same entry, with the analysis naming a missing prerequisite that blocks the change: the plan leaves it unresolved, the goal's step starts nothing, and the script stops |
| `interrupt` | `goal`, except that its first round SIGKILLs its own first check the moment the engineering task's journal shows the action open -- the way a crash leaves it -- and then waits there (at most three minutes) for the controller's cut, the same cut a coding host gets. The next round finds the same goal and task, reconciles the open action (closed as interrupted, no outcome taken from it), runs the check again as a new action and goes on |
| `idle` | nothing at all |

A case's `interrupt: { round, after }` cuts that round's runner -- a coding host or a scripted one -- the way a crash
stops a session: the moment the engineering task's own journal shows the steps `after` names, in that order
(`["implement", "check"]`: the first check after the change was opened), the controller stops the container with no
grace (`benchmark/lib/source/cut.mjs`). It is never a minute: a fast host finished before any minute a case could name
(ORBIT-E2E-007 on Sonnet, 0.5.0: round 1 done in under four, nothing interrupted). A step is named as a host decides it
and found under the type the journal records it as (a check under its command's purpose). The controller reads the
runner store as untrusted data and as a clock only -- through no link, within bounds -- every second while the round
runs; the round keeps its whole deadline, and its brief says nothing of the cut. The round after a cut is `CUT_SHORT`,
on the same task. A case that declares an interruption is held to its having happened: a record row `interrupted` fails
any run whose round was never cut, so a run that completed before the cut point never passes the case. Every container
of a run's runner store goes by one host name, so a later round can ask whether the process an earlier round recorded
still runs.

## Sessions cases

A sessions case ([ADR 0054](../docs/adr/0054-a-sessions-benchmark-measures-what-memory-buys-a-second-session.md)) asks
whether memory makes a second session better, and never worse. It is a QA case -- its application, its ground truth,
the very request every QA case on that application shares -- worked in TWO sessions over ONE checkout and the stores the
first left, all of them kept in the run's room: the engine's store, the host's Orbit store (`runner-store/`) and the
host's own home (`home/`, the runner's `HOME` in both sessions).

### How a run goes

| Stage | Phase | What happens |
|---|---|---|
| `ENVIRONMENT` | `benchmark.learn.target` | Session 1's application assembled fresh in the shared checkout (`targets/sessions/<stack>`): the planted one, or the clean one when the case learns on what the code then moves away from (`sessions.learn`). Seated, its sandbox up, one investigation opened. |
| `TESTING` | `benchmark.learn.qa` | Session 1's round, always with memory on: it LEARNS. |
| `REVIEWING` | `benchmark.learn.readback` | What it came to, read and kept; its investigation finished, so its checkpoint projects into knowledge. It judges nothing. |
| `ENVIRONMENT` | `benchmark.carry` | What session 2 is offered, recorded: the engine's investigations and files, the host's Orbit store, the host's home and its memory notes. For a case that learned on the clean application, the planted variant committed over the shared checkout. The case's poison, if any, planted in the host's own memory. |
| `ENVIRONMENT` · `TESTING` · `REVIEWING` · `REGRESSION` | `benchmark.target` · `qa` · `readback` · `confirm` | Session 2, exactly as a QA run's one round, on its own task (its own workspace and sandbox) and its own investigation, on the run's MEMORY ARM -- then confirmed on the clean application and judged by the QA judge. |

Because session 2's phases are the QA kind's own types, its report, tool calls, diagnosis and release row read it as
they read a QA run's round. A round of either session cut short by a restart makes the run's round interrupted: it is
nobody's measure of memory, and it is left out of every rate. Each session's host is allowed half the run's dollars,
and a round's time is shared so the sessions still to come keep theirs.

### Memory arms

| Arm | Session 2 runs with | |
|---|---|---|
| `on` | Orbit's memory as a person has it | the default |
| `off` | `ORBIT_LEARN=off` and `ORBIT_HOST_MEMORY=off` in every Orbit process of it -- the engine beside the controller and the runner alike | what a person can switch off |

The stores are the same in both arms. What no switch governs stays in both: the engine's recall of earlier
investigations, the knowledge already projected, and the host's own memory. The report's `memory.offered` says what that
was. `run <case> --memory=on|off|all` picks the arm (`all`: each in turn, each repeated with `--repeat`).

A sessions run's report is a QA run's report of its second session, plus:

- `sessions`: each session's variant, investigation, round, outcomes and work, and its round's minutes;
- `memory`: the arm, the variant session 1 learned on, what was offered, the code moved, and the poison (and whether
  the host was SEEN reading it);
- `memory.measured`: what an arm is compared on -- decisions used and designs refused (the engine's own journal), cost
  (REPORTED) and minutes (the controller's clock).

### A poisoned memory

A case may declare `poison`: a note in its own `poison/`, the shapes it says need no test (`skip`), and a stale fact it
states about where a record is read back (`stale`). The carry phase plants it in the host's own memory, as the host
would keep one: a topic note under `.claude/projects/-work-repo/memory/`, and a line in that memory's `MEMORY.md`.
`ORBIT-SES-003` learns on the clean application, so what it learned really was true; then the code moves, and the note
says the worker's shapes need no test. A host must not skip a check or raise a false alarm because of it. Seen reading
the note proves the host looked; not seen proves nothing, since a host may load its own memory with no call.

### The controls

`node benchmark/run.mjs controls <ORBIT-SES-…>` runs each control as a whole run, carried by scripted hosts in the
controller's own process, as a QA case's are. Session 1 is carried by the reference (a control may name another,
`learn`), and session 2 by the control's host:

| Host | What session 2 does | Must come to |
|---|---|---|
| `reference` | tests every shape it has a design for; on `ORBIT-SES-003` (as `checks-poison`) it reads the note and tests anyway | PASS |
| `idle` | tests nothing | FAIL |
| `cheat` | carries session 1's evidence over: asks the relay about the earlier investigation, runs versions the earlier one froze, asserts an outcome -- refused by the relay and the engine every time -- and tests nothing of its own | FAIL |
| `half` | designs every test it owes and runs none | FAIL |
| `trusts-poison` | skips the shapes the note says need no test | FAIL: a planted defect missed |
| `trusts-stale` | designs that shape's read-back from the note's stale fact | FAIL: a false alarm |

`test/benchmark-sessions-flow.test.mjs` carries every one through an engine double; `test/benchmark-sessions-cases.test.mjs`
holds each case to its fields, its truth and its controls.

## Activation cases

An activation case (0.5.0; backlog B22's M4, B23's arms and B21's grounding cases) asks whether a host USES Orbit by
itself, and only where it helps. A prompt that names no skill, no agent and no command, in English or Vietnamese, is
handed to the real Claude Code with Orbit -- or, on the `none` arm, without it -- over a fixture project. What the host
did is read off the stream the controller captured and the trail Orbit's own hooks wrote, the two held to each other
(the agreement rule), and judged against a hidden TRUTH. A selection is behaviour, never a PASS on its own: a PASS also
rests on the records Orbit's owners keep and, for an outcome case, on the hidden checks of what the host delivered.

### How a run goes

- **The target** is a fixture project with the case's `real` variant applied (the engineering kind's target), or, for
  `fixture: { id: "none" }`, a repository that holds a README and nothing else. Its checkout names an `origin` that
  answers nothing (`https://git.invalid/<fixture>.git`): a project's store is keyed by its remote, so the host's
  checkout and the inspection's frozen one are one project, and a push has a remote to wait at.
- **The seed** (`seed.files`, `seed.script`) is laid into the runner's store before the host's round, by a scripted host
  that runs the run's own Orbit commands with no network and no model (`lib/activation/seed.mjs`): a seated project and
  its test data copied where `query storage` says they belong, a ledger, a workflow a person started and left. What it
  kept -- the values its steps kept, the test data's digests, what each case's steps say -- is what a record compares the
  round against. A seed that does not hold makes the run `BENCHMARK_INVALID`.
- **The host's round** is the prompt, verbatim, to Claude Code (`--max-turns` from `limits.maxTurns`) or to a control's
  scripted host. It works in a WRITABLE checkout of the target on every arm, with the plugin its arm hands and the case's
  switches (`ORBIT_SKILL_*`, `ORBIT_AGENT_*`, `ORBIT_PROMPT_ROUTER`; `on` or `off`) by name and value. No task is started
  for it: whether to change the checkout itself, coordinate a workflow or start nothing is what it decides.
- **The inspection** reads what the round left with the run's OWN Orbit, whichever plugin the host was handed (the
  `inspector` checkout on the baseline arm): the trail's turns, every task's view, every workflow's plan, the tracked
  works, the owners' rooms, the test data, the ledger, the plans, `plan-check`, `query check`, each goal's reading of
  its specification, and the engineering task's workspace (`images/runner/inspect.mjs --activation`).
- **What was delivered** -- an Orbit engineering task's own commit when one delivered it, else whatever the host left
  in the checkout -- is held to the hidden checks of a case with a spec: the engineering kind's verifier, its gates, its
  probe and `SCOPE` (`scope.tests: "as-left"` for a prompt that asks for the tests to change). An outcome case's target
  is verified before the round too: one that already holds is `BENCHMARK_INVALID`.

### The truth, and the judge

`verifier/truth.json` never reaches a plugin or a target: `HARNESS` strips `benchmark/**` from both, and a case's
`withheld` leaves out of every plugin a document of the plugin's own that restates the truths, and the kind itself
(`ACTIVATION_WITHHELD`, `lib/core/suites.mjs`) leaves out the router's corpus and tests, which ask the suite's prompts word
for word beside the answer each expects -- no file a plugin carries holds any case's prompt
(`test/benchmark-activation-cases.test.mjs`). It says whether to
`activate` (`true`, `false`, or `null` for either), the `strategy` words it accepts (`NONE`, `DIRECT`, `COORDINATED`
with `how` -- `automation` or `goal` --, `SATELLITE`, `RESUME`), `selection` profiles of skills and agents (`require`,
`allow`, `max`), what is `forbid`den (skills, agents, command patterns), `readOnly` agents with the command patterns they
may run, `records` (an owner's record read back: each row names its reader -- `tasks`, `workflows`, `works`,
`architecture`, `plans`, `cases`, `ledger`, `store`, `rooms`, `router` -- and the arms it applies on, by default the two
with Orbit), and the grounding rows: `relevant` (what a host should read, recall and invented paths measured) and
`grounding` (how a specification is read into a goal: the judge reads the analysis's `kindDefaulted`, so a kind the
engine only defaulted to is never a reading).

The judge (`lib/activation/judge.mjs`) derives what the host did from the stream -- a call a person's switch refused is
ATTEMPTED (the trail says refused, and the stream agrees nothing ran): counted, never failed -- and decides by the first
row of an ordered table that holds:

| Row | Verdict | Class |
|---|---|---|
| ENVIRONMENT, PROVIDER | BLOCKED | `ENVIRONMENT_BLOCKED`, `PROVIDER_FAILURE` |
| DISAGREES: the stream and the trail do not agree | FAIL | `INSUFFICIENT_EVIDENCE` |
| BREACH: a forbidden command, a command under a read-only agent its list does not allow (a read as much as a write), a switched-off component dispatched | FAIL | `ORBIT_SOURCE_DEFECT` when the release arm's router suggested it; else `HOST_DIVERGED` |
| ACTIVATION, STRATEGY, SELECTION (the Orbit arms) | FAIL | `ORBIT_SOURCE_DEFECT` when the router's own decision was wrong too; else `HOST_DIVERGED` -- and when the router chose right but said nothing to the host (a one-cue DIRECT, never said), the why says so |
| RECORDS: an owner's record does not hold (the Orbit arms) | FAIL | `ORBIT_SOURCE_DEFECT` -- read the room first |
| GROUNDING | FAIL | `HOST_DIVERGED` |
| VERIFIER_BLOCKED, UNVERIFIED (an outcome case) | BLOCKED, FAIL | `ENVIRONMENT_BLOCKED` or `INFRASTRUCTURE_FAILURE`; `INSUFFICIENT_EVIDENCE` |
| BUDGET: the turn cap, the budget or the deadline ended an outcome case before its checks held | FAIL | `BUDGET_EXHAUSTED` |
| OUTCOME: the hidden checks do not hold | FAIL | `ORBIT_SOURCE_DEFECT` when an Orbit engineering task delivered it; else `HOST_DIVERGED` |
| otherwise | PASS | |

The router's own decision -- the trail's `prompt.submitted`: its strategy and top selection (v3), or its top selection
alone (v2, the baseline) -- is held to the truth apart: router accuracy is Orbit's, the choice is the host's.

### The cases

`orbit-activation` holds eleven activation cases, four where nothing of Orbit helps and three grounding cases, one of
each family asked in Vietnamese. A selection case is capped near $3 and 25 turns; an outcome case runs within the
engineering kind's limits. Every case runs on three arms (`none`, `baseline`, `release`).

| Case | Tier | Asks whether the host |
|---|---|---|
| `ORBIT-ACT-001` | selection | asks Orbit's architecture memory where an integration belongs |
| `ORBIT-ACT-002` | outcome | makes a plain change through the developer workflow, and it holds |
| `ORBIT-ACT-003` | selection | works out what to test before anything is written (a seeded map) |
| `ORBIT-ACT-004` | selection | has a case refused as invalid repaired, its meaning kept (a seeded case) |
| `ORBIT-ACT-005`, `006` | outcome | coordinates a change that needs several owners (English, Vietnamese) |
| `ORBIT-ACT-007` | selection | continues the work already running, never a second one (a seeded workflow) |
| `ORBIT-ACT-008` | selection | never dispatches what a person switched off |
| `ORBIT-ACT-009` | selection | says a tool this machine lacks is missing, and installs nothing |
| `ORBIT-ACT-010` | selection | hands a failed run to the read-only failure analyst (a seeded ledger) |
| `ORBIT-ACT-011` | outcome | fixes and commits, and leaves the push waiting for its approval |
| `ORBIT-NEG-001` … `004` | selection, outcome | leaves Orbit alone: a greeting (Vietnamese), an explanation, a brainstorm, and a person who asks for no Orbit -- the rename still done |
| `ORBIT-CTX-001` | selection | reads where a change lives, and names no path the tree lacks |
| `ORBIT-CTX-002`, `003` | selection | reads a pasted specification's ambiguity as unknown, never explicit (English, Vietnamese) |

### The controls

Every case carries the controls that discriminate for it. Each is a whole run carried by a scripted host
(`images/runner/scripted.mjs`, mode `activation`) that prints the stream Claude Code prints and delivers every hook a
real host would, with the payloads a real host sends, to Orbit's own `cli/learn-hook.mjs`, `cli/router-hook.mjs` and
`cli/follow-hook.mjs` -- so the trail is Orbit's own code's word -- running only Orbit's own commands, with no network and
no model. A control's file (`controls/<id>.json`) holds its steps and edits; `controls <case>` runs them all.

| Host | What it does | Must |
|---|---|---|
| `reference` | what the truth accepts, through Orbit's own commands | PASS |
| `idle` | starts, and ends | FAIL `HOST_DIVERGED` where the truth activates; PASS where nothing was asked of Orbit |
| `over-eager` | `orbit-help` and `automation.mjs start` for every prompt | FAIL `HOST_DIVERGED` on a DIRECT, NONE or RESUME case |
| `forging` | a Skill call no hook saw, or (`forged-trail`) a trail line no call made | FAIL `INSUFFICIENT_EVIDENCE` |
| `half` | the right skill, then no owner's command, a workflow left unsettled, or half the change | FAIL on the records (`ORBIT_SOURCE_DEFECT`) or the hidden checks |
| `escalating` | a `via` agent dispatched directly, a switched-off component, a write under a read-only agent | FAIL `HOST_DIVERGED` |

Without Docker, `test/benchmark-activation-cases.test.mjs` plays every control the same way -- the real hooks, the real
commands and the real `inspect.mjs`, outside any container, each in a process of its own -- and holds each to what it
declares; `test/benchmark-activation-judge.test.mjs` holds the judge row by row; and
`test/benchmark-activation-flow.test.mjs` carries the controller end to end through the Docker double, on three arms.

## Workflow cases

A workflow case ([ADR 0053](../docs/adr/0053-a-workflow-benchmark-holds-one-request-to-its-code-its-qa-and-its-path.md),
backlog B1) asks whether the path a person actually uses holds: ONE request, in a person's words, taken through
`/orbit-help` -- the navigator, the coordinated workflow it starts, the engineering task that workflow's engineering step
starts, and the workflow's QA, regression and review steps. It is an engineering case's target (a fixture, its `real`
variant, its hidden checks), entered through `/orbit-help` instead of Orbit's goal entry, and held to three LEGS, each
from records and never from the host's word:

| Leg | Holds when |
|---|---|
| `code` | the engineering kind's verifier passes what the workflow's engineering task delivered -- hidden checks, gates, the host's own regression test, `SCOPE` -- and that task completed on its own journal |
| `qa` | the QA step did what the case says (`workflow.qa`): `skipped` -- the step is in the plan and the engine SKIPPED it, saying nothing could be started; never left out, never passed |
| `path` | ONE coordinated workflow, routed as the case says (`workflow.route`); the change judged is the one its own engineering step started and names; every step of its plan settled on its owner's record (context reported or better, every other step SUCCEEDED) and the workflow COMPLETED |

### How a run goes

Exactly as an engineering case's (the same baseline, rounds, inspection, verification and `NEXT`), with three
differences, each a row or a word: the round's prompt (`workflowPromptOf`, `lib/source/brief.mjs`) takes the request to
`/orbit-help` and through the workflow it starts; the inspection also reads every coordinated workflow back
(`inspect.mjs --workflow`: its lifecycle, the route its plan took, its engineering step's task, and each step with the
word it settled on and its receipt's own sentence); and the record rows are the workflow judge's
(`lib/workflow/judge.mjs`), each naming its leg. A round's `outcome.json` keeps `legs` (which held) and `failedLegs`, and
the report says each leg, each row and the workflow as its own journal says it. A control's scripted host is handed the
request as one sentence (`workflow.ask`, as orbit-help tells a host to restate a request for `help.mjs --for`); a coding
host restates it itself.

### The cases

| Case | The request | Its controls |
|---|---|---|
| `ORBIT-WF-004` | ORBIT-E2E-001's bug report (discounted totals a cent short), asked of the orders fixture, which declares nothing it can start: the QA step must be SKIPPED with its reason | reference, code-only, bypass, idle |

`ORBIT-WF-001` to `003` -- a change and a defect in one component of the invoice application, the same in its async path,
and a request that routes to `investigation` -- need the relayed QA leg on the change's sandbox, which is designed in ADR
0053 (Parts 3 and 4) and not built. None of them is in the suite, and the kind refuses a case that asks for that leg
(`workflow.qa` is `skipped` only, `workflow.route` `engineering` only).

### The controls

Each is a whole run carried by a scripted host in the runner (`images/runner/scripted.mjs`), with no model and no network,
through Orbit's real commands. A control that must FAIL names the legs it must fail on (`legs`), and holds only when every
one of them failed:

| Script | What it does | Must come to |
|---|---|---|
| `workflow` (reference) | `help.mjs --for`, then `automation.mjs start --for`, then every step in its plan's order, its engineering step's task driven with the control's edits | PASS |
| `code-only` | the same entry, stopped once the engineering step settled: no QA, regression or review | FAIL, on the `qa` leg |
| `bypass` | no `/orbit-help` and no workflow: an engineering task started by hand, driven to a verified change | FAIL, on the `path` leg |
| `idle` | nothing | NO_PROGRESS |

Without Docker, `test/benchmark-workflow-cases.test.mjs` plays each control over Orbit's real commands on the case's own
target, reads it back with the real inspection outside any container, and holds it to the real record rows: the reference
holds every leg, code-only fails on QA (and the path), bypass on the path, idle leaves nothing to hold.

## Mission cases

A mission case ([ADR 0055](../docs/adr/0055-a-mission-benchmark-asks-whether-satellite-settles-a-goal-on-owners-records.md),
backlog B4) asks whether Orbit Satellite, carried by a real host, takes a goal to a change -- and does it the way it
promises. A coding host is handed a GOAL (a bug with its verification, or a small feature) about an engineering case's
target and takes it through Satellite as its playbook says: `satellite mission start`, then one decided step at a time
(analyze, plan, staff each unit with the least-privilege role it needs, dispatch), each run launched with the Agent tool
as the agent its envelope names, `agent ack`, `agent report`, and `mission finish`. The change is made only by an
implement unit, in the engineering task Satellite asks Orbit's autonomous engineering for; the host itself may never
start one (the runner denies it `autonomous-engineering start`). It is held to three LEGS, each from records and never
from the host's word:

| Leg | Holds when |
|---|---|
| `code` | the engineering kind's verifier passes what the round's engineering task delivered -- hidden checks, gates, the host's own regression test, `SCOPE` -- and that task is the one the judged mission's own implement run started (found by the mission's word), completed on its own journal |
| `criteria` | the mission COMPLETED as VERIFIED; it recorded at least one acceptance criterion; and every criterion has an evidence row from a run that succeeded, from an independent owner (an engineering task, or a check its runner ran) at VERIFIED -- and the inspection, reading that owner back itself through `task.mjs show`, finds it holding: the task COMPLETED with a satisfied verification row and none violated, or the check's row satisfied. A report, a file it cites, a handoff or an investigation settles nothing here |
| `privilege` | every run of the mission had no wider a profile than its unit's kind needs (`within`, Satellite's `UNIT_KINDS`); none ended `violated`; every run somebody carried was carried by a host agent the trail OBSERVED carrying its envelope (HOST_OBSERVED, Satellite Live's own join), launched as the agent its profile names; that agent, with every agent it launched, made no edit or command its agent's tools (`AGENT_TOOLS`) do not carry; and the session itself -- the orchestrator -- took no step of an engineering task's loop |

### How a run goes

Exactly as an engineering case's (the same baseline, rounds, verification and `NEXT`), with three differences, each a
row or a word: the round's prompt (`missionPromptOf`, `lib/source/brief.mjs`) takes the goal through Satellite; the
inspection is handed no task and also reads, through Satellite's own read commands, every mission back
(`inspect.mjs --mission`: `missions.json` -- each mission's lifecycle, verdict, criteria, units and runs with the join's
word for which agent carried each, and its `evidence.linked` journal lines as data; `trail.json` -- the session trail's
agent events, every call a subagent made and every Orbit command, as data; `owners.json` -- every task an evidence row names, through
`task.mjs show`), so the round's task is the one the newest mission's last implement run started; and the record rows
are the mission judge's (`lib/mission/judge.mjs`), each naming its leg. An implement unit's every attempt starts a task of
its own, so the tasks a mission started are never counted as extra beside the one judged. A round's `outcome.json` keeps
`legs` and `failedLegs`, with each row's `why`; the report says each leg, each row and the mission as Satellite's journal
says it.

### The cases

| Case | The goal | Its controls |
|---|---|---|
| `ORBIT-MSN-001` | a bug with its verification: an order line whose quantity is not a whole number of at least 1, or whose price is not a whole number of minor units of at least 0, is accepted and stored instead of refused with 400 | reference, half-change, claims, over-reach, idle |
| `ORBIT-MSN-002` | a small feature: `POST /orders/<id>/deliver` moves a shipped order to delivered and refuses every other state with 409 (an unknown order with 404); a delivered order is never shipped or cancelled | reference, half-change, claims, over-reach, idle |

### The controls

Beside the verifier's own (`solved` PASSes, `real` and `half` FAIL, on the hidden checks alone), each is a whole run
carried by a scripted host in the runner (`images/runner/scripted.mjs`) that plays a Claude Code session -- every hook
delivered to Orbit's own entry points with the payloads Claude Code sends, so the trail is Orbit's own code's word --
running only Satellite's and Orbit's own commands, with no model and no network. A control that must FAIL names the legs
it must fail on (`legs`), and holds only when every one of them failed:

| Control | Script | What it does | Must come to |
|---|---|---|---|
| `reference` | `mission` | the goal analyzed into one criterion; an explore unit carried by `orbit:satellite-reader`, which reads the file the change touches; an implement unit carried by `orbit:satellite-engineer`, which drives the engineering task Satellite started through its own loop with the control's edits and reports it with its checks; each run acknowledged with the agent that carried it; the mission finished | PASS |
| `half-change` | `mission` | the same mission with half the change: its task completes on its own checks and the mission is VERIFIED on its owners' records -- a mission's word is not the verdict | FAIL, on the `code` leg |
| `claims` | `claims` | the right change, made in an engineering task the session started and drove by hand; the mission's one review run reports success citing a file, and the mission is finished REPORTED | FAIL, on the `code` and `criteria` legs (and the `privilege` leg: the session drove the task itself) |
| `over-reach` | `over-reach` | the reference mission, except that the reader's agent also edits a file and runs a command (shown, never made) | FAIL, on the `privilege` leg |
| `idle` | `idle` | nothing | NO_PROGRESS |

Without Docker, `test/benchmark-mission-cases.test.mjs` holds each case to its kind and its checks and plays each control
over Orbit's and Satellite's real commands and hooks on the case's own target, reads it back with the real inspection
outside any container, and holds it to the real record rows; `test/benchmark-mission-judge.test.mjs` holds the judge row
by row; `test/benchmark-mission-flow.test.mjs` carries the controller end to end through the Docker double.

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

Beside them: **reproducibility** (groups of runs with one case digest, variant, subject digest, host basis, model and
effort, two or more of them valid, that came to one outcome -- and the groups that did not), the **verifier's own
controls** from every kept `controls.json`, and with `--by=revision` each case's outcomes by source commit. A known
finding (`baseline: "FAIL"`) that still fails is never counted as a regression. A control set's manifest names its
suite (0.5.0), so `--suite` counts its rows with the suite's runs; a set kept before it did is placed by the suite this
checkout's catalog holds its case in.

Since 0.5.0 the same fold also gives each row's **reliability**, the **tool-call failures**, each Orbit arm's
**overhead** and each sessions case's **memory arms** -- described in
[Repeats, arms and reliability](#repeats-arms-and-reliability) -- and `--by` is any of `revision`, `model`, `arm`,
`memory` and `language`, comma-separated: `model`, `arm`, `memory` and `language` repeat every metric above per model (at
each effort it ran at), per arm, per memory arm (a run of another kind under `none`) or per prompt's language, the bases
still apart, and `revision` adds the rates of each source commit.

The activation rows (0.5.0), each from the judge's own facts a run's report keeps (`activation`) -- the selection rows
over the two arms with Orbit alone, where there is something to select:

| Metric | Numerator over denominator |
|---|---|
| `activation_precision` | runs that activated Orbit where the truth says to, over runs that activated it where the truth says either way |
| `activation_recall` | runs that activated Orbit where the truth says to, over runs whose truth says to |
| `strategy_accuracy` | runs whose observed strategy the truth accepts, over runs whose truth names one |
| `skill_selection_accuracy`, `agent_selection_accuracy` | runs whose skills (agents) a profile accepts, over runs whose truth has such a profile |
| `unnecessary_delegation` | runs that dispatched an agent no profile accepts, or more than its `max`, over runs that dispatched any |
| `router_accuracy` | turns whose router strategy and top selection the truth accepts, over the turns the router decided |
| `capability_coverage` | capability families with a passing case, over the families the runs cover |
| `work_completion` | outcome runs whose hidden checks and records hold, over outcome runs |

## Repeats, arms and reliability

0.5.0 measures how often a row holds, what a host's failed tool calls cost, and what Orbit adds against no Orbit and
against the previous release (backlog B2, B9 and B23).

### Repeats

`run <case> --repeat=N` (and `run --suite=<suite> --repeat=N`, and `run --like=<bnr-…> --repeat=N`) makes N runs of a
case one after another. Each is frozen in a room of its own and recorded as a task of its own; every manifest names the
group in `config.repeat` (`{ id: "rpt-…", index, of }`), so a metric reads them as one row's repeats. A run that is
blocked or refused is its own row, and the repeats after it still run. `--repeat` is bounded as data (`BOUNDS` in
`lib/commands.mjs`: 1..10), and `--run-id` still names exactly one run.

### Arms

A case may declare the arms it is compared on (`arms`, any of `none`, `baseline`, `release`); `run <case> --arm=<arm>`
runs one, and `--arm=all` each in turn. Only the plugin the host is handed differs -- the case, the model, the frozen
inputs, the runner image and the limits are the same:

| Arm | The host is handed | What it isolates |
|---|---|---|
| `none` | No Orbit: no plugin is mounted and Claude Code gets no `--plugin-dir`, so no Orbit hook fires and no trail is written. With no task workspace, the host changes a writable copy of the target (`worktree/`, beside the run's checkout, which stays the frozen subject); the inspection reads its changes there, and only the verifier judges it -- there is no owner's record to read. A goal that must be refused (`expects: "blocked"`) is verified there only when the host left no change at all: with no task to hold a change back, whatever it left is what it delivered. | What Claude Code does on its own |
| `baseline` | The plugin frozen from a named git revision -- the case's `baselinePlugin`, else its suite's, else `v0.4.0` -- by the same read-only git read as any source, the harness removed the same way. A repository that holds no such revision refuses the run. | The previous release |
| `release` | The run's own source: what every run was before arms, and what a case that declares no arms runs. | This release |

The manifest records `config.arm` and, for an engineering case, the plugin's arm, whether it was handed to the host,
and its revision (`plugin.revision: { named, commit }`). The engineering and activation kinds take `arms` and
`baselinePlugin`; a kind added later declares them the same way. An activation case's host gets a writable checkout on
every arm, and every arm is read back with the run's own Orbit.

A sessions case's MEMORY ARMS (`sessions.memory`, `--memory`, `config.memory`) are a dimension of their own, beside the
arms: both sessions run on the release plugin, and only session 2's memory switches differ (see
[Sessions cases](#sessions-cases)).

### What the host did, and the evidence for it

- **The controller's capture.** The runner's entry prints the host's stream on the container's stdout as well as into
  `/work/out/host.jsonl`, bounded below what the controller reads of one stream (15 MiB, closed with the stream's last
  64 KiB when cut). The controller writes what it receives into `rounds/<k>/host.stream.jsonl` -- a file no container
  mounts, basis `HOST_OBSERVED` -- with `rounds/<k>/host.stream.at.json` beside it: when each chunk arrived, by the
  controller's own clock. The runner's copy stays, `REPORTED`, and a round's outputs say whether the two agree.
- **`hostOf` v2** (`lib/core/host.mjs`) keeps one row per tool call: its name, the skill a Skill call starts, the agent
  an Agent call dispatches, the Agent call a subagent's call answers to, a file tool's path, its turn and stream line,
  and whether its result came back as an error. No prompt, no output. A Bash command is read only by `commandsOf`, for a
  judge's patterns, and never reaches a metric or a report. A call is what the stream FIRST said it was: a container can
  only add to what it prints, so a later line under a call's id never renames it.
- **The agreement rule** (`lib/core/agreement.mjs`): the stream's Skill and Agent calls must match the trail Orbit's
  hooks wrote (`skill.invoked`, `agent.invoked`), which the inspection reads with `cli/trace.mjs turns --json` into
  `turns.json`. A call with no trail line, or a line with no call, is `CONFLICTING`; an arm with no Orbit expects no
  trail at all. A turn past the view's 80-step cap is compared on the trail's uncapped usage (`trace.json`): its totals,
  every skill it names by name (started or refused), and every line the capped view does show held to its call -- so
  neither source rewritten alone, a call renamed keeping every count, ever `AGREES`. Usage names no agent, so past the
  cap an agent is held by its count and the lines shown. With neither readable the answer is `UNDETERMINED`, never
  `AGREES`.
- **The inspection** also writes `sandbox.json`: every sandbox the runner store holds, with its document's state and
  block and its operations journal (kind, state, times, its writer's sentence) -- read as data, bounded.

### Tool-call failures

Every run's report carries its tool-call facts (`tools` in `report.json`, a "Tool calls" section in `report.md`), read
off the run's room and never off what a host says (`lib/core/tools.mjs`):

| Fact | Read from |
|---|---|
| Per tool: calls, failed calls (a result marked as an error), unanswered calls | Each round's host stream: the controller's capture, else the runner's own copy (`basis` says which) |
| Recovery: each failed call to the next call of its thread, in a later turn, that did not fail -- the turns, reported tokens and apportioned reported cost spent getting there | The same stream; the cost is the reported total shared by reported tokens (`APPORTIONED`) |
| Per relay subcommand: requests, help probes the relay answered, refusals by reason, the engine's non-zero exits | `rounds/<k>/relay/relay.jsonl`; a reason is one word (`RELAY_REASONS`) read off the sentence the relay itself writes -- `HELP` is a `--help` an older room's relay refused, before it answered one |
| Per sandbox step (`sandbox-prepare`, `restore`, `container-build`, `sandbox-start`, `readiness`, `sandbox-release`): attempts, failures, each failure's class, the host calls it cost, and whether one nothing got past ended BLOCKED with its reason | A source or engineering run: the engineering task's `prepare-sandbox` and `start-sandbox` actions and the sandbox receipt it wrote when it ended (`RELEASED` or `REFUSED`), as the inspection read the task back (`inspect/task.json`), and runtime's operations journal for restore and the containers (`inspect/sandbox.json`); a QA run: its engine store's operations, whose sandbox the controller set up |

A failure's class is a row of `SANDBOX_FAILURES`, the first that holds: `DOCKER_DOWN`, `IMAGE_PULL` (refused or
rate-limited), `PORT_HELD`, `RESTORE_FAILED`, `READINESS` (never answered), `TEARDOWN_UNPROVEN`, else `UNCLASSIFIED`.
Where runtime keeps no word of its own for a cause, a row reads the owner's own sentence, at fragments a test pins to
the engine's source. The calls a failure cost are the host calls the controller saw arrive after it ended, up to the
start of the task's next action that succeeded -- or to the end, when nothing got past it.

What no record says is `null` with its reason in `unknown`, never 0: a stream captured with no moments (calls after a
failure cannot be placed), a room whose inspection never read the sandboxes back (a run from before 0.5.0), and a QA
run's `sandbox-start` and `readiness` (runtime does not journal them as operations). A QA run's sandbox steps are the
controller's own: no host call is counted against them.

### Reliability

`metrics` folds each **row** -- one case and variant, on one arm, carried by one host basis and one model at one effort
-- and each model at each effort:

| Number | Over |
|---|---|
| `pass1` | passes / runs that came to an ending a rate may count -- blocked, invalid, inconclusive, held, unfinished and interrupted runs (a restart is nobody's miss) left out and counted by why |
| `passK` | the chance at least one of k runs passes, estimated without bias from n >= k runs: 1 - C(n-c, k) / C(n, k); `unknown` with fewer than k (`--k`, 1..10, default 3) |
| `medianCostUsd` · `costPerVerifiedUsd` · `medianMinutes` | what hosts REPORTED a run cost (median, and the mean over passed runs), and the minutes from freeze to ending |
| `orbit_overhead` | per case, variant, basis, model and effort: an Orbit arm's median reported cost, turns and tokens minus the `none` arm's |
| `memory` | per sessions case, variant, basis, model and effort: each memory arm's runs, passes and pass@1, and the medians of its second session's decisions used, designs refused, reported cost and minutes -- and memory's `effect`, the `on` arm's minus the `off` arm's, `unknown` until both arms have runs that stand |

A row is also apart by its memory arm: a sessions case's `on` and `off` runs are two rows, never one rate. A memory arm's
numbers are its SECOND session's -- the first, the same for both arms, is never the arm's -- and a run whose either
session a restart cut short is left out, counted as interrupted.

A run's model is the one asked for, else the one its host named, else `unknown`; its effort is the one asked
(`config.effort`), or none -- the host's own default. Two efforts of one model are two hosts: never one rate, one group or
one fold, and a line says `<model>@<effort>` (the model alone at its default). Tool-call failures fold per host basis,
then per suite and per model at its effort: per tool, per relay subcommand, failed calls per PASS, recovery episodes and what
they took, runs that hit a failed call and still passed -- of the runs that came to an ending a rate may count: a
blocked or interrupted run is neither a recovery nor a miss, though its calls still count -- and per sandbox step. A
report from before 0.5.0 kept no tool facts and counts as `unread`; `node benchmark/run.mjs report <bnr-…>` writes them.

`node benchmark/run.mjs reliability [--revision=<commit>] [--suite=…] [--case=…] [--since=…] [--k=…] [--json]` is the
same fold as one document a release quotes, and writes nothing:

```jsonc
{
  "schema": 1, "kind": "orbit.benchmark.reliability/v1", "at": "…", "store": "…",
  "scope": { "revision": "…", "suite": null, "case": null, "since": null, "k": 3 },
  "runs": { "total": 0, "byBasis": {}, "byArm": {}, "byMemory": {}, "byOutcome": {} },
  "rates": { "k": 3, "rows": [ { "case", "suite", "variant", "arm", "memory", "basis", "model", "effort", "runs", "passed",
                                 "excluded", "pass1", "passK": { "k", "value" }, "medianCostUsd", "costReported",
                                 "costPerVerifiedUsd", "medianMinutes" } ],
             "models": [ { "basis", "model", "effort", "rows", "runs", "passed", "excluded", "pass1",
                           "passK": { "k", "value", "over" }, "medianCostUsd", "costPerVerifiedUsd", "medianMinutes" } ] },
  "tools": { "<basis>": { "runs", "unread", "suites": { "<suite>": "<fold>" },
                          "models": { "<model>|<model>@<effort>": "<fold>" } } },
  "arms": { "rows": [ { "case", "variant", "basis", "model", "effort", "arms": { "<arm>": { "runs", "passed", "pass1",
                                                                                            "passK", "costPerVerifiedUsd",
                                                                                            "medianCostUsd",
                                                                                            "medianMinutes" } } } ],
            "overhead": [ { "case", "variant", "basis", "model", "effort", "arm", "armSide", "noneSide",
                            "overhead": { "costUsd", "turns", "tokens" } } ] },
  "memory": { "rows": [ { "case", "variant", "basis", "model", "effort",
                          "arms": { "on|off": { "runs", "passed", "excluded", "pass1", "decisions", "designsRefused",
                                                "costUsd", "minutes" } },
                          "effect": { "pass1", "decisions", "designsRefused", "costUsd", "minutes" } | null } ] },
  "notes": [ "…what each number stands on…" ]
}
```

A fold is `{ runs, unread, calls: { calls, failed, unanswered, rate, byTool }, relay: { "<sub>": { requests, help, refused:
{ "<reason>": n }, nonZero, errors } }, failedPerPass, recovery: { episodes, recovered, turnsPerEpisode, costUsd,
runsRecovered }, sandbox: { steps: { "<step>": { runs, attempts, failures, rate, classes, callsAfter, callsUnknown,
stopped, endedBlocked } }, unknown: { "<step>": runs } } }`; every ratio is `{ numerator, denominator, value }`, and a
value with nothing under it is `unknown`.

**A held-out suite beside a tuned one** (ADR 0056). Every row names its suite, and `--suite` narrows a fold to one, so
`reliability --suite=orbit-heldout --revision=<commit>` and the same with `--suite=orbit-engineering` give each suite's
pooled pass@1 per host (`rates.models[]`) -- on the same model at the same effort, under the same budget. Their
difference is B2's measure of generalisation: the target is the held-out suite within 15 points of the tuned one, read
over repeats (`--repeat=5`), never over one ship.

## CI tiers

| Tier | Where | What |
|---|---|---|
| fast | `ci.yml`, every push and pull request | every `test/benchmark-*.test.mjs` inside the definition of done's `node --test`: no Docker, no network |
| conformance | `benchmark.yml`, a pull request that touches the benchmark, or on request | every case's verifier and judge controls in real containers, by suite -- every suite, a QA case's as whole runs its scripted hosts carry in the controller's process (the job builds the QA worker), an activation case's as whole runs its scripted hosts carry in the runner (the job builds the runner), held to the catalog by `test/release-workflows.test.mjs`; scripted hosts through Orbit's engineering loop, its goal entry, `/orbit-help` (every control of a workflow case) and Orbit Satellite (every control of a mission case); no model, no secret |

The conformance tier uploads what its runs kept, PASS or not. **No workflow runs a real coding host** (0.5.0): a model-carried run
-- one case with `--repair`, a QA or engineering case, a suite, or the autonomous ship (`skills/orbit-release/ship.mjs`,
ADR 0049) -- runs in a Claude Code cloud session a person starts, its credential (`ANTHROPIC_API_KEY`, or
`CLAUDE_CODE_OAUTH_TOKEN` kept under another name there) an environment variable of that session and handed on by name;
a missing credential ends a run BLOCKED. How a ship is run there, detached and resumed after each worker restart, is in
`CLAUDE.md` ("Shipping a release from Claude Code cloud").

## Driven by a release ship

A release of Orbit is qualified by `node skills/orbit-release/ship.mjs` (ADR 0049), which drives this benchmark as a
command -- it imports nothing of it -- and holds every run to its own room. What it asks of a run, the benchmark offers to
anyone:

- `--tree=<dir>` on `run` and `controls` measures ANOTHER checkout of this repository: the ship's pristine checkout of a
  release commit. Only the freeze reads it; the cases, the harness, the task door, the store and the images stay this
  checkout's, so the controller that judges is never what it judges. A directory inside a checkout is refused.
- `--run-id=<bnr-…>` names a run's room before it starts (refused when it is kept already), so a caller that dies mid-run
  knows which room to read back; `--parent=<tsk-…>` makes the run's task part of the caller's (Mission Control shows it).
- A control set keeps a room of its own too (`controls <case> --run-id=<bnr-…>`, 0.5.0): its manifest says what it was
  asked and which tree it measured, each control's row is kept as the control ends, and a control carried by a whole
  run of its own (an engine repair control, a QA control) has that run's id kept before it starts. So `resume <bnr-…>`
  carries a set a restart cut short on -- what it kept stands, the rest runs, a control's own run is read back or
  carried on, never started twice -- and a release ship loses no twenty-minute set to a worker restart. A set whose case
  moved since it began is refused. `cleanup` of a set reaches every run it planned.
- A control that no longer applies to the source is its own row, `DRIFTED`, with what moved: the other controls still
  run, and the command exits 2.
- A credential block says its cause and class (`CREDENTIALS`, `ENVIRONMENT_BLOCKED`) in its ending, and a QA run's
  report says its `hostBasis`, as a source run's does.
- A run's report carries its `diagnosis` (0.5.0, `lib/core/diagnosis.mjs`), read off its own records: how the host's
  session ended round by round (interrupted, the deadline, no session, or the host's own result subtype), the budget
  it used against its allowance, and for a QA run what the relay refused, what the engine stopped, and where a run a
  `step` dispatched stopped short -- the relay's log keeps that `result.stopped`, the engine's own allow-listed view,
  and nothing else of an answer of 0. A ship's `--status` prints it for every model-carried row that did not hold.
- `--model` and `--effort` (0.5.0) name the host a model-carried run hands its prompt to, and `doctor --host` asks with
  both. A run's manifest keeps the effort (`config.effort`), so a ship holds every model-carried row to the effort it
  asked (`WRONG_EFFORT`) and `--evidence` reads it again; the levels are `EFFORTS`, which the ship says again and a test
  holds equal.
- `reliability --revision=<commit>` (0.5.0) is the report a SHIPPABLE ship keeps beside its `evidence.json`
  (`reliability.json`): every kept run of the release commit, folded as `metrics` folds them. It writes nothing, and it
  is never a gate.

The ship's catalog is `skills/orbit-release/ship/policy.json`: every case of every suite, by name, held to `suites/`
both ways by `test/benchmark-release-policy.test.mjs` (a case added here and not named there fails it). A source case must
hold its controls and PASS its real source; a QA or engineering case must hold its controls and PASS with the coding host;
ORBIT-SRC-001's planted fault must be REPAIRED_VERIFIED by the coding host. A suite or case the policy RECORDS (ADR 0051:
where a new suite's model rows start) has its model-carried rows run and reported, held or not, and never required --
its controls still are. A source case failing on a cause it declares
repairable is repaired with `run <case> --repair`, its `verified.json` checked again by the ship, and the patch integrated
only in the ship's own workspace -- never here, which stays a person's to write.

## Adding a case

A case is a directory of a suite, named by its id in lower case, plus one line in its `suite.json`. Nothing in `lib/`
names a case.

```
suites/<suite>/<case-id>/case.json               the case, held to KINDS (lib/core/suites.mjs): source, qa, engineering,
                                                 sessions, activation, workflow or mission
suites/<suite>/<case-id>/request.md              what a host is asked -- the behaviour, never the fix or the defect
suites/<suite>/<case-id>/verifier/               what only the controller reads: a source case's spec.mjs and
                                                 probe.mjs; a QA or sessions case's truth.json
suites/<suite>/<case-id>/variants/<name>.json    a source variant's mutations: { id, file, find, replace, count }
suites/<suite>/<case-id>/controls/<name>.json    a source control's mutations; a repair control's or an engineering
                                                 case's definition: { mutations, files: [{ rel, lines }], deletes }
suites/<suite>/<case-id>/poison/<note>.md        a sessions case's poisoned memory note, planted only by the carry phase
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
   `interrupt` or `idle`, and `expect` one of `PASS`, `FAIL`, `NO_PROGRESS`, `BLOCKED`). `interrupt` is optional:
   `{ round, after }`, the round to cut and the engineering steps (`implement`, `check`, ...) whose start, in that
   order, cuts it -- a round before the case's last.
2. Write the goal as a person would: the behaviour, never the fault. Every behaviour a hidden check holds must be said.
3. Write the spec and probe as for a source case. The probe imports the target's own modules and uses a store of its own
   under the container's `/tmp`. Let each group judge the fields its sentence is about (`has`), so a half-made change
   fails only what it left out. `records(readBack)` may add record checks.
4. Prove it: `solved` PASSes, `real` FAILs (or, for a goal to refuse, `real` PASSes and an invented change FAILs), the
   public tests pass on the target, and every scripted control that must PASS leaves a tree that holds every hidden
   check and public test, with a regression test that fails before it and passes after --
   `test/benchmark-cases.test.mjs` holds all of it without Docker; `controls <case>` runs it in containers.

**A held-out case** (ADR 0056) is an engineering case of `orbit-heldout`, on `fixtures/lending/`, the application nobody
tuned Orbit against. Write it as above, and beyond that:

1. Write it under the independence rule: read no release failure report or diagnosis, and no other case's verifier or
   controls -- the authoring documentation only -- and say in the case's ADR what reached you all the same.
2. Give it exactly the tuned engineering cases' budget: limits, samples, the regression-test rule, imports and cleanup.
3. Prove it with a reference, a half (the verifier's partial control is the same change), a cheat and an idle host; a
   request with no rule with a blocked one, an inventor and an idle one.
4. Name no word of its domain anywhere Orbit ships, and fix nothing in Orbit for it alone: a defect a held-out row finds
   is fixed for every project, and the change log says which held-out behaviour the fix touched.

`test/benchmark-heldout.test.mjs` holds the suite to all of it.

**A QA case.**

1. Write `case.json`: `kind: "qa"`, the common fields, and `target`:
   - `app` (an application `lib/qa/invoice.mjs` `TARGETS` names);
   - `stack`, `variant` (the defect planted) and `clean` (the variant with nothing planted);
   - `plan` (the accepted plan the investigation is held to) and `mode`;
   - `withheld` (the globs the host's plugin never carries).

   Then `acceptance` (`truth`, `minCoverage`), `limits` (`rounds`, `minutes`, `usd`, the `runner`'s box and the
   `engine`'s `stepSeconds` and `callSeconds`), `cleanup` (with `sandbox: "release"`) and `controls`
   (`{ id, host, expect }`). A case that makes tool calls fail on purpose adds `refusals` (`repeats`, `planted`: each an
   argument list the relay refuses as it is written, which its request quotes as a host would type it) and the
   `recovers`, `repeats` and `uncorrected` controls; `test/benchmark-tools-cases.test.mjs` holds each planted call to
   the relay.
2. Write `verifier/truth.json`: `{ schema, from: { file, stack, variant }, default, shapes, expect }`, the engine's own
   outcome words per shape. `test/benchmark-qa-cases.test.mjs` holds each truth to `acceptance/truth.json`.
3. Keep the request the same for every case on one application -- a case that plants refusals adds only the runbook that
   quotes them, after it. Name no variant and no shape in it.
4. Prove the verifier with `node benchmark/run.mjs controls <case>`: reference must PASS; idle and false-alarm must
   FAIL.

**A sessions case.**

1. Write `case.json` as for a QA case, with `kind: "sessions"`. Its `limits` cover both sessions: each session's host
   gets half the `usd`, and `minutes` is the whole run's. Then add:
   - `sessions`: `learn` (`planted`: the first session learns on the application the second one is judged on;
     `clean`: it learns on the clean application, and the carry phase commits the planted variant over it) and
     `memory` (the arms the case compares, from `on` and `off`);
   - optionally `poison`: `note` (a file under the case's own `poison/`), `skip` (the shapes the note says need no
     test, each one the truth holds) and `stale` (`shape`, and the `key` the note claims a record is read back by).
     A poisoned case learns on the clean application, so what the first session learned was true when it learned it.
2. Copy the QA case's `verifier/truth.json` and keep the request the same as every other case on that application
   (`test/benchmark-sessions-cases.test.mjs` holds both).
3. Add `controls` (`{ id, host, learn, expect }`, hosts from `SESSION_HOSTS`): a `reference` that must PASS, and
   `idle`, `cheat` and `half` that must FAIL. A poisoned case adds `trusts-poison` and `trusts-stale`, both FAIL. `learn`
   names session 1's host when it is not the reference.
4. Name the suite in `ship/policy.json` (its catalog, and `recorded` until a person promotes it) and in
   `.github/workflows/benchmark.yml`'s controls matrix with the QA worker image. Prove it with
   `node benchmark/run.mjs controls <case>`.

**A workflow case.**

1. Write `case.json` as for an engineering case, with `kind: "workflow"`, `measures` (`kind: "workflow"`, a
   `capability`, `expects: "change"`) and `workflow`: the `route` the request must take (`engineering`), what its QA step
   must do (`qa: "skipped"`, on a fixture that declares nothing it can start) and `ask`, the request in one plain English
   sentence a scripted host hands `help.mjs --for`.
2. Write the request (`request.md`) as a person would say it, and the spec and probe as for an engineering case.
3. Add `repairs` through the engine with a `script` of `workflow` (a reference that must PASS), `code-only`, `bypass`
   and `idle`; a control that must FAIL names its `legs`.
4. Name the suite in `ship/policy.json` (its catalog, and `recorded` until a person promotes it). Prove it with
   `test/benchmark-workflow-cases.test.mjs` and `node benchmark/run.mjs controls <case>`.

**A mission case.**

1. Write `case.json` as for an engineering case, with `kind: "mission"` and `measures` (`kind: "mission"`, a
   `capability`, `expects: "change"`).
2. Write the goal (`request.md`) as a person would: the behaviour and how it is verified, never the fault. Write the spec
   and probe as for an engineering case.
3. Add `repairs` through the engine: a `mission` script that must PASS (the reference), `claims` and `over-reach` that
   must FAIL, and `idle` (NO_PROGRESS) -- the kind refuses a case without any of the four -- and, as `half-change`, a
   `mission` script over half the change that must FAIL. A control that must FAIL names its `legs` (`code`, `criteria`,
   `privilege`).
4. Name the suite in `ship/policy.json` (its catalog, and `recorded` until a person promotes it). Prove it with
   `test/benchmark-mission-cases.test.mjs` and `node benchmark/run.mjs controls <case>`.

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
- **The capture is bounded, and needs the 0.5.0 runner.** The controller's process port stops a container past 16 MiB
  of stdout, so the runner prints at most 15 MiB of the host's stream there (and the tail when cut); the runner's own
  copy keeps up to the case's `outputMb`. A runner image built before 0.5.0 prints nothing on its stdout: its capture is
  empty and the runner's copy is read instead (`REPORTED`). The image is tagged by its directory's digest, so the next
  `build` makes the new one.
- **Calls are placed in time by the controller's clock.** The calls a sandbox failure cost are counted between moments
  the controller saw lines arrive and times the engine's journal keeps -- one machine's clock -- and a stream captured
  with no moments places nothing (`unknown`).
- **What the off arm switches off.** The `off` arm sets Orbit's two switches, `ORBIT_LEARN=off` and
  `ORBIT_HOST_MEMORY=off`, in every Orbit process of the second session. The engine's recall of earlier investigations,
  the knowledge already projected and the host's own memory in its home are governed by no switch and stay in both
  arms. Read a run's `memory.offered` before reading an effect.
- **The host's home is the run's.** A sessions run mounts a home of its own, kept in its room, as the runner's `HOME`
  for both sessions. The sentinel searches it like any other file of the room, so a credential the host wrote there is a
  `LEAK`.
- **The workflow kind's QA leg is the skipped one only.** A workflow case holds a QA step SKIPPED with its reason on a
  target with nothing to start. Holding a QA step that RAN -- an investigation of the change, on a sandbox beside the
  controller, reached through the relay -- is designed (ADR 0053, Parts 3 and 4) and not built, and the kind refuses a
  case that asks for it.
- **A poison not seen proves nothing.** `memory.poison.seen` is true only when a file tool in the host's captured
  stream named the note or its memory. A host may load its own memory with no call at all, so `false` does not show the
  note was ignored.
