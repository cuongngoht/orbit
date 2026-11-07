# Orbit (Claude Code)

Product identity, invariants, DSL rules, Five Lines constraints, and definition of done are in [AGENTS.md](AGENTS.md).

@AGENTS.md

Module map: [docs/agents/layout.md](docs/agents/layout.md). Extension table: [docs/agents/extend.md](docs/agents/extend.md).

## Claude Code

```bash
/plugin marketplace add cuongngoht/orbit
/plugin install orbit@orbit
```

Local: `claude --plugin-dir .`

Host session hints (untrusted): plugin option `host_memory`, or `ORBIT_HOST_MEMORY=off`.

## Shipping a release from Claude Code cloud

The release is `node skills/orbit-release/ship.mjs` (ADR 0049; the whole contract is in
[skills/orbit-release/SKILL.md](skills/orbit-release/SKILL.md)). What follows is how it is actually run in a cloud
session, and what the 0.4.0 ships taught. A cloud session is the ONLY place a model-carried run happens: no GitHub
workflow runs the ship or a real coding host (0.5.0, backlog B8); CI holds the fast tier (`ship.mjs --ci`) and the
benchmark's conformance tier, which need no credential.

**Run it in its own session, detached.** The coding host's token is an environment variable of the cloud environment,
kept as `ORBIT_CODE_OAUTH_TOKEN` (the 0.4.0 environment called it `ORBIT_CLAUDE_OAUTH_TOKEN`), and mapped to
`CLAUDE_CODE_OAUTH_TOKEN` for the one process that needs it. Check it by name only (`test -n "$ORBIT_CODE_OAUTH_TOKEN"`);
never print it. Why it is not used under its own name:

- The real Claude Code in the runner reads its credential only under its own names (`CLAUDE_CODE_OAUTH_TOKEN`, or
  `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`); an `ORBIT_*` name means nothing to it.
- The harness hands the credential to the runner container by NAME only: docker fills `-e <NAME>` from the controller's
  own environment, so Orbit never reads, renames, writes or logs the value. The name the controller sees must therefore
  already be the name Claude Code reads, and `--credential` takes only those three (`CREDENTIAL_NAMES`,
  `skills/orbit-release/ship/preflight.mjs`; `CREDENTIALS`, `benchmark/lib/core/context.mjs`) -- any other is refused.
  Renaming it on the way in would mean handling the value, which "a secret is named, never kept" (AGENTS.md) forbids.
- The cloud environment filters `CLAUDE_CODE_*` names, which steer the session's own Claude Code, so the token cannot be
  stored under its own name -- and if it could, this session's own Claude Code would take it as its credential.

So the mapping lives only in the environment of the one detached process and its children (`CLAUDE_CODE_OAUTH_TOKEN=…
node …`), never exported into the session. A variable added to the environment reaches a session only when it starts or
its worker restarts: until then it is not in the session's processes, and the model-carried runs wait.

```bash
rm -f /var/run/docker.pid; setsid nohup dockerd --registry-mirror=https://mirror.gcr.io > /tmp/dockerd.log 2>&1 &
CLAUDE_CODE_OAUTH_TOKEN="$ORBIT_CODE_OAUTH_TOKEN" setsid nohup node skills/orbit-release/ship.mjs \
  --credential=CLAUDE_CODE_OAUTH_TOKEN --model=claude-sonnet-5-5 --effort=medium --ca-file=/root/.ccr/ca-bundle.crt \
  --usd=150 --retries=2 --json > /tmp/ship.log 2>&1 &
node skills/orbit-release/ship.mjs --status --json          # where it stands; a failed model row's diagnosis bundle
# after a worker restart (process gone, no ending): dockerd again, then the same command with --resume=<shp-…>
# before a ship: the same command with --precheck in place of --retries=2 (the model-carried rows only, each once)
```

- **Docker Hub rate-limits** (HTTP 429): pull through `mirror.gcr.io`. **TLS is inspected** by the egress gateway:
  always `--ca-file=/root/.ccr/ca-bundle.crt`. A restart leaves a stale `/var/run/docker.pid`: remove it first.
- **The worker restarts every hour or two** and kills every process (files survive). Watch with background waits of at
  most ~100 minutes and `--resume`; a ship is read back from its journal and never re-runs a held row. Since 0.5.0
  (ADR 0051) a resume also carries a control set on from the controls it kept, builds images a failed build left
  unbuilt, asks a refused host check again, and never charges a run it interrupted its whole `--usd` allowance (its
  cost is said as unknown) -- nor a cut-short repair one of its `--attempts`.
- **Model: Sonnet 5.5 at medium effort** (`--model=claude-sonnet-5-5 --effort=medium`), the owner's decision for 0.5.0
  (backlog open question 3), for the pre-check and the ship alike. The effort goes to every model-carried row's Claude
  Code (`--effort`, beside `--model`) and to the host check, is frozen when the ship begins (a resume naming another is
  refused), and is recorded in `evidence.json` beside the model; a row run at another effort is never that ship's
  evidence (`WRONG_EFFORT`), and `--evidence` reads it again from every room. 0.4.0's lesson stands: on Sonnet most
  autonomous QA rows missed their planted defects, so read a QA row's miss from its room (below) before calling it the
  model's -- 0.5.0 gave the QA playbook a worked design per obligation shape for exactly that (B7), and B2 measures
  Sonnet's QA pass@1. **`--retries=2`** lets a model-carried row that missed run again (policy bound 0..3); it holds
  only on its own PASS.
