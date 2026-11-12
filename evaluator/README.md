# Orbit evaluator

An **independent** evaluator: it measures what a plugin adds to a coding host by running the same task, with the same
model, effort, tools, limits and prompt, with and without the plugin, and grading the patch each run leaves by **hidden
tests the agent never sees** -- never by the agent's own word, and never by the plugin's own records.

It is a package of its own (no dependency, Node >= 20 built-ins only). It imports nothing of the plugin's source and
nothing of the plugin imports it (`test/evaluator-boundary.test.mjs` in the repository holds both ways). It is
export-ignored, so the plugin archive an agent is handed never holds a hidden test or a gold patch, and it can be split
into its own repository with `git subtree split --prefix=evaluator`.

## Three roles, kept apart

| Role | What | Where |
|---|---|---|
| Task source | local packs (`pack:<id>`); SWE-bench Verified rows (`swebench:<instance id>`) | `lib/tasks/`, `tasks/packs/` |
| Arm (what is under test) | `claude` (plain Claude Code), `claude+orbit` (Claude Code with `--plugin-dir` = `git archive <rev>` of the plugin repository), `mini` and `mini+orbit` (mini-SWE-agent, plain and with the plugin listed), `scripted` (self-controls only) | `lib/arms/` |
| Grader | hidden tests in a fresh container with no network, on the patch alone, after the agent's container is gone | `lib/grade/`, `lib/container/grade-pack.mjs` |

A new arm is one new file in `lib/arms/` registered in `lib/arms/index.mjs`.

## The mini-SWE-agent arms

A second coding host makes a 2 x 2 -- {Claude Code, mini-SWE-agent} x {plain, + the plugin} -- so a gain can be told
apart as the plugin's or the host's. mini-SWE-agent 2.4.6 (`lib/core/versions.mjs`) is installed pinned in a uv
virtualenv under `$ORBIT_EVAL_HOME/tools/`, and runs on the HOST (`lib/arms/mini-driver.py`, with that virtualenv's
Python): its default agent and default config (`mini.yaml`), its Docker environment attached to the task container the
runner made, so every command runs there by `docker exec`. That container gets **no network at all** (the model is
called from the host process; the entry checks that nothing gets out and no outside name resolves) and no credential;
it runs a hold (`lib/container/hold.mjs`) while the host's agent works, and is then released and graded like any other.
The driver writes what happened as stream-json, so a mini run is read, scored and reported exactly as a Claude Code run.

