---
name: orbit-qa
description: >
  Investigate a live application the way a senior QA engineer would, autonomously and inside
  approved limits, from a SCREEN, a PBI (a requirement and its acceptance criteria), or both: one
  step at a time, each chosen from what the last one showed. Recall what the project already
  knows, work through what the engine says is still owed — a read-back after every write, a
  suspicion to settle, a scenario's layer to prove — watch the screen, the console, every request
  and the data, verify tenant isolation when a person declared a contract, and stop for a reason
  the engine can justify, with receipts kept and one evidence-backed report. Use when asked to
  find bugs on a screen, to verify a PBI with or without a UI, to check a feature from UI to
  database, or to resume an investigation. Not for designing a plan with a person
  (orbit-test-plan) or running agreed cases (orbit-test-suite).
argument-hint: <a screen, a PBI file, or both — e.g. "the orders screen" | "check PBI-7 refund rules" | "resume inv-…">
allowed-tools:
  - Read
  - Glob
  - Grep
  - AskUserQuestion
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/*)
user-invocable: true
---

**Host binding:** On protocol v2, resolve the plugin root from this SKILL.md’s actual location and bind the host/protocol/hashed session supplied at startup on every Orbit shell invocation. Resolve command examples against that root; do not assume hook exports persist. Follow [the shared host contract](../../docs/hosts.md) for task stdin, runtime isolation and unavailable native capabilities. Use the supported native protocol for the selected host. On Codex and Antigravity there is no native subagent: run this loop in the main session.

# Investigate, one step at a time. Prove what you claim.

**Shared references, the same for every `orbit-*` playbook.** Read the one you need; do not
re-derive what is in them:

- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/tools.md` — which host tool does which
  QA job, and the lines that do not move (a denied permission is reported, never routed around).
- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/storage.md` — where everything lives;
  run `query storage --json` before touching a project path.
- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-qa/references/settings.md` — what a PERSON approves
  (environments, modes, identities, limits, the contracts a finding is held to, memory).
- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-qa/references/protocol.md` — the decision you send
  each step, and what comes back. The fields themselves: `autonomous-qa.mjs protocol`.

You are the reasoning; `cli/autonomous-qa.mjs` keeps the state. You choose the next step; the
engine checks it, runs it inside gates you cannot argue with, writes down what it saw, re-derives
what is still OWED, and tells you when there is a reason to stop. **You never assert a verdict,
a confidence or an approval — you send decisions, and the engine derives the rest from evidence.**

| word | means | never |
|---|---|---|
| **obligation** | one behaviour × one layer × one context still to settle: `pending · satisfied · violated · blocked · needs-approval · needs-requirement · not-applicable` | a PASS |
| **finding** | what the evidence says about the product: `CONFIRMED_DEFECT · SUSPECTED_DEFECT · REQUIRES_REQUIREMENT · INCONCLUSIVE · BLOCKED · OBSERVED_EXPECTED_BEHAVIOR` | PASS or FAIL — those are run-case's alone |
| **receipt** | what a settled obligation came to, on which evidence, against which oracle | a verdict |

A finding is CONFIRMED only on an oracle that confirms: a contract a person declared, the map's
recorded effect, or the product contradicting itself. A requirement from a DRAFT source — a PBI
nobody accepted, a plan an agent wrote — prepares tests and never confirms anything.

## 0 · Before anything: what is already known

1. `node ${CLAUDE_PLUGIN_ROOT}/cli/context.mjs --for="<the objective>"` — project context, memory first.
2. `node ${CLAUDE_PLUGIN_ROOT}/cli/knowledge.mjs claims --for="<the objective>"` — what earlier
   work verified, with each claim's authority. A host-memory hint targets where you look; it is
   never evidence.
3. `node ${CLAUDE_PLUGIN_ROOT}/cli/query.mjs check` and `query.mjs screens` — the map an
   investigation is held to. A control the map does not name is a control you cannot touch.
4. `node ${CLAUDE_PLUGIN_ROOT}/cli/autonomous-qa.mjs list` — earlier investigations: one that is
   `paused` may be the one to resume (§6) rather than a new one.

## 1 · Choose the way in — the engine derives which it is

| you have | start with | the engine calls it |
|---|---|---|
| a screen or a feature on screen | `--screen=<id>` and/or `--scope="<words>"` | `screen` |
| a PBI, and a plan for it | `--plan=<plan-id>` (the checkout's, or a draft) | `pbi`, or `hybrid` when the plan names a screen |
| a PBI and no plan yet | read it, write the plan in orbit-test-plan's vocabulary, then `draft-plan` it (below) | `pbi` |
| a requirement settled by `orbit-requirements` | `--snapshot=<rs-id>` (its id, digest and whose word it is are kept — never a fact's text; a draft snapshot never confirms a finding) | `pbi`, or `hybrid` with a screen |
| a PBI file to keep a fingerprint of | `--input=<file>` (its ref, revision and digest are kept — never its text) | adds to either |

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/autonomous-qa.mjs plan --objective="<the question>" [--screen=<id,…>] [--plan=<id>] [--snapshot=<rs-id>] [--input=<file>] [--mode=observe] [--env=<id> | --sandbox=<env-id>] --dry
```

Read every line of the dry plan: the way in, each input's authority and state (an unreadable
one is `UNAVAILABLE` and the rest carries on), goals, surfaces, planned and skipped controls, which
layers can be witnessed, every BLOCKER. A blocker is a person's to clear — tell them what to
approve (Orbit Control, Autonomous QA); relay `settings set … --human` **only when they tell you to**.

`--sandbox=<env-id>` points the investigation at the sandbox a task owns in this checkout instead of
an approved environment: its origin and source tree come from the runtime, and -- a task's own sandbox
being autonomous -- every mode the engine's gates allow is open there unless a person narrowed the
sandbox policy (`--mode` never widens it): isolated modes still only where isolation is proven, writes
only on the run's own fixture, a destructive control never. Its browser is its own and blank. When the
task has changed code since the sandbox started, every browser action stops with `RUNTIME_STALE`
(BLOCKED, never a finding): restart the sandbox, then verify again.

Drop `--dry` to start. Choose the **smallest** mode that answers the question: `observe` (default,
read-only) · `explore-write` (synthetic `TC-` data) · `security-test` (the tenant matrix) ·
`regression` (accepted cases only). A PBI's own draft plan goes in with:

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/autonomous-qa.mjs draft-plan --investigation=<id> < plan.json   # checked, kept as a DRAFT in the machine store
```

A plan you wrote is a draft: its criteria are your reading of the PBI, never the team's contract,
and promoting it is a person's request (`cli/draft.mjs promote`).

## 2 · The loop: context → decide → step

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/autonomous-qa.mjs context --investigation=<id>          # JSON; writes nothing
echo '<decision>' | node ${CLAUDE_PLUGIN_ROOT}/cli/autonomous-qa.mjs step --investigation=<id>
```

`context` gives the journal's **position**, the **frontier** (what is still owed, first things
first, each with the step kinds that can settle it and a template), the budget, open questions,
and `stop` — a reason the engine would stop now, or null. Each turn:

1. Read `context` (or the last step's `next`). Take the frontier's first item unless the evidence
   gives you a better reason — say it in `reason`. A write's **read-back** comes first for a reason:
   a screen can show a write that never happened.
2. Send ONE decision: `schemaVersion`, a fresh `decisionId`, `expectedRevision` = the position you
   read, `target` = the obligation id, one `action`, the `evidenceRefs` it rests on, a short
   `hypothesis` and `reason`. The action kinds and their fields are in the protocol reference.
3. Read what comes back: `state`, the records it produced (`refs`), the obligations that moved
   (`changed`), the findings, `next`, `stop`. Then the next turn.

Step by kind, in short: `act` goes to, clicks or fills by the map's own selector (a writing control
needs explore-write) · `check-data` reads below the screen — `${TC}` is what the chain typed, and
when it typed two values you name one with `${TC:<screen/via>}`; with no SQL here, `via` a registered
read-only capability · `run-case` runs a plan scenario's case (a draft with `draft: true`; only
synthetic `TC-` params) · `reproduce` replays a finding's chain · `security` runs the tenant matrix ·
`ask` puts ONE requirement question to a person, and what it is about waits for the answer ·
`generate` proposes ONE design for an obligation (`obligation`, `design`: the skeleton's steps with no
`expect`, `js` or window, the assertions as accepted criterion slots — `<criterion>/<expectation>`,
a template, a step — the controls its shape needs, the fixture and observation plan, the trigger
step). The engine compiles every verdict from the accepted criterion, validates the case with the
real grammar, saves it as a DRAFT and freezes its version; a design that does not hold comes back
with its word (`GENERATION_FAILED`, `REQUIRES_REQUIREMENT`, `INVALID_TEST`) and the stage that
stopped it. You never write a predicate, a value or a window, and a repair may change only how a
step is written · `run-version` runs ONE frozen version (`version`: `<case>@<digest16>`) in the task's
isolated sandbox: its writes need fixture-write and run under grants minted for its fixture, its refs
are bound by the engine, and what it came to (`SATISFIED`, `CONTRADICTED`, `INCONCLUSIVE`,
`ENVIRONMENT_BLOCKED`, …) is decided from the host's own check of the worker's envelope — never from
what the worker says. A run that did not settle is read back, never sent again: `reconcile` (below).

A design that drives a PAGE names the screen and who its browser acts as — `page: { endpointRef,
identityRef }`, both aliases — and its steps say WHAT, never how: `until: { selector, attribute?,
equals? }` on a goto, click, fill or press (what holds before the next step), `reads: { selector }`
on a report, and an `api` witness with its `match` and `method`. Only these steps, `call` and `sql`
are proposed; no `as`, `wait`, `assert` or `skip-if`, and a goto opens a path of the bound interface,
never a URL. The engine writes every script the browser runs; the witness rules only on the status its
call answered. Name what a test creates inside the run's own namespace with `${FIXTURE}`. A write the
page makes is covered only by a grant minted for the method and path its witness declares.

After a write settles, and whenever a few steps have moved things, keep what they came to:

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/autonomous-qa.mjs checkpoint --investigation=<id>        # receipts, then memory
node ${CLAUDE_PLUGIN_ROOT}/cli/autonomous-qa.mjs reconcile --investigation=<id>         # a run-version that never settled, read back
```

`reconcile` takes every started version that has no evaluation through ordered rows: still within its
deadline (nothing decided), an envelope left after all (judged now, against the request that was
sent), a worker still running, one that never ran (a new attempt may go), one gone that could not
write, and one gone that could — AMBIGUOUS, kept for a person, never sent again.

## 3 · When a step is refused, or stops

A refusal starts with the rule that refused it — take it at its word:

- `STALE` — the journal moved: read `context` again and decide on what is there now.
- `TARGET` / `ACTION` / `MODE` — the obligation is not pending, or cannot be settled that way here.
- `AMBIGUOUS` / `READ_BACK_FIRST` — a writing step started and never settled: **read back** what it
  did (a data check) and never send it again; only a person releases it (`release … --human`).
- `ID_REUSED` — that decisionId already named another step: send this one under a new id.
- `LIFECYCLE` — paused: resume it (§6), or a person decides.

When `context.stop` or a step's `stop` names a reason — `completed-scope`, `needs-requirement`,
`needs-approval`, `environment-blocked`, `no-eligible-capability`, `budget-exhausted`,
`no-progress`, `ambiguous-side-effect` — finish (§7). `completed-scope` means every obligation has a
disposition. It is never "the product works".

## 4 · Tenant isolation — only on a declared contract

In `security-test` mode the frontier holds one obligation per matrix row; settle them with the
`security` step. The matrix is the person's (`settings tenancy`): identities, their tenants,
SYNTHETIC resources with a marker, and `identity · resource · operation · expect` rows. A denial
counts only where the same channel showed access for an allowed identity. Without that positive
control it is INCONCLUSIVE, because a probe that cannot authenticate looks exactly like a secure
product.

## 5 · A verification nothing here can perform

A layer that is `blocked` for a capability (a queue, a cache, a non-SQL store, an API needing its
own client) is not improvised around. Look for an existing way first: `query.mjs capabilities`,
`intelligence.mjs resolve`, `knowledge.mjs opportunities`. If none exists, hand the ONE agreed
verification to **orbit-qc-builder**, which builds the smallest read-only project-local
capability. It declares `page: false` when it never touches the browser, and a data check can then
read `via` it.

## 6 · Resume

`list` shows each investigation's state. For a `paused` one: `resume --investigation=<id>`, then
`context`. The minutes budget restarts; actions and decisions never do. If a receipt's files have
moved since (the plan, a case, the map), its obligation is owed again and says so.

## 7 · Finish and hand over

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/autonomous-qa.mjs finish --investigation=<id> [--why="…"]   # a checkpoint, the stop, the report
node ${CLAUDE_PLUGIN_ROOT}/cli/autonomous-qa.mjs draft --investigation=<id> --finding=fnd-3   # a regression DRAFT, only on an accepted oracle
```

Tell the person, in this order:
1. The confirmed defects, with evidence ids and the oracle.
2. The suspected ones, and what would settle each.
3. The questions waiting for them.
4. What was blocked and why.
5. **What was not inspected**, and the stop reason.
6. What reached memory: synced, failed or off.

Never say "no bugs"; say what was looked at. A person's answer comes back with
`answer --question=<qst-n> --says="…" --human`, relayed only when they give it.

## Never

- Put a verdict, an outcome, a confidence, an authority or an approval in a decision.
- Resend a writing step that never settled, or release one yourself.
- Touch a destructive control, in any mode, or pass `--force-destructive`.
- Pass `--human` on your own: approving a mode, answering a question, releasing a step,
  accepting a requirement.
- Read, copy or replay a credential, a cookie or a token; use another tenant's real data; test an
  account, tenant or system the contract does not name.
- Write outside the machine store, promote a draft, or edit a case, a map record or product code.
- Report a finding the journal does not hold, or a cause nothing demonstrated.
