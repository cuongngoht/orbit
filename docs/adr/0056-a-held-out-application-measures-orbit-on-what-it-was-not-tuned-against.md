# ADR 0056 — A held-out application measures Orbit on what it was not tuned against

## Status

Accepted (0.5.0; backlog B2, "Reliability and generalisation"), 2026-11-07. Development tooling: no engine contract
changes. Builds on ADR 0046 and 0048 (the benchmark, its engineering cases, its controls and metrics), ADR 0049 (a
release qualifies on benchmark evidence) and ADR 0051 (recorded rows). Additions to what a person can observe: the
benchmark's fixture `benchmark/fixtures/lending/`, its suite `orbit-heldout` (ORBIT-HLD-001 to 005), the suite in the
release policy's catalog and among its recorded suites, in the conformance tier's controls matrix, and one scripted
held-out goal in its scripted job.

## Context

1. Every 0.4.0 fix was found on the benchmark's own cases, and found again on them after it was made. A rate on those
   cases says how Orbit does on the cases it was fixed against. It does not say how Orbit does on a project nobody had
   looked at, which is every project a team brings.
2. B2 asks for a second application in a different domain, with its own cases, whose author did not read the 0.4.0
   failure reports and against which nobody tunes Orbit before its first run. It also proposes a target: the held-out
   suites within 15 points of the tuned ones.
3. The backlog's open question 5 asks who authors it, so that it stays independent of the tuning.
4. The engineering kind (ADR 0048) already takes a fixture, a goal, hidden checks, gates, record checks and scripted
   controls. A second application needs no new kind. It needs a fixture, cases on it, and rules that keep it held out.

## Decision

### Part 1: a second application

`benchmark/fixtures/lending/` is a lending service that several library systems share. Every record says the system
it belongs to. The service keeps:

- a catalogue of titles and copies (a book may be out three weeks, a DVD one);
- members, each limited to five items out at once;
- loans that are renewed and come back;
- fines for late returns;
- holds served first come, first served;
- an HTTP-shaped API, `handle(store, { method, path, tenant, today, body })`;
- the drop-box consumer, an asynchronous worker that checks returns in from the scans a library's return box sends.

Records live on disk, one JSON file each. It has no dependency, and like every module under `benchmark/` it holds to
Five Lines. Its 50 public tests sit under `checks/`, one file per behaviour, and become `test/<name>.test.mjs` in the
checkout a run makes. Its domain is neither the order service of `orders` nor the invoice application of the QA
cases.

It is the reference solution every held-out case starts from. Each case's `real` variant takes one behaviour away,
with the public tests that would reveal it, as the tuned engineering cases do.

### Part 2: five goals, as the people who run the service would ask them

`orbit-heldout` holds five engineering cases. Each request is written from the service's own point of view: the
behaviour, the routes and the field names, never a file, a fault or a fix.

| Case | The request |
|---|---|
| `ORBIT-HLD-001` | Charge fines for late returns by the day and the format, never above the copy's replacement cost, at the desk and through the drop box, and show what a member owes. |
| `ORBIT-HLD-002` | Set a copy that comes back aside for whoever has waited longest for its title: their hold ready for a week, a notice sent, the copy theirs alone to borrow. |
| `ORBIT-HLD-003` | Let members renew a loan: from the due date it had, twice at most, never when it is overdue, waited for or back. |
| `ORBIT-HLD-004` | Keep each library system's records to itself, in every request and in the drop box. |
| `ORBIT-HLD-005` | Give teachers a higher limit. It names neither who counts as a teacher nor how many items they may have, so it must be refused, never invented. |

Each case has its own hidden checks: a spec with a reference model written from the request, never from the
fixture's code, a self-test against a table written by hand, and a probe that drives only the application's API, its
store and its drop box. They use seeded inputs with the calendar's and the rules' boundaries, and checks that must
refuse beside checks that must accept. Each group of checks judges only the facts its sentence is about.

The proof is the engineering kind's: the hidden checks, the remaining public tests as the gate, the host's own
regression test before and after, `SCOPE`, and the record checks on what Orbit's owners said.

### Part 3: the controls

Every change case is proven by:

- **Verifier controls.** The solved fixture PASSes, the `real` variant FAILs, and a partial change FAILs.
- **Hosts carried through Orbit's engine:**
  - a reference goal that must PASS;
  - a half: the partial change with a regression test of its own. The engine completes it, and the hidden checks
    refuse what it left out;
  - a cheat. Three of them make the change and delete, weaken or skip an existing test, and are refused by name before
    anything of them runs. The fourth changes nothing and brings a test that held already, which the verifier's
    own-test proof refuses;
  - an idle host, which must make no progress.

The request with no rule is proven by a scripted `blocked` host that must PASS, an inventor that makes a rule up and
must FAIL, and an idle host.

`test/benchmark-cases.test.mjs` holds every case as it holds every engineering case. `test/benchmark-heldout.test.mjs`
adds what a held-out case needs:

- its fixture is no tuned case's;
- its budget is exactly the tuned engineering cases';
- nothing Orbit ships names the application or a word only its domain has;
- each cheat is refused by name;
- each half and each `real` variant fails exactly the behaviours it leaves out;
- a request names behaviour, never a file.

### Part 4: who wrote it, and what they did not read

An agent wrote the fixture and its cases under an independence rule given with the item. It did not read:

- the release failure reports and diagnoses: `docs/handoff/`, `docs/audit/`, the backlog's "found by" and "left open"
  notes of B7, B21 and B22, and the lessons of `CLAUDE.md`'s "Shipping a release from Claude Code cloud";
- any existing case's `verifier/` or `controls/`, nor any tuned case's request;
- `acceptance/truth.json` and `acceptance/designs/`.

It read the authoring documentation (`AGENTS.md`, `benchmark/README.md`, `docs/agents/extend.md` and `layout.md`), the
engineering kind's code and tests, and, of the engine, what the engineering loop's review and verification plan say of
a change: that is how it knew what an engine-carried cheat comes to. `benchmark/README.md` lists the tuned cases' goals
and the QA cases' planted defects in a line each. Of the tuned engineering cases it read only their budget fields
(limits, samples, the regression-test rule, the imports a change may add, cleanup), so that a held-out rate stands
beside a tuned one under the same allowance.

Two things reached it all the same, and are said here:

- **`CLAUDE.md`.** The harness loads the repository's `CLAUDE.md` into every session as project instructions, so its
  shipping lessons were in the author's context from the start.
- **The `CHANGELOG.md`.** Reading its head to place this item's entry showed the first entries of `[Unreleased]`,
  which describe diagnoses of QA rows.

Both are about QA investigations and the ship. The goals were written from the lending service's point of view, and
none follows from them.

A person should confirm the independence, the backlog's open question 5, before the suite's first rows are read as a
measure of generalisation.

### Part 5: kept held out

- **Nothing Orbit ships names the application.** No file under `src/`, `cli/`, `skills/`, `agents/`, `hooks/`,
  `catalog/`, `templates/`, `schemas/`, `satellite/src/` or `control-server/src/` may name it or a word only its domain
  has (a test holds the list). A fix that a held-out row exposes is then one every project gets, or it is not made.
- **Its model rows are recorded, never required.** The suite's controls are required from the day it lands. Its five
  model-carried rows are recorded (ADR 0051), as every new suite's are, and leave that list only by the promotion rule.
- **A row's miss is diagnosed, never fitted.** It is diagnosed from its run's room like any other row's, and a case is
  never loosened to pass. A defect a held-out row finds in Orbit is fixed as any defect is: generically, and with a
  regression test of its own. From then on the suite is tuned for the behaviour that fix touched, and the change log
  says so. The next held-out cases are written fresh, under the same rule, on an application of their own.

### Part 6: what it measures, and how its rows stay apart

The B2 target is the held-out suite within 15 points of the tuned one. Here that is the pass@1 of `orbit-heldout`
beside that of `orbit-engineering`, on the same model at the same effort, under the same budget. On Sonnet 5.5 at
medium effort, the release's own model, both come from the same kind of run.

Rows stay apart by suite. Every row of `metrics` and of `reliability` names its suite (`rates.rows[].suite`), and
`--suite` narrows the fold to one. So `node benchmark/run.mjs reliability --suite=orbit-heldout --revision=<commit>`
and the same with `--suite=orbit-engineering` give each suite's pooled pass@1 per host, in `rates.models[]`, at
`claude-sonnet-5-5@medium` for the coding-host basis. Their difference is the measure, and the release notes quote it
beside the reliability report. `--repeat=5` gives each held-out row the five runs B2 asks of every model-carried row.

### Part 7: no held-out QA suite yet

A held-out QA case needs a whole QA target:

- an application Orbit's engine can bring up in an isolated sandbox;
- an Orbit project with a system graph, an accepted requirement and contracts, and an accepted plan;
- planted variants;
- a ground truth in the engine's own outcome words.

The QA kind holds every truth to acceptance's (`acceptance/truth.json`), which the independence rule kept from this
author, and proving its controls needs the QA worker and Docker. A held-out QA suite needs either a truth kept with
its own application (a `TARGETS` row and a truth its own test holds), or an author free to read acceptance, plus a
person to run its controls. It is left to a later item, and the backlog says so.

## Consequences

- **Generalisation has a number.** A held-out rate within the target says the tuned cases' pass rate is not an
  artefact of tuning. A wider gap is a finding about Orbit on new projects, and never a reason to edit the held-out
  cases.
- **Five cases are a coarse instrument.** One run of each moves pass@1 by 20 points, and five runs of each by 4. The
  target is read over repeats, never over a single ship.
- **It costs five recorded rows per ship**, at the tuned engineering cases' budget of at most 15 USD each, plus the
  repeats a person runs for the reliability report.
- **The held-out cases stay held out only as long as nobody tunes against them.** The test that nothing shipped names
  the application holds the visible half of that rule. The other half is a person's: a fix a held-out row exposes is
  said as such in the change log, and the cases it touched are no longer evidence of generalisation for it.