- **Never push to the branch while a ship runs**: `--evidence` is PUBLISHABLE only for the exact tree that qualified.
  Park a fix on a side branch and bring it in after the ship ends (or before the next one).
- **Pre-check before a full ship.** A ship stops at its first failed row after ~90 minutes of controls; run the
  model-carried rows first, each once, so every failure shows in one pass: `ship.mjs --precheck` with the same
  `--credential --model --effort --ca-file --usd`, detached and resumed like a ship (it refuses `--retries`). It ends
  PRECHECK HELD or PRECHECK FAILED with every failure's run room and diagnosis, and qualifies nothing. (0.4.0 did this by
  hand, `node benchmark/run.mjs run <case>` row by row.)
- **Diagnose a failed row from its room before calling it the model's fault.** Start from `ship.mjs --status`: for each
  model-carried row that did not hold it prints the bundle the run's report keeps -- the host's finish reason, the budget
  it used, what the relay refused, what the engine stopped, and where a run stopped short (`result.stopped`) -- beside
  the run's room. When that is not enough, the room: `<store>/benchmark/<bnr-…>/rounds/1/relay/relay.jsonl` (every
  request, exit code, refusal), `rounds/1/out/host.jsonl` (the decisions the host sent), the investigation or task
  journal, and `node benchmark/run.mjs report <bnr-…>`.
  Most 0.4.0 "misses" were Orbit defects a host could not get past: a frozen version's id nobody showed it, a step's
  result dropped, design/version refs refused, bindings it had to guess, an endpoint base path repeated, `goal resume`
  reading raw journals, a sandbox supervisor race, a retry that could never run, a 20-minute gate deadline, a refused
  run's reason kept in the worker's log, fault points and a state's key column nobody listed, a design contract the host
  could not read before proposing, an investigation held to 20 minutes while its brief promised 120, and a fault that
  left its workload down with nothing telling the host to bring it back (ship 12: ORBIT-QA-001's two crash shapes were
  false alarms on the clean app in 3 of 3 runs -- a fix that unlocks a new path, here naming fault points, can expose
  the next gap on a row that used to pass, so pre-check every model row again after one), and an observation whose match
  (`outcome: processed`) hid the redelivery that settled as `duplicate`, answering "none, complete" (ship 13: the
  crash-after-effect false alarm in 3 of 3 runs -- the host now sees what its match left out, beside where it stopped).
- **A restart mid-row is INTERRUPTED, not the model's miss** (ship 14: ORBIT-QA-001's run said PASS, but a worker restart
  cut it, the read-back run had no host identity, and the ship ended UNTRUSTED/WRONG_HOST). An interrupted model-carried
  run is never evidence; the row now runs again as a new run outside `--retries`, at most `INTERRUPTED_RUNS` (2) per
  cycle, then BLOCKS for a `--resume`. `--status` reports the newest cycle's held rows, closed or open.
- **One investigation's tests share one sandbox** (pre-check QA-006: two false alarms on the clean app -- a host waited
  for `processed` on a second message the system deduped as `duplicate`, and reused a business key an earlier test had
  used). Effect-once and competing-workers now say a second one is not a second effect, every template says the sandbox
  is shared, and a design naming an earlier test's key is told which (advisory). Pre-check rows in parallel with a ship
  -- a separate session -- found this hours before the ship reached it.
- **A new suite's model-carried rows are recorded, not required** (ADR 0051): name the suite (or case) in
  `ship/policy.json` `recorded`. The ship runs each once under `--retries`, reports it held or not with its room, and
  never blocks on it (a credential found in its room still stops the release); its controls stay required. Promotion
  to required is a person's policy change, by the rule in `docs/backlog/0.5.0.md`, never something done to get a PASS.
- **Fix an Orbit defect a row exposes with Opus at max effort** (an Agent, `model: opus`, `effort: max`): a regression
  test that fails before the fix, the full suite, the strict Five Lines lint. Never loosen an acceptance rule, a case's
  ground truth, the verifier or `ship/policy.json` to get a PASS.
- **A known finding repaired** leaves the benchmark's own case tests pinned to the old baseline: rebaseline the case
  (baseline PASS, a `controlled-fault` variant planting the old defect) in the same commit, before the next ship.
- **Publish only on** SHIPPABLE + `ship.mjs --evidence` PUBLISHABLE on the pushed head + green CI: merge the release
  PR, tag `v<version>` on the merge commit.
- **The reliability report** (0.5.0, B2): a SHIPPABLE ship keeps `reliability.json` beside `evidence.json` -- the
  benchmark's `reliability --revision=<release commit>` over every kept run of that commit (pre-checks, ship rows,
  repeats) -- and its result and `--status` name it. The release notes quote it; it is never a gate. A ship that could not
  get one says why; `node benchmark/run.mjs reliability --revision=<commit> --json` gives it again.
