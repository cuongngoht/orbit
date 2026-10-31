# The Orbit benchmark

Benchmark cases that say what Orbit's own source must do. Each case runs against the source of the branch you are on,
in Docker, and is judged by a verifier that shares nothing with what it judges. A case that fails on a cause it declares
repairable can be handed to Orbit itself, with `--repair`. A real coding host (Claude Code, in a runner container)
drives Orbit's own autonomous engineering loop on one engineering task. The verifier then judges the candidate in fresh
containers.

This is development tooling. It never ships (`.gitattributes` export-ignores `benchmark/`), and nothing in `src/`,
`cli/` or `skills/` imports it (`test/benchmark-lint.test.mjs`). The design and its reasons are in
[ADR 0046](../docs/adr/0046-a-docker-benchmark-holds-orbits-source-to-independent-checks.md).

## Quick path

1. **Prepare.**
   - You need Node 20 or later, git, and a running Docker engine (`docker info` answers).
   - For `--repair` only, you also need a credential for the coding host, exported in your shell: `ANTHROPIC_API_KEY`,
     or `CLAUDE_CODE_OAUTH_TOKEN`. It is handed to the runner container by NAME only, never written into an image,
     an argument, a file or a log.
   - `ANTHROPIC_BASE_URL` points the host at another endpoint; that endpoint's host becomes the only one the runner
     can reach.
   - Behind a network that inspects TLS, give the proxy's CA bundle with `--ca-file=<pem>` (or
     `ORBIT_BENCHMARK_CA_FILE`).
   - Run `node benchmark/run.mjs doctor` to see what is missing. `doctor --preflight` also runs the subject's own
     declared checks (`npm run lint`, `npm run test`) in the runner container, with no host.
2. **Build once.**
   - `node benchmark/run.mjs build` builds two images: `verifier` (no network at build time) and `runner` (Claude Code
     at a pinned version).
   - Each is tagged by the digest of its directory under `images/` and reused by id until that directory changes.
     `--rebuild` forces a rebuild.
   - Neither image holds any Orbit source: the source arrives as a mount. So a new commit needs no rebuild.
3. **Run.**
   - `node benchmark/run.mjs list` shows the packs, their cases, variants and controls.
   - `node benchmark/run.mjs run ORBIT-SRC-001` runs the source as it is. It should PASS, and nothing is changed.
   - `node benchmark/run.mjs run ORBIT-SRC-001 --variant=controlled-fault` plants faults in the run's own copy of the
     source. It should FAIL, and the report labels the failure as planted.
   - `node benchmark/run.mjs run ORBIT-SRC-001 --variant=controlled-fault --repair` hands the failure to Orbit.
   - `node benchmark/run.mjs run --suite=orbit-source` runs every case of a pack.
   - With uncommitted changes to what is measured, a run is refused until you say which tree to measure:
     `--source=head` (HEAD, without them) or `--source=worktree` (HEAD and them). Nothing is reset, stashed or written
     in your checkout.
4. **Read the result.**
   - `node benchmark/run.mjs status <bnr-…>` and `report <bnr-…>` show the outcome. The report is written into the
     run's room as `report.md` and `report.json`.
   - Each repair round leaves `rounds/<k>/candidate.patch`.
   - The run is an Orbit task (provider `benchmark`), so Orbit Live and Mission Control show its stages. A person can
     pause or cancel it, there or with `node cli/task.mjs pause|cancel <task> --human --expect=<revision>`. The task's
     door then refuses the run's next step, and the controller stops with nothing of its own left running. A paused
     run goes on with `resume` once the person resumes its task in Orbit Control.
