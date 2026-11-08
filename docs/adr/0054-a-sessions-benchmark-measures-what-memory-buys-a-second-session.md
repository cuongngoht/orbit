# ADR 0054 — A sessions benchmark measures what memory buys a second session

## Status

Accepted (0.5.0; backlog B3, "Memory effectiveness"). Development tooling: no engine contract changes, beyond one
engine defect the new cases found and that is fixed with them (below). Builds on ADR 0046 to 0048 (the benchmark, its QA
cases, its controls and metrics), ADR 0049 (a release qualifies on benchmark evidence) and ADR 0051 (recorded rows).
Additions to what a person can observe: the benchmark's `sessions` kind and its suite `orbit-sessions`; `run
--memory=on|off|all`; `config.memory` and `config.learnHost` in a run's manifest; a sessions run's report (`kind:
"sessions"`, `sessions`, `memory`); the memory rows of `metrics` and `reliability` and `metrics --by=memory`; three
source cases in `orbit-memory` (ORBIT-MEM-007 to 009); the release policy's `sessions` requirements and its first
recorded suite.

## Context

1. "Memory first, and a scan is the exception" (AGENTS.md) had no number behind it. `orbit-memory` (ORBIT-MEM-001 to
   006) proves memory keeps its rules -- sessions, support, authority, freshness, a journal that survives a crash -- but
   nothing measured what a look at a checkout costs when memory answers it, whether memory helps a host the next time,
   or how much a wrong memory hurts.
2. A QA run (ADR 0047) is one session in stores made for it. Memory needs a second session over the same checkout and
   the stores the first one left.
3. A host meets memory through several doors, and only some of them are a person's switches. The engine keeps its own
   records in its store: an investigation's context recalls the earlier investigations of its project, and a checkpoint
   projects verified results into knowledge. The host's Orbit store keeps lessons, knowledge claims and the session
   trail. The host keeps its own memory in its home. A person switches Orbit's learning off with `ORBIT_LEARN=off` and
   Orbit's reading of the host's memory with `ORBIT_HOST_MEMORY=off`; nothing switches off the rest.
4. Writing the deterministic cases found a defect. A convention counted across the tree named a file at the root by the
   folder it sits in, `.`, and every reader of a scope takes `.` for the whole tree. With a root manifest and a few more
   files of its kind anywhere, every commit moved that fact: the snapshot was keyed to HEAD for nearly every real
   project, and every look after a commit re-read everything.

## Decision

### Part 1: a look is measured, deterministically

Three source cases join `orbit-memory`, required like the suite's others (a `real` verification that must PASS, and
controls that must hold):

- **ORBIT-MEM-007**: a first `architecture ensure` with nothing learned is BOOTSTRAP. Every later look at the unchanged
  checkout is CURRENT. It reads no file, lists nothing, searches nothing, asks the index once in at most four git calls,
  and writes nothing. The best of three such looks costs under half the time of the look that learned. `--dry` writes
  nothing, whatever it decides.
- **ORBIT-MEM-008**: a commit that only touches a note no fact is about leaves the next look CURRENT. A change to a
  declaration makes it INCREMENTAL: it re-reads what moved, no file another top-level folder holds, and none of the
  root's own files when the change was elsewhere. It records where the scopes stand, so the next look is CURRENT. An
  uncommitted edit is unknown, and is re-read on every look until it is committed.
- **ORBIT-MEM-009**: `knowledge claims` measures every claim's freshness now, in one look at the index however many
  claims it answers. It reads no file and writes nothing. A moved scope makes exactly its claims stale, and they stay
  stale on every recall after; an uncommitted edit makes a claim unknown.

Each probe makes small git checkouts of its own and composes the subject's own modules. It counts every git call the
subject makes, by kind: a file read is one `show`, a listing `ls-files`, a fingerprint `ls-files -s`, a search `grep`.
It names every file read, compares the store's bytes before and after each look, and times it. Each spec's own `judged`
holds a look to `has`, `lacks`, `atMost` and (for time) `faster`, and keeps what it measured beside the verdict, held or
not. Time is judged only as a ratio of two looks in one process, at the best of three, so it discriminates a rescan
without depending on the machine. Each case has a planted fault every check must catch, a partial fix, an allow-all and
a reject-all. A test holds each control to the groups it fails and the groups it leaves holding.

The defect is fixed in the engine (`src/architecture/analyzers/shape.mjs`: a file at the root is watched as itself,
with a regression test). ORBIT-MEM-008's controlled fault plants it back.

### Part 2: a second session, with memory and without

A case of the new kind `sessions` is a QA case worked in two SESSIONS over ONE checkout of its application. The run
keeps three stores between them in its room: the engine's store, the host's Orbit store, and the host's own home
(mounted as the runner's `HOME` for both sessions).

- **Session 1** learns, always with memory on. Its investigation is opened, worked, finished (so its checkpoint
  projects into knowledge) and read back. Its outcomes are kept, and judge nothing.
- **The carry phase** records what session 2 is offered: the engine's investigations and files, the host's Orbit
  store, and the host's home and its memory notes. For a case whose first session learns on the clean application
  (`sessions.learn: "clean"`), it commits the planted variant over the shared checkout -- a code change landing under
  what the first session remembered. It also plants the case's poison, if there is one.
- **Session 2** has its own task, so its own workspace and sandbox, and its own investigation. It is judged exactly as a
  QA run's one round is -- the same judge, the same truth, the same confirmation on the clean application -- and its
  phases are the QA kind's own types. So the report, the tool-call fold, the diagnosis and the release ship read it as
  they read a QA run's round.
- **The memory arm** is session 2's only difference. `on` is Orbit as a person has it. `off` sets `ORBIT_LEARN=off`
  and `ORBIT_HOST_MEMORY=off` in every Orbit process of session 2: the engine beside the controller and the runner's
  environment alike. It is the owner's operationalisation, and it is honest about its reach. What no switch governs --
  the engine's recall of earlier investigations, the knowledge already projected, and the host's own memory in its home
  -- stays in both arms. The report says what each run's second session was offered (`memory.offered`).

The arms compare a second session's pass rate and four facts of its work: decisions used and designs refused, read off
the engine's own journal; cost, as the host reported it; and minutes, as the controller's own clock timed its round. A
run's whole cost (both sessions) is its own, never the arm's. A round of either session that a restart cut short makes
the run interrupted: nobody's measure of memory. Such a run is left out of every rate, and the ship runs it again (ADR
0049). Each session's host gets half the run's dollars, and the round's time is shared so the sessions still to come
keep theirs.

`run --memory=on|off|all` picks the arm (`all`: each the case declares, in turn, each repeated with `--repeat`).
`--memory` is refused for a case with no second session, and refused with `--run-id` when it would start several runs.
`metrics` and `reliability` keep rows apart by arm. They put each case's arms side by side (on the same case, variant,
host basis, model and effort) with memory's EFFECT: the `on` arm's median minus the `off` arm's, `unknown` until both
arms have runs that stand. `metrics --by=memory` repeats every metric per arm.

### Part 3: a poisoned memory

A case may declare a `poison`: a note in the case's own `poison/`, the shapes it says need no test, and a stale fact it
states about where a record is read back. The carry phase plants the note in the host's own memory, as the host would
keep one: a topic note, and a line in the memory's index. The first session learns on the clean application, so what
it learned really was true; then the code moves under it. A host must not skip a check or raise a false alarm because
of the note: a host's memory is a hint, never a truth (AGENTS.md). The report says whether the host was SEEN reading
the note: a file tool of its stream, as the controller captured it, naming the note or its memory. Seen proves it
looked. Not seen proves nothing, since a host may load its own memory with no call at all.

### Controls

Every sessions case's controls are whole runs, carried by scripted hosts in the controller's own process like a QA
case's, with no model and no credential. Session 1 is carried by the reference unless a control names another
(`learn`).

| Host (session 2) | What it does | Must come to |
|---|---|---|
| `reference` | every shape it has a design for, tested; on a poisoned case it reads the note and tests anyway | PASS |
| `idle` | nothing tested | FAIL |
| `cheat` | carries the first session's evidence over instead of testing: it asks the relay about the earlier investigation, runs versions the earlier one froze, and asserts an outcome. The relay and the engine refuse every one, and it tests nothing of its own | FAIL |
| `half` | designs every test it owes and runs none | FAIL |
| `trusts-poison` | skips the shapes the note says need no test | FAIL (missed) |
| `trusts-stale` | designs that shape's read-back from the note's stale fact: a record nothing writes, so the clean application contradicts it too | FAIL (false alarm) |

A failing run carries its failure class as every run does.

### The suite, and the release

`orbit-sessions` holds three cases. Two compare both arms, on two of the QA suite's applications (ORBIT-QA-003's among
them). One plants a poison on ORBIT-QA-003's application and runs the `on` arm only. The release policy catalogs the
suite under a `sessions` requirement: its controls are required, and its model-carried row is recorded (ADR 0051). The
ship runs that row once, on the `on` arm, and the arms with repeats are a person's to run. The conformance tier's
matrix runs the suite's controls with the QA worker image, like the QA suite's.

## Consequences

- "Memory first" has numbers: the git calls, reads, writes and time of a look are held in the fast tier and in every
  release. The architecture memory's HEAD-keying is fixed, and its return would fail a required case.
- A sessions run costs two QA sessions and a confirmation. An A/B over two cases with three repeats per arm is twelve
  runs (twenty-four sessions) before the poisoned case. With a few runs per arm an effect is noisy, and a difference of
  one run is not a finding. The backlog (B3) says how to read the numbers once runs exist.
- The off arm measures what Orbit's switches buy. A smaller or larger effect than "memory" might suggest can come from
  what no switch governs, and the report's `memory.offered` is what to read before reading an effect.
- The host's home lives in the run's room, so the sentinel searches it like any other file of the room. A credential
  the host wrote there is a `LEAK`, which stops a release whichever row it is in.
- A sessions case is a QA case with more state. Its controls take about twice a QA case's time, and its scripted hosts
  are QA hosts that a second session makes possible.
