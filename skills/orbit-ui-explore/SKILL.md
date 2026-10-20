---
name: orbit-ui-explore
description: >
  Explore a live screen with playwright-cli when the map is thin and nobody is available to
  interview: drive its whole surface, watch every layer a verb can prove, and leave behind
  candidate map records, JSON cases that have each survived a real run, and one HTML session
  sheet. Use when asked to test a screen nobody has written cases for, to find out what a screen
  actually does, to go looking for problems in a feature before any scenario has been agreed, or
  when orbit-test-plan has nothing to read because the map is empty. It observes and proposes; a run
  is still the only thing that may decide PASS.
argument-hint: <screen id or url to explore | "what does this screen do" | add --write to let it submit>
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/*)
user-invocable: true
---

**Host binding:** On protocol v2, resolve the plugin root from this SKILL.md’s actual location and bind the host/protocol/hashed session supplied at startup on every Orbit shell invocation. Resolve command examples against that root; do not assume hook exports persist. Follow [the shared host contract](../../docs/hosts.md) for task stdin, runtime isolation and unavailable native capabilities. Use the supported native protocol for the selected host.

# Explore a live surface, then leave something that runs

**Two shared references, the same for every `orbit-*` playbook.** Read the one you need; do not
re-derive what is in them:

- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/tools.md` — which Claude Code tool does
  which QA job, what to do when an optional one (LSP, ToolSearch, a subagent, an MCP server) is not
  in this session, and the lines that do not move.
- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/dsl.md` — how to read the JSON DSL off the
  tables that define it (`query.mjs dsl`) instead of from memory.

| | who | reads | output |
|---|---|---|---|
| **what is there** | this skill, in a live browser | the product | map records · machine-store drafts · one session sheet |
| **what should be true** | `orbit-test-plan`, in conversation | a human | `$DATA/screens/<screen>/<id>.plan.json` |
| **how to drive it** | `orbit-qa-case-writer`, no conversation | the map | machine-store drafts |
| **is it still true** | `orbit-test-suite` | the agreed set | verdicts · one review |

Every other playbook here says *look it up, do not explore*. `orbit-ui-map` may look at one screen
in order to record it. This is the one allowed to look at a whole surface **and to act on it** —
so everything it writes carries what it saw, and nothing it writes is a verdict.

**A case derived from behaviour freezes that behaviour, bug and all.** That is the standing cost
of this skill, and it is paid down in one place only: every case it writes is run before it is
kept, every expectation says in `why` what was observed, and the case's `note` says a machine
derived it. Never quietly promote one of these to "the spec".

## 0. Recall first — the map and the ledger already know things

```bash
node <engine>/cli/query.mjs doctor              # is playwright-cli usable here at all
node <engine>/cli/query.mjs screens             # what has been recorded, and how stale
node <engine>/cli/query.mjs screen <id>         # the controls this screen already has
node <engine>/cli/query.mjs effect <id>         # which call and which table each one touches
node <engine>/cli/query.mjs notes <id>          # the traps somebody already paid for
node <engine>/cli/query.mjs check               # do not start on a map that is already dirty
node <engine>/cli/learn.mjs recall <id>         # what several sessions worked out about this surface
```

Recall only. An exploration is not a run and earns no verdict, so it must never be fed to the
ledger-based families — what it leaves behind are map records, cases and notes, and the next
`learn analyse` reads those.

**Never explore what the map already answers.** A control with a record and an effect needs no
session; go and write the case. Exploring is what you do where the map is silent.

## 1. One charter, one surface, one time-box

A charter is one screen and one sentence saying what you set out to learn. Write it down before
you open anything — it is the first record of the session and the page refuses to render without
it.

Scope is exactly the **surface**: that route plus every dialog, wizard tab and row menu it opens,
stopping at anything with its own `url`. Not the app. A screen you wandered into is a line in the
report, not a record — and not a second charter.

## 2. Know what you are allowed to do before you touch anything

| | without `--write` | with `--write` |
|---|---|---|
| goto, navigating clicks, `snapshot`, reading `requests` | yes | yes |
| typing into a field | no | yes — `TC-` prefixed values only |
| clicking a control that commits (Save, Create, Submit…) | no | yes |
| clicking an edge the map marks `destructive` | **never** | **never** |
| `run-case --force-destructive` | **never** | **never** |

This is a rule you keep, not a gate that keeps you: you drive the browser yourself, so nothing
can refuse the click for you. Without `--write` the session sees GET traffic and nothing else,
which means it witnesses the screen and **neither the call that changes anything nor the row
underneath** — say so rather than letting the sheet read as coverage.

Ask before the first commit on anything you did not launch yourself, and never explore an
environment somebody else is using.

## 3. Open the session the way a run does

The project's launcher, `ORBIT_RUN_DIR` at the run directory it printed — the same path
`orbit-ui-map` and `run-case` take. Check the session settled before you read anything into it:
`NONE` means run the launcher, `SIGNIN` means finish signing in there. **Neither is a defect**,
and neither goes on the sheet as a finding.

Stay in this session. Do not fan out: there is one browser, and clicking a real control touches
real data — something a person must be able to watch, not a job to hand to five agents at once.
The source half already has its own subagent (`orbit-map-recorder`); use that for reading code.

## 4. Read the surface before you touch it

```bash
playwright-cli snapshot                 # the accessibility tree: role + accessible name
playwright-cli find "<text>"            # the same tree, searched
playwright-cli --raw eval "<expr>"      # only when the tree cannot answer it
```

The role is `kind`, the accessible name is `via` **and** the name in the locator. Write one
`control` record per node you can address. A node you cannot address is an open question, never
a guessed selector.

## 5. Every action is watched on every layer

Take the watermark **before** the action and ask what happened after it — the same thing
`run-case` does with `requests: "mark"` and `requests: "since"`, run by hand:

```bash
playwright-cli requests | tail -1       # the watermark
playwright-cli click '<selector>'
playwright-cli requests                 # what the UI asked for since
```

- **ui** — what changed: the `innerText` delta, a dialog that appeared, `location.pathname`.
- **api** — the calls that appeared after the watermark, each as method, url and status.
- **sql** — **not observable from a browser.** Read `graph/effects.json`: where the record names
  the table and `sql.command` is wired, one read-only `SELECT` confirms the row. Where the map
  does not name a table, that is an open question. **A predicate is never guessed.**

Record one `action` per control touched, with what each layer said — and write down a layer you
did **not** watch by leaving it out, never by claiming nothing happened there. An empty `api` list
is a real observation ("I watched, and it called nothing"); omitting the key is "I did not look".

**Mark `commits: true` on any control you clicked in order to commit something.** You clicked it,
so you know; nothing downstream has to read the word in its label and guess. The session file is
one JSON object per line, in `<store>/drafts/explore-<charter>.jsonl`:
Resolve `<store>` with `node <engine>/cli/learn.mjs where --root`; create the drafts directory there if needed.

```jsonl
{"kind":"charter","at":"…","screen":"home","say":"what this session set out to learn","fe_commit":"abc1234","write":true}
{"kind":"control","at":"…","on":"home/Add","role":"button","selector":"getByRole('button',{name:'Add'})","opens":"dialog","to":"dlg-thing"}
{"kind":"action","at":"…","on":"dlg-thing/Save","commits":true,"saw":{"ui":"the list shows TC-1","api":[{"method":"POST","url":"api/things","status":201}],"sql":"Things has one row named TC-1"}}
{"kind":"finding","at":"…","on":"home/Star","why":"the star filled in but POST api/things/1/star returned 500","evidence":"step-04.png"}
{"kind":"question","at":"…","about":"home/Export","ask":"which table does Export read? effects.json has no record"}
{"kind":"case","at":"…","id":"create-thing","status":"PASS","proved":{"ui":1,"api":1,"sql":1}}
```

## 6. A finding is a contradiction, not an opinion

Only these are yours to conclude, because none of them needs to know what the product is for:

- the screen showed success and a call came back outside 2xx;
- a control you marked `commits` **made no call at all** — an optimistic render looks exactly
  like a saved record until somebody reloads, and a dead button looks like a working one;
- the console carried an error or an unhandled rejection through the action;
- the map says a control is there and the surface does not have it (that is drift — `query verify`).

Everything else is a `question`. "This looks wrong to me" is a question. "The wizard should
validate the email" is a question. Only a person can say what this screen owes anybody.

## 7. Write the map first

Candidates go to `<store>/drafts/<screen>.jsonl`, then through the tool that judges them:

```bash
node <engine>/cli/record-edge.mjs <store>/drafts/<screen>.jsonl --dry   # judge, write nothing
node <engine>/cli/record-edge.mjs <store>/drafts/<screen>.jsonl         # append, re-check, roll back on any finding
```

You watched these render, so they are `seen: "live"` — and a `live` record is refused without
`fe_commit`, so stamp HEAD of the declared checkout **in the same turn you observed**. Screens and
effects have no append tool: propose them as hand edits, exactly as `orbit-ui-map` §5 does, and let
`query check` be the gate.

## 8. Save a draft, then verify it

The map first, because the case points into it. Then one case per thing worth re-checking:

- `params` carrying `TC-` prefixed data, unique per run; `skip-if` in front of the first step
  that changes anything; `wait` after every `click`.
- `api` with the method, pattern and status **you observed** — with `why` saying so.
- `sql` with the table `graph/effects.json` names, and the row the case itself creates.
- `report` + `expect` to close it: a case that rules on nothing is INCONCLUSIVE, not a pass.
- `note` at the root saying a machine derived this from an observed session, and that every
  expectation is what the product did rather than what it should do.

**No effect record naming a table means no `creates` case.** `check` refuses a case that declares
`creates` and rules only on the screen, and it is right to: a screen can show a write that never
happened. Write the navigation case instead, and leave the question.

Follow `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/storage.md`.
Save the JSON on stdin through `draft.mjs write`, with `seen: "src"`, then prove it:

```bash
node <engine>/cli/query.mjs check                        # must print no findings, and exit 0
node <engine>/cli/run-case.mjs <id> --draft NAME=TC-1 --dry      # read it before it drives anything
node <engine>/cli/run-case.mjs <id> --draft NAME=TC-1 --report  # record what it proves
```

PASS → stamp the draft `seen: "live"` with `fe_commit` in the same turn.
All outcomes stay in drafts; the sheet says which cases passed and which did not.
Only an explicit request to add a case to shared regression authorizes promotion.

## 9. Write the sheet, then close the loop

```bash
node <engine>/cli/explore.mjs <store>/drafts/explore-<charter>.jsonl
node <engine>/cli/note.mjs <screen>/<via> "<what bit you>" "<what to do instead>" --type=trap
```

The sheet is the deliverable, not the cases: its last section is what a person still has to
answer, and a session that found only questions is a successful session. Hand the open questions
to `orbit-test-plan` — they are the interview, already half done.

Notes stay in machine memory and may be shared or projected; nothing secret goes in one.

## Done means all of these

- [ ] the charter was written before the browser opened, and the sheet renders from it
- [ ] scope stayed on one surface; anything else is a line in the report, not a record
- [ ] no `destructive` control was clicked, and nothing was submitted without `--write`
- [ ] every action records what each layer said, and an unwatched layer was left out, not claimed
- [ ] every control clicked to commit carries `commits: true` — the page never guesses that
- [ ] every new control went in through `record-edge`, `live` with `fe_commit` from this turn
- [ ] no table was guessed — an untraced write is an open question
- [ ] every new case stays in drafts, has a report for its run, and identifies machine-derived expectations
- [ ] `query check` prints no findings and exits 0
- [ ] the sheet is written, and the open questions are handed on rather than answered here
