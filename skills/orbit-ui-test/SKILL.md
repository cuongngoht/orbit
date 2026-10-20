---
name: orbit-ui-test
description: >
  Run or author a UI test case written as JSON in machine-store drafts or existing regression cases with the orbit
  engine: one command drives the whole case through playwright-cli, verifies UI + API + SQL,
  and captures evidence on failure. Use when asked to test a screen or flow end to end, to add
  a test case, or to find which screen/control/path to use from the UI map. Project-specific
  traps and preflight rules live in the consuming repo's own playbook; this skill is the
  engine's contract.
argument-hint: <case id | "add a case for …" | screen or control to look up>
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

# Drive the UI from a JSON case

run from anywhere inside the project (the engine finds `$DATA/` by walking up, or through
`ORBIT_UI_TESTS`).

**Two shared references, the same for every `orbit-*` playbook.** Read the one you need; do not
re-derive what is in them:

- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/tools.md` — which Claude Code tool does
  which QA job, what to do when an optional one (LSP, ToolSearch, a subagent, an MCP server) is not
  in this session, and the lines that do not move.
- `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/dsl.md` — how to read the JSON DSL off the
  tables that define it (`query.mjs dsl`) instead of from memory.

## 0. Recall first — someone already ran into this

The project remembers, in the machine store (`node <engine>/cli/learn.mjs where --root`): a ledger of every finished run on
**every** machine, and the notes people wrote. Read the slice for the thing in hand, never the
store:

```bash
node <engine>/cli/query.mjs notes <case | screen | "screen/control" | machine>
node <engine>/cli/query.mjs history <case>    # has it ever passed, what did it fail on last time
node <engine>/cli/query.mjs flaky             # cases that do not give one answer
node <engine>/cli/learn.mjs recall <case | screen>   # what several sessions have already shown
```

`learn recall` is the cross-session half: the ledger says what happened, a lesson says what keeps
happening. It also prints what it held back and why. Driving one case is not a milestone, so do
not run `learn analyse` here — `orbit-test-suite` does that once the session has a review.

`history` merges every machine's ledger, so a case that passes here and fails on a colleague's
laptop shows as `SPLIT` rather than as your problem alone — a different bug from one that flips
over time, and `flaky` says which of the two it is. Never re-investigate a failure the ledger
already explains.

Write one back **only** when you concluded something that changes what the next run does — a trap,
a decision, a false alarm:

```bash
node <engine>/cli/note.mjs "<about>" "<title>" "<body>" [--type=trap|decision|finding]
```

`<about>` is a key the map already uses: `case:<id>`, `screen:<id>`, `"<screen>/<via>"`, `machine`,
`project`. **"It passed" is never a note** — the ledger records that automatically, and a note
repeating it ages into a lie. A note is stamped with the machine that wrote it and the frontend
commit it was true at; `notes` says `STALE` once the frontend moves past it, and a stale note is
re-judged, not obeyed.

The notes live in machine memory and may be shared or projected, so **nothing secret goes in one** — no
token, no password, no connection string. And a note filed under `machine` is advice from one
laptop: check the host it came from before following it.

## 1. Look up, do not explore

```bash
node <engine>/cli/query.mjs cases                 # a recorded case ends the lookup — run it
node <engine>/cli/query.mjs case <id>             # its steps, resolved to real selectors
node <engine>/cli/query.mjs screen <id>           # controls on a screen, and where each leads
node <engine>/cli/query.mjs path <from> <to>      # shortest click-path
node <engine>/cli/query.mjs find <text>           # search screens and controls
node <engine>/cli/query.mjs effect "<screen>/<via>"   # what a control does below the UI
node <engine>/cli/query.mjs dsl [<verb>]          # the case vocabulary, generated from the tables
node <engine>/cli/query.mjs verify                # is the map still true? (see §5)
```

Never read the whole map into context. Snapshot only to verify, never to find a button.

Follow `${CLAUDE_PLUGIN_ROOT}/skills/orbit-ui-test/references/storage.md` for draft storage, discussion notes,
report delivery and explicit promotion.

## 2. Run a case

```bash
node <engine>/cli/run-case.mjs <id> --draft NAME=TC-… --dry          # read the resolved plan first
node <engine>/cli/run-case.mjs <id> --draft NAME=TC-… [--force-destructive] [--json] --report
```

For an existing regression case or an HTML report path, omit `--draft`.

- The browser must already be open and signed in: the **project's launcher** opens it (where the
  project has a preflight guard, only after its question has been answered), and
  `ORBIT_RUN_DIR` must point at the run directory it printed. The runner refuses (exit 2) on a
  missing or signed-out session rather than timing out. A project with no launcher of its own can
  use the one this plugin ships: the `orbit-browser` skill picks a browser and a signed-in
  profile from this machine and opens the session.
- Exit **0 PASS** — and only PASS means the case was verified. **0 SKIP** (`skip-if` said the work
  was already done) · **0 PARTIAL** (a `--from`/`--to` slice held: a fact about those steps, not
  about the case) · **1 FAIL** (evidence in the printed dir) · **2 REFUSED** · **3 BLOCKED**
  (database unreachable, `resolve` found no row, a child process killed, the run deadline spent —
  none of them a product failure) · **4 INCONCLUSIVE** (nothing ruled on the product: no `assert`,
  `api`, `sql` or `report`+`expect` executed).
  Never report PARTIAL or INCONCLUSIVE as a pass, and never report BLOCKED as a defect. For a SQL
  Server project the database side is the `orbit-sql` skill; BLOCKED is a connection to fix.
- Output is one line per step; details are in `run-log.jsonl`. Do not re-drive a failed step by
  hand from the log — fix the case or the map and re-run with `--from=N`. A sliced re-run is
  recorded as PARTIAL, so say "steps 4..6 held" and re-run the whole case before claiming it passes.
  A slice must include the click an `api` step asks about, and the step that binds any `${…}` it
  uses, or it is refused.
- A human running unattended uses `run-awake.mjs` (keeps the machine awake, opens one browser
  per identity, closes them). Agents do not: the launch must be visible to the guard.

## 3. Author a case (adding a case is adding a file)

Which cases to write at all is a different job: `orbit-test-plan` interviews the person who knows
the feature and writes `$DATA/screens/<screen>/<id>.plan.json`. Start there when nothing has been agreed
yet; start here when the scenario is already decided.

1. Start from the closest relevant case and save a draft through `draft.mjs write`.
   Keep it in machine memory, including after PASS; promotion requires an explicit request.
2. Every step names an edge (`on: "<screen>/<via>"`) — never copy a selector. A literal
   `selector` only where the label *is* the parameter.
3. Every `click` gets a `wait` for the thing you care about; the first paint is not it.
4. End with `report` + `expect`; put `api` **immediately after the commit click and before any
   reload** — it proves a request made since the last action, so a `goto` in between loses it;
   `sql` after the reload. A case that declares `creates` and rules only on the screen is a
   **finding**, not a style note: `check` exits 1. The map checks the case too — assert the
   method and the call `graph/effects.json` records for the control you drove, and query the
   table it records. You still write the predicate; the map never guesses which row.
5. A case that creates something declares `creates` and puts its `skip-if` **before the first
   step that changes anything**. One at the end is a report, not a guard.
6. Anything about permissions declares `identity` with `roles` **and** `notRoles`. Use
   `identities` + `as` only for a case that really switches, and make the two state different
   things — otherwise nothing could tell a failed switch from a real one.
7. A `${PARAM}` inside SQL goes in quotes: `WHERE Name='${NAME}'`, never `WHERE Id = ${ID}`.
8. Need a value the case cannot know in advance — the id of the thing it just made? `into` on the
   `report` or `sql` step that produces it, then `${NAME}` in any later step. One value, bound
   once, readable only afterwards. Never bind a secret: it goes into the shared ledger.
9. `node <engine>/cli/query.mjs check` — zero findings, and it **exits 1** if there are any — then
   `--dry`, then run, then record `seen: "live"` and `fe_commit` in the same turn.

The vocabulary is a closed set, and **never written from memory** — ask the engine:

```bash
node <engine>/cli/query.mjs dsl              # every verb and field, summarised
node <engine>/cli/query.mjs verb <name>      # kind, needs, the fields it may carry, what it proves
node <engine>/cli/query.mjs field <name>     # type, which verbs allow it, which language it is read as
```

All three are generated from `src/dsl/core/verbs.mjs` and `src/dsl/core/fields.mjs` — the same rows the
editor schema (`$DATA/schema/case.schema.json`, written by `node <engine>/cli/schema.mjs --write`) and the
validator read. So what they print is what the engine accepts *today*, and a cheatsheet anywhere
else would be a second definition that drifts. **Never hand-edit a generated `schema.json`.**
The semantics those tables cannot carry are in `references/dsl.md`.

A case the validator refuses is `orbit-dsl-doctor`'s job: it reads the findings, asks
`query verb`/`query field` what the contract is, and makes the smallest change that satisfies
them. It repairs how a case is *written*, never what it *means*.

## 4. Correct the map, not the case

A stale selector is fixed once in `$DATA/graph/edges.json`; new controls go through
`record-edge.mjs`, which validates and rolls back on any `check` finding. Never delete a record
to tidy up — a wrong record is evidence. Run `query.mjs check` after touching the map. Filling the
map, or re-observing what drifted, is a job of its own: the `orbit-ui-map` skill.

An effect's `layers` and `timing` use **this project's** vocabulary, declared in
`$DATA/graph/meta.json` (`layers[]`, `timings[]`). The engine knows only `sql` and `sync`; a
word that is not declared there is a `check` finding, so add the word to `meta.json` — never to
the engine.

## 5. The map is memory — check how old it is before you trust it

Every record carries `seen` (`live` = observed in a browser, `src` = read from code) and the
`fe_commit` it was recorded at. That is what makes the map datable:

```bash
node <engine>/cli/query.mjs verify
```

It resolves every cited `file:line` on disk, compares the map's `fe_commit` with the frontend
checkout, and names the exact records citing a file that changed in between. `check` prints a
one-line warning when the frontend has moved; `verify` is the one that says *which* records.

- Run it **before trusting the map** on a feature you have not touched in a while, and whenever a
  case fails in a way the map does not explain.
- A record that says `seen: "src"` has never been observed live. Treat it as a hypothesis: it is
  what the code said, not what the product did.
- A drifted record is **not** deleted. Re-observe it and update it in place — a wrong record is
  evidence of what changed, and deleting it loses that.
- Re-stamp `seen: "live"` and `fe_commit` in the same turn you re-observe, or the map silently
  ages back to the same problem.

## 6. Report

```bash
node <engine>/cli/report.mjs [<evidence-dir>]     # default: the most recent run
```

The report lands in the reports directory under the case's start screen and the case
(`$REPORTS/<screen>/<case>/<run>.html`), named after the run, with a copy in the store: the verdict, then one card per layer — UI what the
screen showed, API the call it made, SQL the data underneath — each with the exact text of every
question asked, the SQL already interpolated, and the command line to run that query again. Hand
that file to whoever asked; it is the artifact, and it can be re-read without you.

**Every UI verdict carries its screen, whether it held or broke** — so a passing run produces an
illustrated report, not just a green word. Only ui verdicts are photographed (an HTTP status and a
row count are not things a picture shows), which means where you put `assert` / `report`+`expect`
decides what the report shows. Authoring a case, place one at each moment somebody would want to
see. Every image is embedded in the file as base64 and the case's own JSON travels with it, so
send the HTML on its own — there is nothing beside it to take along, and
`run-case <that-report.html>` runs the case again even after the file is gone.

In the conversation, link the HTML report first, then the evidence dir and `run-log.jsonl`, the case's own `report` value,
and the identity claims it ran as (roles, upn — never a token). **Say which layers it proved** —
the RESULT line ends in `proved ui 2 · api 1 · sql 1`, and a PASS that proved only `ui` checked
that a screen drew, not that anything was saved. A FAIL is a product finding only when the map and
the case are right; say which of the three you believe is wrong — and do not decide that by
eye. `node <engine>/cli/query.mjs triage` sorts the evidence into what it demonstrates, what it is
merely consistent with, and what it cannot tell, and classifies it with a confidence;
`orbit-failure-analyst` turns that into one of nine causes with the evidence for it, and names the
specialist that owns the repair — or nobody, which is the answer more often than it looks. A
timeout is not evidence that a selector changed. The whole routing is `orbit-test-suite` §2b.

Then close the loop: the run is already in the ledger, so write a **note** only for what the
ledger cannot say — which of the three was wrong, and why. That sentence is what stops the next
session re-investigating the same failure from scratch (§0).
