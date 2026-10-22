---
name: orbit-test-plan
description: >
  Decide WHAT to test before any test is written. Read the requirement and everything the
  project already knows, separate what is known from what is assumed, ask only the questions
  that change the design, then derive risk-ranked scenarios with acceptance criteria that carry
  stable ids. The deliverable is one checkable plan per feature in its screen's folder that
  plan-check holds to its own claims and that the case writer turns into JSON. Use when asked to
  plan or design tests for a feature, screen, ticket or release, to review whether a suite is
  complete, or when someone says "write tests for X" before any scenario has been agreed.
argument-hint: <feature, screen or ticket to design tests for | "is our suite complete?">
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - AskUserQuestion
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/*)
user-invocable: true
---

**Host binding:** On protocol v2, resolve the plugin root from this SKILL.md’s actual location and bind the host/protocol/hashed session supplied at startup on every Orbit shell invocation. Resolve command examples against that root; do not assume hook exports persist. Follow [the shared host contract](../../docs/hosts.md) for task stdin, runtime isolation and unavailable native capabilities. Use the supported native protocol for the selected host.

# Design the tests before writing them

Two jobs, kept apart on purpose:

| | who | where | output |
|---|---|---|---|
| **what to test** | this skill, **in conversation** with a human | the main session | `$DATA/screens/<screen>/<id>.plan.json` (+ the rendered `.md`) |
| **how to drive it** | the `orbit-qa-case-writer` subagent, no conversation | one agent per scenario | machine-store case drafts |

A subagent cannot ask anybody anything, and only a person knows the acceptance criteria and the
business risk. So the reading and the questions happen here; drafting is delegated after the plan
is agreed.

**Two shared references, the same for every `orbit-*` playbook.** Read the one you need; do not
re-derive what is in them:

- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/tools.md` — which Claude Code tool does
  which QA job, what to do when an optional one (LSP, ToolSearch, a subagent, an MCP server) is not
  in this session, and the lines that do not move.
- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/dsl.md` — how to read the JSON DSL off the
  tables that define it (`query.mjs dsl`) instead of from memory.

**The plan is data.** `$DATA/screens/<screen>/<id>.plan.json` is the source; the `.md` beside it is
RENDERED from it (`qa-plan render <id> --write`) and is what people read in a pull request. Never
edit the Markdown — it is generated, and it says so on its first line.

**One folder per screen.** A plan lives in the folder of the screen it is about, beside that
screen's cases, and names it: `"screen": "<id in graph/screens.json>"`. Start one with
`node <engine>/cli/qa-plan.mjs new <id> --screen=<screen> "Title"`. A feature that spans several
screens goes in the folder of the screen a person would open first; its cases still sit under
their own start screens. `plan-check` refuses a plan in another screen's folder.

**A plan about no screen.** A requirement that lives behind an API, or a PBI whose UI does not exist
yet, is NOT given a screen it is not about. It names its `feature` and sits in the reserved
`screens/_no-screen/` folder, beside the cases that start on no screen:
`node <engine>/cli/qa-plan.mjs new <id> --no-screen --feature=<feature> "Title"`. Its scenarios rule
on `api` and `sql` (a `call` to a registered capability, a `sql` step), and its permission scenarios
owe the SERVER's refusal (`denial.backend`) — a screen's side is owed only where there is a screen.

**Whose word each source is.** A source says `authority: accepted` when the team accepted it, and
`draft` when it is still a proposal. In a committed plan an absent value reads accepted, because a
person committed it. A criterion from a draft source prepares tests and never confirms a finding.
Record each PBI as a source with its `ref` and `revision`: that is what makes a revised PBI visible
(`qa-plan impact <id> --now=PBI1=<new revision>`).

**When a requirement snapshot exists** (`requirements.mjs show rs-…`, made by `orbit-requirements`),
it is the requirement: the criteria are its facts that say something, quoted, never re-derived
from the item or from what the application does today. Record it as ONE source —
`{"kind":"requirement","ref":"rs-…","revision":"<the first 16 characters of its digest>","authority":"<the snapshot's own>"}`
— and a criterion the snapshot does not give you is a **question** for `requirements.mjs ask`, not a
guess in the plan. A draft snapshot prepares scenarios and never confirms a finding, as any draft
source does.

**What is known, assumed, contradictory or missing** goes where the vocabulary already has a place.
Never put it in prose:

| it is | it goes in |
|---|---|
| known | `sources`, `criteria` |
| assumed | `assumptions` |
| contradictory | a `question` naming both sources |
| missing | a `question` with what it `blocks` |
| out of scope | `exclusions`, with the reason |

An autonomous investigation that drafts a plan from a PBI keeps it in the machine store as a DRAFT
(`autonomous-qa draft-plan`). Promoting it into the checkout is a person's request
(`cli/draft.mjs promote`), and it arrives with every source it did not qualify marked
`authority: draft`.

## 1. Read before you ask

```bash
node <engine>/cli/query.mjs find <feature>         # which screens and controls exist
node <engine>/cli/query.mjs screen <id>            # controls, and where each leads
node <engine>/cli/query.mjs layers <id>            # what this screen touches below the UI
node <engine>/cli/query.mjs effect "<screen>/<via>" # the call a control makes, the table it writes
node <engine>/cli/query.mjs cases                  # what is already covered
node <engine>/cli/query.mjs check                  # findings first — a broken map plans nothing
node <engine>/cli/query.mjs notes <feature|screen> # traps and decisions already concluded here
node <engine>/cli/query.mjs history <case>         # what actually happened the last times it ran
node <engine>/cli/query.mjs flaky                  # a case that keeps flipping is a planning fact
node <engine>/cli/learn.mjs recall <case|screen>   # what several sessions worked out
node <engine>/cli/architecture.mjs ensure --for="<what this feature needs verified>"
node <engine>/cli/plan-check.mjs                   # the plans that already exist, and their state
node <engine>/cli/qa-plan.mjs expects <contract.json> [--operation=<id> --status=<n> | --channel=<id> --within=<s> | --at=<ISO>]
```

When the feature has an ACCEPTED contract -- an OpenAPI 3.x, an AsyncAPI 2/3 or a schedule policy --
`qa-plan expects` reads it into candidate structured expectations for a criterion, each with where it
came from, and the source pinned by its revision and digest. It states only what the document
states: a window comes from the criterion (`--within`), an occurrence only at an instant you name
(`--at`), and a document it does not read is said, never half-read. Put what you keep into the
criterion's `expects` yourself; the plan's authority is still the plan's.

`architecture ensure` is what tells you, before you design a single check, whether this project
can actually verify what the feature needs. It answers from a snapshot and usually reads nothing.
Run it with the feature's own words: a capability it has never been asked about — an integration
named in the requirement, a store nothing here talks to — comes back **missing**, with the list of
places it looked.

**A missing capability is a blocker, never a deleted check.** Record it as a `blockers` entry of
kind `capability` and mark the layer `unverifiable` with the reason the engine printed, quoting
where it looked. `plan-check` holds you to both halves: a capability blocker with an empty `says`
is an error, and one sitting beside layers that all still claim `required` is an advisory saying
the two disagree. What you must not do is quietly drop the layer — the plan then reads as if the
feature were fully covered.

**Then ask project knowledge what the feature would have to prove, and who can prove it:**

```bash
node <engine>/cli/knowledge.mjs claims --for="<the feature>" [--context=<dimension>=<value>]
node <engine>/cli/knowledge.mjs verify --for="<the feature>" --purpose=verification --workflow=orbit-test-plan
```

`claims` says what the feature's concepts lead to here, how each is implemented and how it can be
observed — per context, so an answer that depends on a context you did not name comes back
UNKNOWN with the dimension that would settle it: that dimension is a question for step 2, not a
guess. `verify` walks the same chain and asks the resolver who can prove each consequence. A
`provided` one names the capability a case can `call`. A GAP exits 0 — it is a capability
opportunity, remembered — and with `--purpose=verification` a deferred one comes back DEMANDED,
because this plan has to prove it. In the plan it is still a `capability` blocker with its layer
`unverifiable`, quoting what `verify` printed. When `verify` prints a question, put it to the
person; never run `knowledge decide` yourself — only their own word becomes
`decide <id> accept|defer|ignore --human`.

Read the requirement, the ticket and whatever else was handed over. Then sort what you have into
four piles, because they are treated differently for the rest of the job:

| pile | where it goes | rule |
|---|---|---|
| **known** | `criteria`, with the `sources` id it came from | quote them, do not paraphrase into your own words |
| **assumed** | `assumptions` | each one is a thing that can turn out wrong; say why it was reasonable |
| **contradictory** | `questions`, naming both sources | two sources disagreeing is a finding, not a tie to break |
| **missing** | `questions`, with `blocks` | never filled in by guessing |

**A source that describes the IMPLEMENTATION is not an acceptance criterion.** Code, a commit and
a trace say what the product does; a criterion says what it must do. Record the first as
`kind: "code"` or `"commit"` — it can confirm a criterion and never be one. When the two
disagree, that is a `question`, and the answer decides whether you have found a bug or a
misunderstanding.

## 2. Ask only what changes the design

There is no fixed list of questions to fire at somebody. Ask a question when the answer would
change what you design or whether a scenario can be verified at all — otherwise read, or write it
down as an assumption and move on. Put them in **one** message (`AskUserQuestion` where the
options are knowable), then stop asking and start deriving.

These six topics are a **checklist for yourself**, to notice what you have not got. They are not
a script:

1. what must work — their acceptance criteria, in their words
2. who does it, and who must be **refused**
3. what it changes in real data — created, updated, deleted rows
4. what must **not** happen — the bug you would be embarrassed to ship
5. which states it passes through — draft to published, empty to full, first to repeat
6. how you would know it worked **without looking at the screen**

**Never invent an acceptance criterion.** If nobody knows the expected behaviour:

- write a `question`, with `blocks` naming the criteria and scenarios it holds up
- do **not** derive the criterion from what the application currently does — that produces a test
  which certifies the behaviour, bug and all
- carry on with everything the question does not block. A plan is allowed to be partly open;
  it is not allowed to be quietly guessed

## 3. Design scenarios with a technique

An incomplete map is **not** a reason to drop a scenario. A control nobody has recorded blocks
AUTOMATION, so it goes in `blockers` with `kind: "map"` and the scenario stays in the plan with
`readiness: "blocked"`. Coverage counts it as work still owed.

| technique | use it when | it yields |
|---|---|---|
| `crud` | anything that stores something | create · read back after a reload · edit · delete · re-create with the same name |
| `boundary` | any field with a rule | one valid, one invalid per rule, and the edges: empty, max, 0, 1, duplicate |
| `decision-table` | permissions, flags, states | one row per combination that behaves differently — where scoping bugs live |
| `state-transition` | wizards, status fields, approvals | the legal moves, and one illegal move that must be refused |
| `negative` | every commit action | wrong role, missing required field, duplicate, stale data |
| `permission` | a right somebody does not have | see §4 — it owes a `denial` |
| `scoping` | multi-user, multi-tenant data | another owner's record must not be readable or writable |
| `idempotency` | a submit that can happen twice | see §5 — it owes a `repeat` |
| `concurrency` | two people, one record | two attempts at the SAME MOMENT, never a sequence |

Every scenario states its expected result **per layer**, and every layer gets one of three
answers — silence is not one of them:

```json
"expect": {
  "ui":  { "need": "required", "says": "the list contains ${NAME}" },
  "api": { "need": "required", "says": "POST api/things answers 201" },
  "sql": { "need": "unverifiable", "because": "the map records no effect for detail/Archive, so no table is known" }
}
```

`required` · `n-a` (it does not apply, and why) · `unverifiable` (it applies, nothing here can
check it, and why). The third is a **capability gap**: it is reported in coverage and it never
counts as verified. It is not a lowered bar, and the answer to "we cannot check it" is never to
delete the requirement.

## 4. Permission scenarios say what the PRODUCT refuses

`identity.roles` and `identity.notRoles` verify the account the test runs as. They are a
precondition. They do not prove the application refuses anything, and a run that stops because
the identity is wrong is **REFUSED** — a statement about the setup. **REFUSED is never a passing
permission test.**

A permission or scoping scenario carries a `denial` saying:

- **who** attempts it and which right they do not hold (`actor`, `denial.lacks`)
- **whose** record it is — owner, tenant (`actor.owner`, `actor.tenant`)
- **what** they attempt (`denial.action`)
- **the screen**: hidden, disabled, or an error on the attempt (`denial.ui`) — required
- **the server**: what it must answer, or `unverifiable` with the reason (`denial.backend`)
- **the data**: what must be unchanged (`denial.unchanged`)

Keep these five apart, because they are five different products:

1. the UI hides or disables the control
2. the server rejects the request
3. another user's or tenant's record is neither read nor written
4. the RUNNER refuses because the identity is wrong — a setup result
5. the PRODUCT refuses, correctly — the only one that is a pass

A hidden button is **not** required to produce a 403: if there is no way to attempt the call from
here, say `unverifiable` and let it be a capability gap or a manual check. Build the matrix of
role × owner/tenant × state, keep the combinations that behave differently, and write down which
ones you cut and why.

## 5. Idempotency means the action happens twice

Three different things people call the same word:

| | what it is | what proves it |
|---|---|---|
| the test can be re-run | `skip-if` | nothing — a SKIP is the absence of a test, correctly reported |
| the product handles a repeat | an `idempotency` scenario | doing it AGAIN and checking the contract |
| the product handles two at once | a `concurrency` scenario | two sessions racing, never a sequence |

So an idempotency scenario declares `repeat` with the shape (`resubmit`, `retry`,
`double-click`, `concurrent`) and what the contract requires of the second attempt. Do not assume
it: a second create is not automatically a duplicate, and a second call is not automatically the
same status. `repeat.extra` is what must NOT appear — the second row, the second message.

`repeat.guarded: true` records that the case's `skip-if` protects the RE-RUN. It is documentation
about the test, never evidence about the product.

Data lifecycle, on anything that changes data:

- `data`: `per-run` (fresh and identifiable), `fixture` (deliberately seeded), `existing` (which
  is how order-dependence starts)
- `key` / `record`: the business key or id that identifies this scenario's own rows
- `scope`: which owner or tenant it belongs to
- `cleanup` and `onFailure`: how it is put back, and what is left when it stops half way
- `isolation`: how it avoids depending on the order things run in

**SQL verification is read-only.** Seeding and cleaning up are a UI action, a fixture reset or a
person — never a written statement smuggled past the read-only rule.

## 6. Every change, not only `creates`

`mutation.kind` is `create`, `update`, `delete`, `transition` or `side-effect`, and each one owes
the same five sentences: `before`, `action`, `after`, `unchanged`, `onRefusal`. Cite the map with
`mutation.effect: "<screen>/<via>"` rather than re-typing what `query effect` already knows — the
map says which table, the scenario says which row.

At least one layer BELOW the screen has to answer, or the scenario has to say, layer by layer,
why none can. For anything that finishes after the response, fill `async`: what is `accepted`
immediately, what `complete` means in business terms, the `deadline` **with its source**, and
`observe` — the layers actually watched. A reload shows what the screen was served; it does not
show that anything committed.

The engine polls a page. It does **not** poll a queue, a mailbox, a database or a job. Anything
that needs one is a manual check or a capability gap, said out loud.

## 7. Rank by risk, then choose within the budget

Score only the factors you have evidence for — `impact`, `likelihood`, `usage`, `blast`,
`history`, each 1-5 — and say why in `risk.because`. The score reports what it was NOT told;
never fill a factor in to make the number look complete.

`priority` is yours to set. When it disagrees with the score, say why in `because`. Mark
`must: true` only for what runs in every profile, and explain it.

```bash
node <engine>/cli/qa-plan.mjs select <id> --profile=smoke --budget=90
```

It prints what it picked, in a stated order, and — the half that matters — what that leaves
unproven, including what the profile excluded. When the musts do not fit, it says SHORTFALL and
changes nothing: whether a must stops being one is a person's decision, never a quiet demotion.

## 8. Check the plan before handing it over

```bash
node <engine>/cli/plan-check.mjs <id>          # exit 0 clean · 1 errors · 2 no such plan
node <engine>/cli/plan-check.mjs --json        # the same, for a machine
```

It separates what it can demonstrate from what it suspects:

- **ERROR** — a dangling id, a duplicate id, a dependency cycle, a criterion with no coverage and
  no disposition, a scenario with no expected result, a permission scenario with no denial, an
  idempotency scenario that offers the skip guard as evidence, a change with no data lifecycle or
  no witness, a case link that does not exist, a case that cannot execute the verdict its
  scenario committed to, a manual check with no owner or no expected result
- **advice** — a heuristic, or something a person has to look at. It never changes the exit code
- **unknown** — a reference it cannot date. Reported as unknown, counted as neither

Then render the Markdown and show it:

```bash
node <engine>/cli/qa-plan.mjs render <id> --write   # the .md beside the plan, for people to read
node <engine>/cli/qa-plan.mjs coverage <id>         # criterion -> scenario -> case -> run -> evidence
```

## 9. Hand off

Get an explicit **yes** on the scenario list. Then, for each scenario that is `ready`, spawn the
`orbit-qa-case-writer` subagent — one per scenario, run together, **one case file each**. Give it
the plan id and the scenario id; it reads the rest itself.

When they come back, YOU merge: set each `cases[].state`, add the ids, re-run `plan-check`. A
subagent must not edit the plan — two of them writing the same file is how a scenario loses its
links. Never read a plan mid-flight to decide anything.

A scenario that is `blocked` or `draft` is not handed over. Record the blocker
(`record-edge.mjs` for a missing control) or answer the question first.

## 10. Keep it current

```bash
node <engine>/cli/qa-plan.mjs impact <id> --now=REQ1=4 --changed=home/Add
node <engine>/cli/qa-plan.mjs suggest <id>
```

`impact` says what moved and how sure it is: **certain** when a recorded revision no longer
matches, **possible** when the frontend commit advanced (a commit moving is not evidence that a
scenario is wrong), **unknown** when there is nothing to compare. `suggest` turns lessons into
proposals — a regression scenario for a repeated failure, a look at the setup behind a flaky
case, a revised estimate — each with its lesson id, its confidence and the sessions behind it.

A lesson never rewrites an acceptance criterion, never changes an expected result to make a test
pass, and never removes a failing scenario. It is evidence about the product as built; a
criterion is what somebody decided it should do.

When the interview settles something durable that is not a scenario:
`node <engine>/cli/note.mjs "project" "<title>" "<body>" --type=decision`. Lessons live outside
every repo and stay there — a plan carries a reference, never a copy.

## Done means all of these

- [ ] `plan-check <id>` exits 0, and every advisory has been read
- [ ] every criterion is covered by a scenario or a manual check, or carries a disposition
- [ ] nothing was answered by guessing: what is unknown is a `question` with `blocks`
- [ ] every scenario states an expected result per layer — required, n-a or unverifiable, with a reason
- [ ] every capability the scenarios depend on was checked with `architecture ensure`, and anything missing is a `capability` blocker plus an `unverifiable` layer — never a layer that was quietly removed
- [ ] every permission scenario says what the refusal looks like, not just who was signed in
- [ ] every idempotency scenario performs the action twice and states the contract
- [ ] every change states before, action, after, unchanged, onRefusal, and its data lifecycle
- [ ] what no browser can see is a manual check with an owner, steps and an expected result
- [ ] priorities are explained where they disagree with the risk score; cuts are written down
- [ ] the Markdown has been re-rendered, and the human has said yes to the scenario list

Case storage and promotion follow `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/storage.md`.
Do not link a draft as a registered case or count its run toward plan coverage before explicit promotion.
