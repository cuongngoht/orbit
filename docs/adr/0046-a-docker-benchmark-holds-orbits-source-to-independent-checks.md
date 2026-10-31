# ADR 0046 — A Docker benchmark holds Orbit's own source to independent checks, and repairs only through Orbit

## Status

Accepted (development tooling; no engine contract changes). Builds on ADR 0017 (a coordinator dispatches to owners and
proves nothing itself), ADR 0038 (an active generated test runs only where isolation is proven), ADR 0042 (autonomous by
default, protected boundaries), ADR 0044 (attribution only by evidence) and ADR 0045 (self-improvement on independent
evidence).

## Context

1. Orbit's tests say what each module does today. Nothing measured the source of the branch in hand against behaviour
   Orbit PROMISES, in an environment the code under test could not reach.
2. Nothing handed a failure of that kind to Orbit's own autonomous engineering loop, with a real coding host, and had
   the result judged by something the repair could not touch.
3. Any loop that grades its own repair learns to grade itself. The design question is what may never count as
   evidence that a repair worked. That includes an agent's "done", a log that says PASS, a test it weakened, a check it
   swapped, a benchmark it edited, and a second task that starts the budget again.

## Decision

### Where it lives

`benchmark/` is a composition root of its own, outside `src/`, `cli/` and `skills/`. Nothing of the engine imports
it, `.gitattributes` export-ignores it, and it is held to Five Lines like shipped code (`test/benchmark-lint.test.mjs`).

It is not under `acceptance/`, because the backend acceptance digest hashes that tree, and every new benchmark case
would void a recorded acceptance.

### Cases are data

A case is a directory of a pack. Its `case.json` is held to fields declared once (`CASE_FIELDS`, `SECTIONS`) by the
constraint enforcement every Orbit table uses. It declares:

- what the case measures, and which causes are repairable;
- its subject and its public request;
- its hidden spec and its probe, which the verifier owns;
- its scope, gates and limits;
- variants with planted faults, and controls with the outcome each must earn.

A fault is an exact mutation, and one that no longer matches is `FIXTURE_DRIFT`, refused before anything runs. Adding a
case adds a directory; nothing in `benchmark/lib/` names one.

### A run is an Orbit task

Each run is one task of the measured checkout's project (provider `benchmark`), written only through `cli/task.mjs`, the
task's own door. Its stages, attempts, actions, receipts and verification rows are the task's vocabulary. So:

- Orbit Live and Mission Control show it;
- the door holds its attempt and minute budgets;
- a person's pause or cancel refuses its next step;
- resume is read off the journal.

There is no second journal, orchestrator, approval engine or memory store. The run's evidence (the manifest, the
frozen case, the subject checkout, one document per action, each round's brief, candidate and patch, the report) is
kept in the machine store under `<store>/benchmark/<bnr-…>/`.

### Freezing

The source is read through read-only git: HEAD, or HEAD plus the working tree when a person says so. A dirty tree
with no choice is refused. Nothing is reset, stashed or written in the developer's checkout.

The subject is the source without the harness, with the variant's faults applied to the run's own copy. It becomes
a checkout with one fixed commit, so its history holds neither the clean source nor the faults.

The manifest pins the branch, commit and digests, the case and harness digests, the image ids, the seed and the
limits. The frozen case and subject are checked again after every round; a change ends the run as BENCHMARK_INVALID.

### Containers

Every container is built from Orbit's own Docker provider (`src/runtime/isolation/docker.mjs`): an argument list, a
value only through a private env file, and a credential only by name.

Before it starts, it is attested against the isolation `PROFILE` rows plus two of the benchmark's own (it runs as the
declared user, on the pinned image id). It has:

- a read-only root, no capability, and `no-new-privileges`;
- an init, and CPU, memory and PID limits;
- the run's label.

Its deadline is the controller's: at the deadline it is stopped and removed, whatever runs inside. Its exit and OOM
kill are read from Docker. No container is given the Docker socket, a home directory, the developer's store or
checkout.

The roles are kept apart:

- **The runner** gets the subject checkout read-only, a runner store of its own, the brief and the credential. Its
  only way out is an egress proxy that CONNECTs to the model API's host alone. It checks that before the host runs.