5. **Run it again.**
   - `node benchmark/run.mjs run --like=<bnr-…>` uses the same case, variant, source mode, seed, limits and images.
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
| `PASS` | 0 | Every hidden check and every gate held, on both verifications of the subject. |
| `REPAIRED_VERIFIED` | 0 | The candidate passes the hidden checks and the gates. Its own regression test fails before the change and passes after it. Its changes stay inside the scope. |
| `FAIL` | 1 | A failure that stands. A failure under the `controlled-fault` variant was planted, and the report says so. |
| `REPAIR_REJECTED` | 1 | The engineering task ended, and the verifier did not pass what it left. |
| `NO_PROGRESS` | 1 | Two attempts in a row failed with one signature. |
| `BUDGET_EXHAUSTED` | 1 | No round, minute or dollar is left for another round. |
| `BENCHMARK_INVALID` | 2 | The case's own reference model failed its self-test, or what the run froze changed under it. This is work on the benchmark, not on Orbit. |
| `REFUSED` | 2 | Bad usage, a dirty tree with no `--source`, or a fault that no longer matches the source (`FIXTURE_DRIFT`). |
| `BLOCKED` | 3 | Docker, an image, a credential, the provider or the network: an environment, never a defect in Orbit. |
| `INCONCLUSIVE` | 4 | Two verifications of one source disagreed, or what was seen does not settle a cause. |
| `PAUSED` · `CANCELLED` | 4 | A person held the run. A paused run goes on with `resume` once they resume its task in Orbit Control. |

## How a run goes

A run's place is read off its task's journal every time, never kept beside it. That is what makes `resume` safe.

| Stage | What happens |
|---|---|
| `TESTING` | **Baseline**, attempt 1 (`fresh`). The subject is verified twice with the same seed. Two answers that disagree are INCONCLUSIVE, not a defect. |
| `DIAGNOSING` | The `CAUSES` table (`lib/classify.mjs`) over what the two verifications showed. Its first matching row is the cause, and its last row always matches. Only a cause the case declares repairable, under `--repair`, opens a round. Everything else ends the run with the verdict it earned. |
| `FIXING` | **Round k**, attempt k+1 (`fix`). The coding host works in the runner container on the run's ONE engineering task: started through `cli/autonomous-engineering.mjs start` in round 1, and named again in every later round. There is never a second task, so a budget cannot be reset by starting one. |
| `REVIEWING` | An inspection container reads back what the round left: the task, its workspace, the session trail. The candidate's changes are held to the `SCOPE` rules. |
| `TESTING` | The candidate is held to the hidden checks. |
| `REGRESSION` | The candidate is held to the gates, and to its own regression test. |

After each round, the `NEXT` table (`lib/decide.mjs`) settles what comes next:

- the run completes (`VERIFIED`);
- it stops on `BENCHMARK_CHANGED`, `BLOCKED`, `ENGINE_ENDED`, `NO_PROGRESS` or `BUDGET`;
- or, while the failure keeps changing and the task is open, another round runs on the same task.

A run interrupted anywhere is carried on by `resume`:

- an action that never settled is closed as interrupted;
- a verification, which changes nothing, runs again as a new action;
- a repair round is never sent again: its containers are removed by label, and what it left is read back and judged.

## What a run freezes

`manifest.json` holds everything below. The baseline and every candidate are judged with the same values.

- **Source:** branch, commit, mode (`head` or `worktree`), the uncommitted paths at freeze time, the digest of the
  whole tree, and what was skipped.
- **Subject:** the measured tree, which is the source without the benchmark's own files, with any planted faults. It
  is recorded with its digest, the clean digest without faults, and the fixed commit of the checkout made from it.
  The checkout has one commit and no history, so the original source and the faults cannot be read from its history.
- **Benchmark:** pack, case and version, the variant, the digest of the case as copied into the run, and the digest
  of the harness.
- **Environment and limits:** image ids, the Claude Code version, the Docker version, the seed, the model asked for,
  and the limits in effect. The model the host actually ran is read from its own init event.

## The containers

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

## Why the verifier can be believed

