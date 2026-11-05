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
- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-qa/references/designs.md` — one worked design per
  obligation shape, each one the engine made a draft of. Read the one for your obligation's
  shape before your first `generate`, and write yours the same way, with your own aliases and slots.

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
and `stop` — a reason the engine would stop now, or null. The budget is the investigation's actions,
decisions and minutes, and what one obligation may spend on designs that hold and on repairs of one that
failed (`perObligation`) and one frozen version on attempts (`perVersion`) -- with what each obligation that
has a design has spent (`obligations`: `used` of each, and the one `spent`, after which `generate` is refused
for it). Each turn:

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
step). Start from the worked design for the obligation's shape (`references/designs.md`: one per shape,
each a draft the engine made). Read what a design may hold before you write one: `protocol`'s `design` gives each part's fields
(their enums -- `effectScope`, a trigger's `kind`, a control's `role` -- what is required and what only the
engine stamps), the template each criterion op compiles to (`eq` is `value-eq`) and the rules over a design's
controls that their fields do not show (`rules`); the obligation's own `template` names the controls its shape needs,
the templates its slots take and the rules over those controls (`rules`). Its own `expected` slots are what rule it
(`slots`): assert each on the step whose answer carries it. A slot of another criterion you assert is held too, and a
run stops at the first assertion that fails -- one that fails on a step before the obligation's own ends the test
there, its contradiction is the obligation's, and its own slots are never read. A shape that says more says it in the
template (`says`; `protocol`'s `design.shapes` lists them): what comes again of work already done is not a second
effect -- the delivery that comes back after an effect committed (crash-after-effect-before-ack), a second delivery or
publication under the same business key (effect-once-per-key), the same job received by a second worker
(competing-workers) -- so how it settles is the system's own word and never a second success to wait for: observe it by
its attempt or by the message (or the job) alone, and rule the obligation on its own slot, the effect count.
The tests of one investigation run one after another in ONE sandbox and share its state (`sandbox`, in every test
obligation's template and in `protocol`'s `design`): an effect, a key or a scheduled occurrence an earlier test used is
still there for the next. Give each test business keys, message ids and occurrences no earlier test of the
investigation used, none an accepted criterion states for another test (a value an expectation states `for` another
shape is that shape's test's), and none its schedule will produce on its own once the clock reaches them -- a period
any test's clock advance passes is the schedule's -- unless that is what the test observes. A `generate` whose design
names one that an earlier frozen version of the investigation named too says so beside its answer (`result.shared`:
that version, its obligation and shape, each value and the word it was named under -- `businessKey`,
`correlationId`, `messageId` or `occurrenceId`): it is advice, it changes nothing, and it comes before you run --
choose another key unless what the earlier test left is what this one observes. A design that names a value an
accepted criterion states `for` another shape is told so at the FIRST design that names it, before that other test
has any version (`result.shared` then names the `criterion` and the shape it is stated for): that value is the other
test's to observe.
The engine compiles every verdict from the accepted criterion, validates the case with the real grammar, saves it as
a DRAFT and freezes its version; a design that does not hold comes back
with its word (`GENERATION_FAILED`, `REQUIRES_REQUIREMENT`, `INVALID_TEST`) and the stage that
stopped it. You never write a predicate, a value or a window, and a repair may change only how a
step is written · `run-version` runs ONE frozen version (`version`: `<case>@<digest16>`, the id the generate
step's `frozen` names and `context` lists under `versions` with its obligation) in the task's
isolated sandbox: its writes need fixture-write and run under grants minted for its fixture, its refs
are bound by the engine, and what it came to (`SATISFIED`, `CONTRADICTED`, `INCONCLUSIVE`,
`ENVIRONMENT_BLOCKED`, …) is decided from the host's own check of the worker's envelope — never from
what the worker says. A worker stopped before its run finished (its deadline, its supervisor) ruled on nothing:
`INTERRUPTED` when the version could write nothing -- run it again, and if its own deadline stopped it, wait
less -- and `AMBIGUOUS` when it had grants to write, which is never sent again (`result.stopped` says why it
stopped). A run that did not settle is read back, never sent again: `reconcile` (below).
Every step's answer carries `result`: what its action came to in its owner's word (`DRAFT_CREATED`,
`GENERATION_FAILED`, `ENVIRONMENT_BLOCKED`, `SATISFIED` …), the stage or rule behind it and why -- read it
before the next decision: a blocked run names the binding or grant it lacked, a failed design the finding
that stopped it. A version refused or blocked at a step says where in `result.stopped` -- the step, its verb
and capability, `refused` or `blocked`, and what that step's own stop said (`says`: `request.key … or
request.match`, `request.action is one of …`, `answered 400 unknown-point`), scrubbed; a version that FAILED
names the step it failed at (`failed`) and says nothing, since what it read is the product's. When that step's
observation matched what it observes AND how it went (`match: { messageId, outcome }`), what it read of that very
thing and its match left out is said beside it (`stopped.excluded`: the list, how many, the match's fields that left
them out, the newest three by the fields the adapter declares, and a sentence) -- read it before you call the failure a
defect: an answer of none, complete, is not "it never happened" when the thing was there and settled another way. A
match on the message alone hides nothing. A refusal is the test's mistake, not the product's: repair the design to
what `says` asks for and generate again -- never
guess a request's shape, and never resend one it refused. An adapter that declares what its request carries holds
your design to it before a draft exists: a field it does not read -- `request.businessKey` on a state read that takes
`key`, a `match` on a field its hooks never answer by -- is `INVALID_TEST` at `validate`, naming the fields it does
read. A fault control's `point` is one its workload
declares: `context` lists a workload's declared points beside its alias under `bindings` (`points`), and a
design that names another is refused before a draft exists (`DECLARED_POINT`, naming them) -- take the point
from there, never from an obligation's name. A workload that lists none declares none here: a point its hooks
do not know then refuses the run (`stopped` says `unknown-point`). A fault stops the workload it is armed in,
and nothing says that workload comes back by itself: bring it back with a step of the design's own
(`orbit.workload.control` on it, `request.action` `start` or `restart`) after the fault's witness, before
any later step asks that workload for more (what it did after the fault included), and before the test ends --
the next test in the sandbox finds it as this one left it. What the fault left below it, a state read, may be
read first, while it is still down. A design that does not bring it back is refused before a draft exists
(`RESTORED_AFTER_FAULT`, naming the step to add and where). A fault nobody saw proves nothing about surviving it: a run whose observations never
carried the point's terminal reason (`fault:<point>`) is `INCONCLUSIVE` whether what followed held or failed
(`FAULT_NOT_SEEN`) -- so observe the faulted workload's attempts in a step whose answer carries it, and name that step
as the fault control's witness (`step`), whose verdict the engine compiles. A design or a version you cite as
evidence is cited by its record id (`dsg-…`, `ver-…`).
Every ref a design names (`endpointRef`, `channelRef`, `stateRef`, `scheduleRef`, `workloadRef`, `identityRef`,
`clockRef`) takes one of the aliases `context` lists under `bindings`, by kind, exactly as this sandbox binds them --
read them there, never guess one from a key, a dotted name or a statement: an alias nothing lists is a binding
gap, and a design that names one is blocked before it runs. A state is listed with the `address` its node
declares (its table and key column, say): a read of it names that key's value, never a guessed column.

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