- **The inspection** has no network and no credential. It reads back the task and its workspace and executes nothing
  of the candidate's.
- **The verifier** has no network, no credential and no model. A probe runs the subject's code on seeded inputs and
  prints raw answers. The gates run in a fresh copy each, with every existing test put back as the subject had it, and
  must run as many tests as the subject did.

The judge runs in the controller with the frozen spec and never imports candidate code.

When a run ends, a sentinel searches its room for the credential's value, in every spelling the engine's masking
knows. It masks any file that holds the value and names it in the report.

Both images are built once, tagged by the digest of their directory, and reused by id. The source only ever arrives as
a mount, so a new commit needs no rebuild.

### What a failure is, and what comes next

Two tables decide, each ordered, with a last row that always matches.

**`CAUSES`** classifies the baseline: BENCHMARK_INVALID, ENVIRONMENT, CREDENTIALS, PROVIDER, BUDGET_EXHAUSTED,
INSUFFICIENT_EVIDENCE (two verifications of one source that disagree), CAPABILITY_MISSING, ORBIT_SOURCE_DEFECT,
GATE_UNEXPLAINED, PASS. Only a cause the case declares repairable opens a repair. An environment, a provider or a
budget is never "fixed" by changing source, and an agent that did not solve a case is not, by that, a defect of the
engine.

**`NEXT`** settles each round:

- VERIFIED;
- BENCHMARK_CHANGED or BLOCKED;
- ENGINE_ENDED, when the engineering task ended and the verifier does not pass it;
- NO_PROGRESS, on two attempts in a row with one failure signature;
- BUDGET;
- otherwise CONTINUE, on the same task.

### Repair goes through Orbit and nothing else

The runner starts ONE engineering task with `cli/autonomous-engineering.mjs start`, in round 1, and names it again in
every later round. Claude Code, pinned in the image and with its flags checked against the installed version, drives
that task's own loop. Edits stay in the task's workspace, and the engine commits in its own delivery directory.

A round is never sent again. On resume, its containers are removed by label and what it left is read back. A second
task is counted against the round (EXTRA_TASK), never adopted. The runner's deny rules forbid starting another task or
removing the workspace. The `/orbit-improve` contract is untouched: a playbook or role successor is still never
executable, and this is not a way around that.

### A candidate is judged on behaviour

`SCOPE` refuses by name, before anything runs:

- a path outside the case's scope;
- the harness itself, or how a check runs;
- a deleted, weakened or skipped test;
- a process, the global object or a new import brought into the source;
- a file that is not regular text;
- a candidate with no regression test of its own.

Every byte must match the digest the inspection reported. The candidate is VERIFIED only when all of these hold:

- every hidden check;
- every gate, on the restored tests;
- its own regression test, failing on the subject and passing on it.

A host's "done", its own PASS and any field in the runner's output are never evidence.

### Reported is kept apart from proven

The report keeps five things apart:

- whether the code is correct (the verifier's);
- whether the work went through Orbit;
- whether nobody stepped in;
- what blocked the run;
- whether the benchmark itself held.

Host metrics are REPORTED, and an unreported one is `unknown`. A benchmark's engineering task lives in the run's own
runner store, so it is never an independent session for learning or self-improvement and passes no promotion gate.

## Consequences

- `node benchmark/run.mjs` builds, lists, runs a case or a pack, repairs, reports, resumes and cleans up
  (`benchmark/README.md`).
- The first pack, `orbit-source`, holds `src/improvement/oracle.mjs` and `safety.mjs` to the acceptance oracle's
  promises:
  - **ORBIT-SRC-001** passes on the current source, and fails on its planted variant, a partial fix, an oracle that
    allows everything and one that refuses everything.
  - **ORBIT-SRC-002** fails on the current source: a removed step that waited for a person is not reported. It is a
    real finding, kept as its own case.
- What a container can see is bounded by the declarations above, not by trust in the agent. The runner can still read
  its own credential, which is why it is the only container that gets one and why its network reaches only the model's
  API.
- A full end-to-end repair needs Docker, the runner image and a credential for the coding host. Where any is missing,
  the run is BLOCKED with the evidence, never reported as a success.
