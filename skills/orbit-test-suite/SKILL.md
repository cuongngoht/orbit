---
name: orbit-test-suite
description: >
  Run an agreed set of JSON cases the way a tester does: pick the browser and the signed-in
  profile on this machine, drive the cases one at a time with evidence, then write ONE review
  page for the whole session and hand over the checks a browser cannot make. Use when asked to
  run the tests, to test a build or a release, to execute a plan that is already written, or
  when someone wants a report over a set of cases rather than over a single run. Deciding what
  to test and writing the cases are different jobs: asked to WRITE a plan or design scenarios,
  use orbit-test-plan instead and run nothing.
argument-hint: <case ids to run | plan file | "run the suite on this build">
allowed-tools:
  - Read
  - Glob
  - Grep
  - AskUserQuestion
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/*)
user-invocable: true
---

**Host binding:** On protocol v2, resolve the plugin root from this SKILL.md’s actual location and bind the host/protocol/hashed session supplied at startup on every Orbit shell invocation. Resolve command examples against that root; do not assume hook exports persist. Follow [the shared host contract](../../docs/hosts.md) for task stdin, runtime isolation and unavailable native capabilities. Use the supported native protocol for the selected host.

# Run the cases, then say what a person still has to check

Everything below runs from inside the consuming project.

**Two shared references, the same for every `orbit-*` playbook.** Read the one you need; do not
re-derive what is in them:

- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/tools.md` — which Claude Code tool does
  which QA job, what to do when an optional one (LSP, ToolSearch, a subagent, an MCP server) is not
  in this session, and the lines that do not move.
- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/dsl.md` — how to read the JSON DSL off the
  tables that define it (`query.mjs dsl`) instead of from memory.

Three jobs; this skill is the middle one:

| | who | output |
|---|---|---|
| what to test | `orbit-test-plan`, in conversation with a human | `$DATA/screens/<screen>/<id>.plan.json` |
| **drive it, and review it** | **this skill** | one evidence dir per run · `review.html` · `coverage.html` |
| is the product actually right | a **person**, from the review's last section | a sign-off, and a note |

A run produces a **verdict**, not a sign-off. A case proves what it was written to prove and
nothing more, so a session ends with a human, never with a green table.

**"Write a plan" is not "run the tests."** If what was asked for is a set of scenarios, an
acceptance-criteria review or a plan for a feature, this is the wrong skill: `orbit-test-plan` does
that, in conversation, and nothing is driven.

## 0. Recall and check, before anything opens

```bash
node <engine>/cli/query.mjs check                 # exits 1 on findings — fix the map or the case FIRST
node <engine>/cli/plan-check.mjs                  # exits 1 on plan errors — a plan that lies about itself
node <engine>/cli/query.mjs doctor                # are this project's declared tools usable here?
node <engine>/cli/query.mjs flaky                 # which cases do not give one answer
node <engine>/cli/query.mjs notes machine         # what this machine needed last time
node <engine>/cli/query.mjs history <case>        # has it ever passed, and what did it fail on
node <engine>/cli/learn.mjs recall <case>         # what several sessions already worked out
node <engine>/cli/knowledge.mjs verify --for="<the feature under test>" --purpose=verification --workflow=orbit-test-suite
```

`knowledge verify` says what these cases would have to prove that nothing on this machine can
observe. A DEMANDED opportunity is a consequence this session cannot witness: name it in the
review's hand-over (step 4) as a check a person still owes, never as a pass and never silently
dropped. Relay any question it prints; deciding an opportunity is the person's, with `--human`.

An invalid case is not a failing product. If `check` exits 1, stop and fix that — a session run
on a broken map produces findings nobody can act on. A case `flaky` already knows about is one to
watch, not one to re-investigate from scratch.

### The agreed set comes from the plan

```bash
node <engine>/cli/qa-plan.mjs plans                              # which plans exist, and whether they are clean
node <engine>/cli/qa-plan.mjs show <plan>                        # every scenario, and where it has got to
node <engine>/cli/qa-plan.mjs select <plan> --profile=smoke --budget=90
node <engine>/cli/qa-plan.mjs coverage <plan>                    # what is still unproven, before you start
```

`select` is the set, in the order it prints, and it also prints **what it leaves unproven** —
read that out before running anything, because it is the part nobody sees in a green table. If it
says SHORTFALL, the budget cannot hold the must-run scenarios: that is a person's decision, not
yours to resolve by running fewer.

Run a scenario's cases **after** the scenarios it `dependsOn`. A scenario that is `blocked` or
whose cases are `planned` is not runnable — report it, do not improvise around it.

## 1. Pick the browser and the profile — ask, never guess

The engine never opens a browser. The project's `launcher` does, and on a machine whose tester is
signed in through Chrome or Edge, the `orbit-browser` skill is that launcher.

```bash
node <engine>/skills/orbit-browser/pick.mjs --json   # what is installed HERE, with profiles
```

Offer **only** what the list returned, with `AskUserQuestion`: browser first, then profile shown
by `name` and `email` so the person recognises the account — and pass its `dir`, never its display
name, because on a real machine the directory `Profile 1` is shown as "Profile 2". Close the
browser before copying a profile: a profile copied mid-write opens signed **out**, which reads
exactly like the product logging you out.

**You must call the launcher yourself.** A project with a preflight guard has to see the launch;
`run-awake.mjs` is a human's unattended tool and says so when an agent runs it. Export the run
directory the launcher printed (`ORBIT_RUN_DIR`) before the first case.

## 2. Drive the cases, one at a time

```bash
node <engine>/cli/run-case.mjs <id> NAME=TC-… --dry       # anything never run here: read the plan first
node <engine>/cli/run-case.mjs <id> NAME=TC-… --report    # then for real, with a report per run
```

For a draft, add `--draft` to both commands. For replay, use the HTML path as
the case reference. New cases stay in memory after PASS; see
`${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/storage.md`. Every live retry also uses `--report`.


- One case per command, in the order the plan lists them. Never re-drive a failed step by hand
  out of the log: fix the case or the map, then re-run.
- Exit **0 PASS** · 0 SKIP · 0 PARTIAL (a slice — *not* the case passing) · **1 FAIL** ·
  **2 REFUSED** · **3 BLOCKED** · **4 INCONCLUSIVE**. Only PASS means verified.
  **BLOCKED is never a defect** — a database out of reach or a spent deadline says nothing about
  the product. REFUSED means a precondition, usually the session or the identity.
- `--force-destructive` only after the person has said yes to that case, in this session.
- A case that passed live and was written `"seen": "src"` gets `"seen": "live"` and the current
  `fe_commit` recorded in the same turn — the map dates itself or it rots.
- Every finished run records the build and the environment it ran on. That is what lets coverage
  say whether a PASS is about the revision in hand, so do not hand-edit a ledger line.

## 2b. When one fails: classify, then route. You orchestrate; specialists repair.

A failure is not yet a finding. The sentence to distrust is *"the click timed out, so the selector
must have changed"* — sometimes it had, and just as often the product never reached that state, or
the wait was asking the wrong question. Editing the map on that basis hides a real defect.

**Self-healing here never means "change the test until it passes."** It means: classify what is
wrong, repair only the artifact that category owns, put the repair back through the same engine
check that would have rejected it, and then decide separately whether to run again.

```bash
node <engine>/cli/query.mjs triage [<evidence-dir>]          # to read: shows · may be · cannot tell
node <engine>/cli/query.mjs triage [<evidence-dir>] --json   # to route
```

Then **one** analyst, and route on what it returns:

| class | route to | and it may not |
|---|---|---|
| `DSL_INVALID` | `orbit-dsl-doctor` | change what the test MEANS — no flipped expect, no relaxed status, no dropped verdict |
| `MAP_DRIFT` **high only** | `orbit-map-healer` | apply its own patch, or touch a case |
| `CASE_LOGIC` | a person — the case owes a decision | be auto-repaired |
| `PRODUCT_FAILURE` | nobody. **Preserve it**: evidence, report, ticket | be healed away by weakening the case |
| `ENVIRONMENT` / BLOCKED | report the blocker | cause any edit to a case or the map |
| `AUTH` | the identity / session workflow (§1) | be worked around by dropping roles |
| `DATA` | a person — the data or the `resolve` row | be worked around by hard-coding an id |
| `TIMING` | a person. Budgets are **not** raised to make a case green | become a longer timeout |
| `UNKNOWN` | nobody. Report the evidence and what to gather | be speculatively repaired |

The rules that make that table safe:

- Run the analyst for FAIL, REFUSED, BLOCKED or INCONCLUSIVE. Not for a PASS.
- **A low confidence routes nowhere.** `triage` names the one command that would settle it —
  usually `query verify`. Run that first. A specialist handed an uncertain classification repairs
  the wrong artifact and then reports that it fixed something.
- **One repair round per failure.** If it is still not clean, stop and put it in the review.
- A specialist only ever touches the artifact it owns: the doctor the case JSON, the healer a
  scratch patch. **One writer for the map** — the healer proposes, you apply after a live look.
- One browser session and one identity at a time. Two agents in one signed-in browser produce a
  run neither can explain.

### Verification, and then — separately — a re-run

Every repair goes back through the engine that would have rejected the bad artifact:

```bash
# a DSL repair
node <engine>/cli/query.mjs check
node <engine>/cli/run-case.mjs <case> <known params> --dry

# a map repair, after a live look at the control
node <engine>/cli/record-edge.mjs <patch.jsonl> --replace --dry
node <engine>/cli/record-edge.mjs <patch.jsonl> --replace
node <engine>/cli/query.mjs check
node <engine>/cli/run-case.mjs <case> <known params> --dry
```

Reuse the parameter values already known — from the command that failed, from `params` in the
result JSON, or from the case's defaults. **Never pass a `resolved` or `captured` value as a
param**: SQL produced the first and a step bound the second, and the result JSON keeps the three
apart on purpose.

`--dry` proves the case validates, the params resolve as far as it can know, and the planner can
build every step. It proves **nothing** about the product, the browser, the API or the database.
So a repair verified by `--dry` is **never** reported as a pass.

**A live retry is a separate decision, and it is yours, not the repair's.** A run can create,
change or delete real data and send real requests. For a case whose execution the person already
agreed to this session, re-run it — the whole case, because a slice that holds is PARTIAL. For
`destructive: true` the human opt-in from §1 still applies, every time; never invent or persist
`--force-destructive` to get a retry through.

The failed run stays exactly as it is. The re-run is new evidence, and the review shows both.

## 3. Write the review — one page for the whole session

```bash
node <engine>/cli/review.mjs                     # this machine, today
node <engine>/cli/review.mjs --since=2026-09-18 --out=$REPORTS/review.html
```

Every finished run already went to the shared ledger, so the review is built from that: the cases
that ran, what each one **proved** (`ui n · api n · sql n`), who it ran as, and a link to each
run's own `report.html`. A case in the project with **no run in the window is listed too** — the
easiest thing to lose in a test session is the case nobody remembered to run.

Send the review with its linked report HTML pages: the per-run reports embed their
screenshots, but the review links to them.

Then say what the session did to the PLAN, which the review cannot:

```bash
node <engine>/cli/qa-plan.mjs coverage <plan> --out=$REPORTS/coverage-<plan>.html
```

It reports the chain — criterion, scenario, case, run, evidence — and it counts only what was
actually verified. **SKIP, PARTIAL, REFUSED, BLOCKED and INCONCLUSIVE never raise coverage**, and
neither does a PASS recorded against an older plan revision, an older build or another
environment: those stay in the history and are listed as evidence that is not current. Do not
edit a scenario to make the page look better — the page is the point.

## 4. Hand over what the browser could not see

The review's last section is the handover, and it is derived, not written by hand:

- **proved on the screen only** — the case passed, and nothing below the screen witnessed it. A
  screen can show a write that never happened. Either a person opens the record, or the case owes
  an `api`/`sql` verdict (say which you recommend).
- **no verdict on the product** — SKIP, PARTIAL, BLOCKED, REFUSED, INCONCLUSIVE. Say what to fix;
  do not file any of them as a defect.
- **failed** — reproduce it by hand before calling it a product bug, and say which of the three
  you believe is wrong: the product, the case, or the map. §2b is how that is decided; if it was
  never decided, the honest line is "not classified — the evidence could not tell", not a guess.
- **not run in this window** — run it, or write down why it was left out.

Plus whatever the plan put under **Manual checks**: a queue, a mail, a scheduled job — anything
`query layers <screen>` lists that no browser can observe. Those never become a JSON case that
would quietly assert nothing.

## 5. Close the loop

The runs are in the ledger already, so write a **note** only for what the ledger cannot say:

```bash
node <engine>/cli/note.mjs "case:<id>" "<title>" "<body>" --type=finding
```

"It passed" is never a note. "That 403 was the VPN, not the product" is — it is the sentence that
stops the next session investigating the same failure from scratch. Nothing secret goes in one:
the notes live in machine memory and may be shared or projected.

Then fold the session into what is already known. This is the milestone — a session ends when a
review is written, not when a case does:

```bash
node <engine>/cli/learn.mjs analyse --since=<today>   # what these runs change about what we know
```

Read its DEMOTED lines out to the person. Something they were told was reliable is not any more.

A map correction that made a case pass again is worth a **note** on the record, and it is *not*
yet a lesson: one session is an observation, and `analyse` prints it rather than storing it. Two
independent sessions earn the lesson — one machine on one UTC day each — so do not re-run the
case three times this afternoon to "confirm" it. That is one confirmation, and the engine counts
it as one.

## Done means all of these

- [ ] `check` exited 0 before the first run
- [ ] every case in the agreed set ran, or is listed in the review as not run, with a reason
- [ ] each run's evidence dir exists and the review links its report
- [ ] every failure was classified before anything was edited, and a map correction was applied
      only with a live look and followed by a full re-run — never a slice reported as a pass
- [ ] the review's handover section was read out to the person, not just written to a file
- [ ] cases that ran live carry `"seen": "live"` and the `fe_commit` they ran at
- [ ] the plan's coverage page was written, and what is still unproven was read out
- [ ] nothing was marked verified on a run this session did not make, or on an older revision
- [ ] what was concluded — and only that — is in a note
- [ ] the session was folded in with `learn analyse`, and any demotion was read out