- **The judge never imports candidate code.** The probe runs the subject's code and prints raw answers. The judge
  (`lib/judge.mjs`, with the case's frozen `hidden/spec.mjs`) runs in the controller, so a candidate can only make its
  own answers right by computing them.
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

## Adding a case

A case is a directory of a pack plus one line in its `pack.json`. Nothing in `lib/` names a case.

```
packs/<pack>/pack.json                          { schema, id, version, title, cases: [<CASE-ID>, …] }
packs/<pack>/<CASE-ID>/case.json                the case, held to CASE_FIELDS and SECTIONS (lib/packs.mjs)
packs/<pack>/<CASE-ID>/request.md               the public request a repair is asked with -- the behaviour, never the fix
packs/<pack>/<CASE-ID>/hidden/spec.mjs          GROUPS, cases(seed, samples), selfTest(): read by the controller only
packs/<pack>/<CASE-ID>/hidden/probe.mjs         reads {inputs} on stdin, imports the subject, prints one line of answers
packs/<pack>/<CASE-ID>/faults/<variant>.json    mutations a variant plants: { id, file, find, replace, count }
packs/<pack>/<CASE-ID>/controls/<name>.json     mutations that prove the verifier, each with the outcome it must earn
```

1. **Write `case.json`.**
   - Required: `id`, `version`, `title`, `goal`, and `measures` (what it measures, and which causes are
     `repairable`).
   - `subject`: the paths it reads, and the exports the probe needs.
   - `request`, `reproduce`, and `acceptance` (owner `verifier`, `spec`, `probe`, `samples`).
   - `scope` (`allow`, `deny`), and `checks`: the repository's gates as argument lists, plus `agentTests`.
   - `limits`: rounds, minutes and USD, then CPU, memory, PIDs and time for the runner and the verifier, and the
     engineering task's attempts and actions.
   - Also `artifacts`, `cleanup`, `variants`, and `controls`.
   - `node benchmark/run.mjs list` validates every case and names each field that is wrong.
2. **Write the spec.** `cases(seed, samples)` returns `{ id, group, input, expect }`, where `expect` is `has`,
   `lacks` or `exactly` over a list of ids. `selfTest()` returns `[]` when the reference model agrees with a table
   written by hand; anything else makes the case `BENCHMARK_INVALID`.
3. **Write the probe.**
   - It prints `{ "answers": [{ "id", "got": [ids] }] }`, or `{ "error": { "code" } }` when the subject cannot be
     loaded.
   - Use `IMPORT` when the subject's module will not load, and `MISSING_EXPORT` when an export the case declares is
     missing.
   - It never sees an expectation.
4. **Prove the checks discriminate.**
   - A control that must PASS and controls that must FAIL: a planted fault, a partial fix, allow-all and reject-all.
   - Run them with `node benchmark/run.mjs controls <case>`.
   - Add the same proofs, without Docker, to a `test/benchmark-*.test.mjs`.
5. **Plant faults only in mutation files.**
   - A mutation must match exactly `count` times. If it does not, the run is refused as `FIXTURE_DRIFT`; the source
     moved, and the run would otherwise measure a tree without the fault.
   - A fault that does not make the baseline fail is a benchmark that is wrong.

Keep hidden things hidden. The subject handed to the runner never contains `benchmark/` or
`test/benchmark-*.test.mjs`. Documentation elsewhere in the repository does reach the runner, so it describes the
mechanism only: never a fault, a hidden input or a fix.

## Known limits

- **Container user.** Containers run as the invoking user's uid:gid, so a run's room stays owned by that user. On a
  host where the benchmark runs as root, the containers run as root too, still with a read-only root, no capabilities
  and `no-new-privileges`. Run the benchmark as an ordinary user, or under a rootless engine.
- **The credential is visible to the runner.** Code running in the runner can read its own environment, so the
  credential is visible to whatever the host runs there. That is why the runner is the only container that gets it,
  and why its network reaches only the model's API.
- **The sentinel.** When a run ends, its room is searched for the credential's value: as typed, in base64 and
  percent-encoded. Any file that holds it is masked in place, or removed when it cannot be rewritten, and is named in
  `leaks.json`, in the report and on the command line (`LEAK`). Links are never followed. The subject checkout and the
  frozen case, which were copied from your own files, are not rewritten.
- **TLS inspection.** On a network that inspects TLS, the runner and its build need `--ca-file`. The CA is a build
  secret and a read-only runtime mount, never a layer of the image.
- **Reported, not proven.** Whether the work went through Orbit, and the host's model, turns, cost and tool calls, are
  read from the runner's store and the host's own output, which the agent could also write. The report marks them
  REPORTED, and an unreported number is `unknown`. The verdict on the candidate never rests on them.
- **No promotion evidence.** A benchmark run's own engineering task lives in the run's runner store. It is never an
  independent session for learning or self-improvement, and it never passes a promotion gate.