Same model, effort (`reasoning_effort`, which the client sends as adaptive thinking with that effort), step limit (=
the turn cap), USD cap (mini's cost limit, from its client's price table), wall time and prompt as the Claude Code
arms. Two settings differ from `mini.yaml`, for every mini arm alike: commands run with `bash -c` (a login shell's
`/etc/profile` resets PATH, and every arm must see the container's own PATH, HOME and ORBIT_STORE_DIR) and with a 1800 s
command timeout (Claude Code's Bash timeout here).

`mini+orbit` gets the same plugin archive as the Claude Code plugin arm (Node is in the tools volume both mount) and
ONE paragraph added to the system template: each skill's name and description, read from the archive's `SKILL.md`
frontmatter, and how to use one (read `<plugin>/skills/<id>/SKILL.md` and follow it; its commands run as
`node <plugin>/cli/<x>.mjs ...` with ORBIT_STORE_DIR set). Listed, never ordered. mini-SWE-agent has no hooks and no
Skill tool, so this arm measures what an agent understands and does with the plugin through a shell -- never what the
plugin's hooks add.

The credential: `ORBIT_EVAL_ANTHROPIC_API_KEY`, checked by name, set as `ANTHROPIC_API_KEY` in the environment of the
one driver process and nowhere else (never the container, never a file). When the controller's environment lacks it,
the run is `NOT_RUN (credential)`, charged nothing, and tried again on a resume; the campaign goes on.

## The seated condition

An arm that carries the plugin (`claude+orbit`, `mini+orbit`) may be **seated**: `"seat": true` in its definition.
Before the agent starts, the entry (`lib/container/entry.mjs`) runs, once, inside the task container, the plugin's own
adoption command -- `node /opt/orbit-plugin/cli/help.mjs` in the checkout (`lib/arms/plugin.mjs SEAT_ARGV`), what the
plugin's `/orbit-help` runs the first time a person asks in a repository: it binds the checkout in the store and writes
nothing in the checkout -- with the run's fresh `HOME` and `ORBIT_STORE_DIR`, as the user the agent runs as, with none of
the credential names the container holds, bounded to 300 s. The entry then compares every file of the checkout (the root
`.git` apart, as the patch is taken) byte for byte and by mode with what it was before the seat; a seat command that
failed, ran past its time or wrote the checkout ends the run `INFRA_ERROR` (`SEAT`) and no agent runs. What it wrote in
the store is listed in the run's facts (`seat` in the `ended` line), its output is the room's `out/seat.out`, and the
manifest says `seated: true` with the command's argv. No turn of the agent is spent on it, and it is the same for every
arm that carries a plugin, whatever its revision.

Why: the plugin's hooks observe only a checkout the machine knows -- one a person has used the plugin in -- so an
unseated arm measures the plugin installed and never used in the repository, and a seated arm the plugin as an adopter
has it. Which condition a release is judged by is its pre-registration's (an amendment's, for 0.6.0's seated phases).

## Claude Code's built-in plugins

Claude Code 2.1.322 loads three built-in plugins in every session (`cc-plugin-agents-md`, `cc-plugin-privacy`,
`cc-plugin-plugin-authoring`). Every Claude Code arm alike switches them off through the fresh home's user settings
(`/work/home/.claude/settings.json`, `enabledPlugins: false`; `lib/arms/claude.mjs HOST_SETTINGS`), so the only plugin
an arm differs by is the one under test.

## One run

One fresh container per (arm, task, trial), from the task's image (`node:22` for a pack, the SWE-bench instance image
for a row), with:

- **Node and ONE pinned Claude Code** (`lib/core/versions.mjs`: 2.1.322) in a tools volume built once and mounted
  read-only at `/opt/eval`, so every arm of every task runs the same host binary in any (glibc) image.
- **The same argv for every model arm** (`lib/arms/claude.mjs hostArgs`): `-p --output-format stream-json --verbose
  --permission-mode dontAsk --allowedTools Read,Edit,Write,Glob,Grep,Bash,Skill,Agent,TodoWrite --disallowedTools
  WebFetch,WebSearch --setting-sources user --strict-mcp-config --no-session-persistence --model --effort
  --max-budget-usd --max-turns`. The only difference between arms is `--plugin-dir /opt/orbit-plugin`.
- **A fresh `HOME` and `ORBIT_STORE_DIR`** (the container is new). A memory track (`tracks` in a campaign) keeps one
  store across a declared sequence of tasks: copied out after each run and in before the next.
- **The prompt**: the task's issue text and one fixed closing paragraph (`lib/run/prompt.mjs`) asking for the change in
  the working tree and a last line `EVAL_STATUS: DONE` or `EVAL_STATUS: BLOCKED <why>`.
- **Network**: an internal Docker network whose only way out is an egress proxy (`lib/container/egress.mjs`) that
  allows CONNECT to `api.anthropic.com:443` and nothing else. Before the agent starts, the entry
  (`lib/container/entry.mjs`) checks from inside the container that nothing direct gets out, no outside name resolves,
  the API answers an HTTPS request through the proxy, and another host is refused -- else the run is `INFRA_ERROR`
  (`EGRESS`) and no agent runs. Where TLS is inspected, pass `--ca-file=<pem>`: it is mounted read-only and named in
  `NODE_EXTRA_CA_CERTS`.
- **The credential by name only**: launch the controller as
  `CLAUDE_CODE_OAUTH_TOKEN="$ORBIT_CODE_OAUTH_TOKEN" node evaluator/cli.mjs run <campaign.json>`. Docker is told
  `-e CLAUDE_CODE_OAUTH_TOKEN` and fills the value from the controller's own environment; no `ANTHROPIC_*` name of the
  host is ever handed on. The value is read in memory once, to scan each run's room for it; a room file that holds it
  (raw, base64, base64url or percent-encoded) is removed and the run is `INFRA_ERROR` (`CREDENTIAL_IN_ROOM`).
- **Limits**: USD cap and turns (Claude Code's own flags), wall minutes (the container is killed: `TIMEOUT`), CPUs,
  memory and pids (Docker).

After the agent ends, the controller copies the repository out and takes the **patch** as the difference between the
start tree and the tree the agent left, through a git directory of its own (`lib/core/git.mjs`): a commit, a reset or a
deleted `.git` in the agent's checkout changes nothing that is graded. Every tree a run compares is staged in, and read
from, that ONE git directory (`startOfWork`, `endOfWork`), whatever the task source: a start tree need not be HEAD's (an
instance image's untracked build output is part of what the agent was handed), so its objects exist only there. Then the patch alone is graded in a fresh
container. Every container and network carries the labels `orbit.eval=1`, `orbit.eval.campaign`, `orbit.eval.run`,
`orbit.eval.role`, and only what carries them is ever removed. A cleanup runs every step (`allSettled`) and never
replaces the error that stopped a run.

**A run's failure is that run's outcome, never the campaign's end.** What throws while a run's start is built, while it
runs or while its patch is taken ends that run `INFRA_ERROR` with a code (`START`, `RUN`, `PATCH`; `TASK` when its task
cannot be read on a resume) and one line of why; what throws while it is graded ends it `UNGRADABLE` (`GRADE: ...`).
Each is journaled like any outcome, the whole error kept in the run's room (`error.txt`), and the campaign goes on to
its next run. Only the campaign's own failures end it -- its tools volume, its journal, Docker no longer answering at
all (that attempt is left open, so a resume closes it INTERRUPTED and runs it again) -- said in a `halted` line.

## Outcome words

One per run, from what the controller and grader **observed** (`lib/core/outcome.mjs`, an ordered table):

| word | when |
|---|---|
| `INFRA_ERROR` | Docker, the network or egress check, the API or the credential, a container killed from outside, a credential found in the room. Excluded from every rate, always listed |
| `TIMEOUT` | the run passed its wall time and was stopped |
| `BUDGET` | Claude Code stopped on its USD cap |
| `EMPTY_PATCH` | the working tree is as it started |
| `UNGRADABLE` | the grader could not run, or the patch would not apply |
| `REGRESSED` | a pass-to-pass test now fails |
| `RESOLVED` | every hidden fail-to-pass test passes and no pass-to-pass test fails |
| `FALSE_DONE` | the agent said `EVAL_STATUS: DONE` and the patch is not resolved |
| `UNRESOLVED` | otherwise |

Recorded beside the word (`summary.json`, from the stream-json `result` and `init` lines): cost, tokens, turns, wall
time, permission denials, the status said, whether the last message asked the person something (an intervention
needed), Skill and Agent calls, Bash calls that ran a plugin CLI (`/opt/orbit-plugin/cli/<x>.mjs`), the plugins the host
loaded, image ids, Claude Code version, model, effort, the plugin's commit and archive digest, and the evaluator's
commit. Cost, tokens and turns are the host's own word: reported, never used to decide an outcome.

## Campaigns

A campaign is a JSON file: a list of (arm, task, trial) with limits, a model, an effort and a total USD budget.

```json
{
  "schema": 1, "id": "baseline-dev", "model": "<model id>", "effort": "medium", "budgetUsd": 20,
  "limits": { "usd": 1, "turns": 80, "minutes": 40, "cpus": 2, "memoryMb": 4096, "pids": 2048 },
  "arms": { "plain": { "kind": "claude" }, "orbit-0.5.0": { "kind": "claude+orbit", "rev": "v0.5.0" } },
  "tasks": ["pack:orders-e2e-001", "pack:lending-hld-001"], "trials": 1, "order": { "shuffle": 11 },
  "tracks": [{ "id": "m1", "arm": "orbit-0.5.0", "tasks": ["pack:orders-e2e-001", "pack:orders-e2e-005"] }],
  "caFile": "/path/to/ca-bundle.pem"
}
```

Its room is `$ORBIT_EVAL_HOME/campaigns/<id>/` (default `~/.orbit-eval`, never in a repository): `campaign.json` frozen
at start (each arm's plugin commit, each task's digest, the Claude Code version, the evaluator's commit), `journal.jsonl`
(started, ended, outcome, interrupted, skipped, halted), and `runs/<key>/a<n>/` (manifest, stream, entry record, egress log,
patch, grader report, summary, outcome). Scratch trees are removed when a run ends.

- **Hard ledger**: a run does not start when what the budget has left is below its USD cap; an ended run is charged its
  reported `total_cost_usd`, or its whole cap when the stream has no result line; an interrupted one its whole cap. A
  run whose arm's credential the controller's environment lacks is `NOT_RUN`, charged nothing.
- **Images**: a task image the campaign pulled is removed as soon as no run left in the plan needs it, so a campaign
  that goes task by task (as a pre-registered one does) holds one SWE-bench instance image (about 4 GB) at a time.
- **Resume**: a run started and never ended is INTERRUPTED (its containers removed by their labels, its cap charged) and
  run again as a new attempt, at most twice; a run with an outcome is never run again.

```bash
node evaluator/cli.mjs run <campaign.json> [--ca-file=<pem>]     # detached: setsid nohup ... > log 2>&1 &
node evaluator/cli.mjs resume <id>                               # after a worker restart
node evaluator/cli.mjs status <id> [--json]
node evaluator/cli.mjs report <id> [--md]                        # per arm, and task by task
node evaluator/cli.mjs export <id> --to=evaluator/results/<release>   # what to commit (streams over 1 MB as a digest)
node evaluator/cli.mjs cleanup <id>                              # leftover containers and networks, by label
node evaluator/cli.mjs tools [--ca-file=<pem>]                   # build or show the tools volume
node evaluator/cli.mjs prereg verify                             # the pre-registration re-derived from its rule, amendments held to it
node evaluator/cli.mjs prereg campaign <phase> [--rev=<commit>]  # a phase's campaign, built from the pre-registration (or an amendment)
node evaluator/cli.mjs record --campaign=<id>,... [--out=<file>]  # the release's record: primary verdict, and an amendment's secondary
```

A release's runs are governed by its pre-registration (`prereg/0.6.0.json`, committed before any model run; see
`prereg/README.md`): the selection rule and seed, the order of the tasks, the arms, limits, prompt, outcome table,
comparisons, verdict rule and ledger. Its campaigns are made from it with `prereg campaign`, never written by hand. A
registration is never edited after its runs began: a condition or a phase added later is an AMENDMENT beside it
(`prereg/<release>-amendment-<n>.json`), which names the registration's digest, only adds -- arms, phases, comparisons the
release gate does not read (`gate: false`) and a ledger of its own -- and is committed before any run of its own phases.
A campaign of an amendment's phase freezes the amendment's digest beside the registration's. The record (`record`)
carries the registration's comparisons and verdict as the PRIMARY ones, which the release gate reads, and an amendment's
as `secondary`, which it never reads.

## Task packs

`tasks/packs/<id>/` (ten, from the old benchmark's `orders` and `lending` change cases; `lib/tasks/convert.mjs`):
`issue.md` (the request, verbatim), `start.json` (the starting repository as data), `hidden/` (the fail-to-pass tests:
the public test files the starting state lost, and the case's spec and probe behind one generic node test,
`hidden/acceptance.spec.mjs`), `pack.json` (the pass-to-pass test files, the hidden targets, the grading limits) and
`controls/*.patch` (gold, half, cheat, and two the converter derives for every pack: tamper -- no fix, every graded
test replaced by one that passes -- and regress -- gold, a module a pass-to-pass test imports emptied, that test
deleted). The grader puts every graded test file back as the start had it before running, so a patch that edits or
deletes a test is graded by the original. Cases that cannot be packs are listed in `tasks/packs/EXCLUDED.md`.

Nothing under `evaluator/` is a file `node --test` would discover: hidden tests are `*.spec.mjs` and become
`test/<name>.test.mjs` only inside the grading container.

## Proving the evaluator without a model

```bash
node evaluator/cli.mjs checks                   # its own checks, no Docker (or: node --test 'evaluator/checks/*.check.mjs')
node evaluator/cli.mjs packs verify             # every pack's grader on the empty patch and on each control patch
node evaluator/cli.mjs selfcheck --ca-file=<pem>   # the scripted controls, for real, through the same runner
```

The self-check runs, on `orders-e2e-006` and `lending-hld-001`: gold + DONE -> `RESOLVED`; no change + DONE ->
`EMPTY_PATCH`; half + BLOCKED -> `UNRESOLVED`; half + DONE -> `FALSE_DONE`; tamper + DONE -> `FALSE_DONE` (graded by the
hidden tests); regress + DONE -> `REGRESSED`; and on the first pack a container killed from outside -> `INFRA_ERROR`
(`KILLED`), a run over its wall time -> `TIMEOUT`, an egress that cannot reach the API -> `INFRA_ERROR` (`EGRESS`) before
the agent starts; seated with the plugin of `HEAD` + gold + DONE -> `RESOLVED`, the seat ended 0, the checkout unchanged
and the plugin's binding file (`state/checkouts/<id>.json`) in the run's store; a seat command that writes the checkout ->
`INFRA_ERROR` (`SEAT`) before the agent starts; then that nothing of the campaign is left on the daemon. And both mini-SWE-agent arms, with mini-SWE-agent's own
`DeterministicModel` in place of a model: the gold patch applied through `docker exec` into a container with no network
-> `RESOLVED`; the plugin arm lists the plugin's skills and runs one of its commands through the shell.
