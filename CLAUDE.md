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
session, and what the 0.4.0 ships taught.

**Run it in its own session, detached.** The coding host's token is an environment variable of the cloud environment,
but `CLAUDE_CODE_*` names are filtered there, so it is kept as `ORBIT_CLAUDE_OAUTH_TOKEN` and mapped for the one
process. Check it by name only (`test -n "$ORBIT_CLAUDE_OAUTH_TOKEN"`); never print it.

```bash
rm -f /var/run/docker.pid; setsid nohup dockerd --registry-mirror=https://mirror.gcr.io > /tmp/dockerd.log 2>&1 &
CLAUDE_CODE_OAUTH_TOKEN="$ORBIT_CLAUDE_OAUTH_TOKEN" setsid nohup node skills/orbit-release/ship.mjs \
  --credential=CLAUDE_CODE_OAUTH_TOKEN --model=claude-opus-5-5 --ca-file=/root/.ccr/ca-bundle.crt \
  --usd=150 --retries=2 --json > /tmp/ship.log 2>&1 &
node skills/orbit-release/ship.mjs --status --json          # where it stands
# after a worker restart (process gone, no ending): dockerd again, then the same command with --resume=<shp-…>
```

- **Docker Hub rate-limits** (HTTP 429): pull through `mirror.gcr.io`. **TLS is inspected** by the egress gateway:
  always `--ca-file=/root/.ccr/ca-bundle.crt`. A restart leaves a stale `/var/run/docker.pid`: remove it first.
- **The worker restarts every hour or two** and kills every process (files survive). Watch with background waits of at
  most ~100 minutes and `--resume`; a ship is read back from its journal and never re-runs a held row.
- **Model: Opus** (`--model=claude-opus-5-5`). On Sonnet most autonomous QA rows missed their planted defects.
  **`--retries=2`** lets a model-carried row that missed run again (policy bound 0..3); it holds only on its own PASS.
- **Never push to the branch while a ship runs**: `--evidence` is PUBLISHABLE only for the exact tree that qualified.
  Park a fix on a side branch and bring it in after the ship ends (or before the next one).
- **Pre-check before a full ship.** A ship stops at its first failed row after ~90 minutes of controls; run the 16
  model-carried rows directly first, each once, so every failure shows in one pass:
  `node benchmark/run.mjs run ORBIT-QA-00N` (N = 1..7), `run ORBIT-E2E-00N --variant=real` (N = 1..8),
  `run ORBIT-SRC-001 --variant=controlled-fault --repair`, each with the same `--model --credential --ca-file --usd`.
- **Diagnose a failed row from its room before calling it the model's fault**:
  `<store>/benchmark/<bnr-…>/rounds/1/relay/relay.jsonl` (every request, exit code, refusal), `rounds/1/out/host.jsonl`
  (the decisions the host sent), the investigation or task journal, and `node benchmark/run.mjs report <bnr-…>`.
  Most 0.4.0 "misses" were Orbit defects a host could not get past: a frozen version's id nobody showed it, a step's
  result dropped, design/version refs refused, bindings it had to guess, an endpoint base path repeated, `goal resume`
  reading raw journals, a sandbox supervisor race, a retry that could never run, a 20-minute gate deadline, a refused
  run's reason kept in the worker's log, fault points and a state's key column nobody listed, a design contract the host
  could not read before proposing, an investigation held to 20 minutes while its brief promised 120, and a fault that
  left its workload down with nothing telling the host to bring it back (ship 12: ORBIT-QA-001's two crash shapes were
  false alarms on the clean app in 3 of 3 runs -- a fix that unlocks a new path, here naming fault points, can expose
  the next gap on a row that used to pass, so pre-check every model row again after one).
- **Fix an Orbit defect a row exposes with Opus at max effort** (an Agent, `model: opus`, `effort: max`): a regression
  test that fails before the fix, the full suite, the strict Five Lines lint. Never loosen an acceptance rule, a case's
  ground truth, the verifier or `ship/policy.json` to get a PASS.
- **A known finding repaired** leaves the benchmark's own case tests pinned to the old baseline: rebaseline the case
  (baseline PASS, a `controlled-fault` variant planting the old defect) in the same commit, before the next ship.
- **Publish only on** SHIPPABLE + `ship.mjs --evidence` PUBLISHABLE on the pushed head + green CI: merge the release
  PR, tag `v<version>` on the merge commit.
