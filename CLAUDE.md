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

A release qualifies on two things (ADR 0057; the whole contract is in
[skills/orbit-release/SKILL.md](skills/orbit-release/SKILL.md)): the fast tier, `node skills/orbit-release/ship.mjs
--ci`, and a record of the independent evaluator ([evaluator/README.md](evaluator/README.md)) for that very artifact,
read by `node skills/orbit-release/ship.mjs --evidence --evaluation=<record.json>`. There is no GitHub workflow (0.6.0,
backlog Q8): the gates run where the release is made, and a cloud session is the only place a model run happens. The
old in-repo Docker benchmark and its autonomous ship are gone; what they taught is in ADR 0046-0057 and the CHANGELOG.

**The campaigns, detached, with the credential mapped by name.** The coding host's token is an environment variable of
the cloud environment, kept as `ORBIT_CODE_OAUTH_TOKEN`, and mapped to `CLAUDE_CODE_OAUTH_TOKEN` for the one controller
process that needs it. Check it by name only (`test -n "$ORBIT_CODE_OAUTH_TOKEN"`); never print it. Why it is not used
under its own name:

- The real Claude Code reads its credential only under its own names (`CLAUDE_CODE_OAUTH_TOKEN`, or `ANTHROPIC_API_KEY`
  / `ANTHROPIC_AUTH_TOKEN`); an `ORBIT_*` name means nothing to it.
- The evaluator hands the credential to a run's container by NAME only (`docker -e CLAUDE_CODE_OAUTH_TOKEN`, filled from
  the controller's own environment): the value is never written, renamed or logged, and a room file that holds it is
  removed and its run is `INFRA_ERROR`. The mini-SWE-agent arms read `ORBIT_EVAL_ANTHROPIC_API_KEY` by name and are
  `NOT_RUN (credential)` without it, which the pre-registration allows (they are reported, never the verdict's).
- The cloud environment filters `CLAUDE_CODE_*` names, which steer the session's own Claude Code, so the token cannot be
  stored under its own name -- and if it could, this session's own Claude Code would take it as its credential.

So the mapping lives only in the environment of the one detached controller (`CLAUDE_CODE_OAUTH_TOKEN=… node …`), never
exported into the session. A variable added to the environment reaches a session only when it starts or its worker
restarts. A campaign is made from the pre-registration (`evaluator/prereg/<release>.json`, committed before any model
run it governs), never written by hand, and runs at the model, effort and limits the pre-registration names.

```bash
rm -f /var/run/docker.pid; setsid nohup dockerd --registry-mirror=https://mirror.gcr.io > /tmp/dockerd.log 2>&1 &
node evaluator/cli.mjs prereg verify                                   # the registered order, re-derived from its rule
node evaluator/cli.mjs prereg campaign final --rev=<release commit> --ca-file=/root/.ccr/ca-bundle.crt --out=/tmp/final.json
CLAUDE_CODE_OAUTH_TOKEN="$ORBIT_CODE_OAUTH_TOKEN" setsid nohup node evaluator/cli.mjs run /tmp/final.json \
  > /tmp/final.log 2>&1 &
node evaluator/cli.mjs status final-060                                # where it stands, and its ledger
# after a worker restart (controller gone, no `finished`): dockerd again, then the same launch with `resume final-060`
node evaluator/cli.mjs report final-060 --md
node evaluator/cli.mjs export final-060 --to=evaluator/results/0.6.0/final   # what to commit: export-ignored
node evaluator/cli.mjs record --campaign=final-060,mini-060 --out=evaluator/results/0.6.0/record.json
node skills/orbit-release/ship.mjs --ci                                # the fast tier, alone
node skills/orbit-release/ship.mjs --evidence --evaluation=evaluator/results/0.6.0/record.json
```

- **Docker Hub rate-limits** (HTTP 429): pull through `mirror.gcr.io`. **TLS is inspected** by the egress gateway:
  always `--ca-file=/root/.ccr/ca-bundle.crt`. A restart leaves a stale `/var/run/docker.pid`: remove it first.
- **The worker restarts every hour or two** and kills every process (files survive). Watch with background waits of at
  most ~100 minutes and `resume`: a campaign is read back from its journal, a run with an outcome is never run again, and
  a run a restart cut is INTERRUPTED (its cap charged) and run again as a new attempt, at most twice.
- **The ledger is hard.** A run never starts when what its phase's budget has left is below its cap; the phases' budgets
  are the pre-registration's, and nothing raises them.
- **A record is one evaluation.** Name only the campaigns of the release candidate's commit (the held-out `final` and
  `mini`, and `memory` if you want its track beside them) -- never a `dev` pass, which ran another commit. `record`
  refuses a campaign made under another pre-registration, an arm at two commits and a run in two campaigns.
- **Never commit a change that ships while an evaluation of that tree runs**: `--evidence` compares the content of
  `git archive <the commit the campaign froze>` with `git archive HEAD`. A commit that touches only export-ignored paths
  (the exported results, the record) keeps the evidence; any other voids it, and the held-out campaigns run again at
  the new commit. Park a fix on a side branch.
- **Read a run's room before calling a miss the model's.** `$ORBIT_EVAL_HOME/campaigns/<id>/runs/<key>/a<n>/`: the
  stream the host wrote, `summary.json` (cost, turns, what it said, the plugin's commands it ran), `outcome.json`, the
  patch, the grader's report, the entry and egress records. An `INFRA_ERROR` is the environment's, excluded from every
  rate and always listed; a cleanup never replaces the error that stopped a run.
- **Fix an Orbit defect a run exposes by the most general fix** (the owner's rule, with the model and effort the owner
  chose for fixes): a regression test that fails before the fix, the full suite, the strict Five Lines lint. Fix the
  CLASS of defect -- name the principle it broke, derive the fix from the ONE place that already decides it (no second
  table, no task, layer, product or shape special-cased), and hold it with a test across every existing design,
  control and fixture. Never fit a held-out task: a dev pass informs development, the held-out set only measures.
  Never loosen a gate, a verdict rule or a pre-registration to get a PASS.
- **Run `node --test` alone.** Two suite runs at once interfere. Look first (`pgrep -af 'node --test'`), let a run end or
  stop it, then run one suite into a log of its own. One backlog item to a worktree and a branch, merged one at a time,
  each merge followed by a full suite run alone.
- **Publish only on** `ship.mjs --evidence` PUBLISHABLE on the pushed head (it runs the fast tier itself): merge the
  release PR, tag `v<version>` on the merge commit -- whose content must still be the evaluated one. The release notes
  quote the comparison table it prints; IMPROVED, NO_DIFFERENCE and INCONCLUSIVE are said as what they are, and a
  one-task difference is never called a gain.
