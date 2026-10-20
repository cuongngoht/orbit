# ADR 0008 — A benchmark with ground truth, and what its first run found

**Status:** accepted, 1.7.0

## Context
The unit tests hold each piece of the loop on its own: a rule, a row, a refusal. None of them
drives an investigation from its first decision to its last. The brief asks for a benchmark with
ground truth before autonomy is raised. It must show that the loop:
- concludes what the evidence supports and no more;
- finds what is wrong;
- recognises what is right;
- never writes what nobody authorised;
- survives a crash without writing twice.

It also asks for a baseline of actions, cycles and redundant steps, from which efficiency
thresholds can be set later.

## Decision
1. **Scripted applications, apart from the truth** (`test/fixtures/benchmark/`).
   - `apps.json` says what each fake PRODUCT does: its requests, its data, its tenancy, its rule.
     It also says what a person approved and how the session goes (two sessions, a crash). It
     never says what the engine should conclude.
   - `truth.json` says what is TRUE, written from the same description before anything runs:
     - the defects, each saying whether its oracle can confirm it;
     - the behaviours that are correct;
     - the exact writes an authorised session makes.
   - Thirteen apps:
     - four defects: a write lost, a double write, a tenant leak, and a save that works one day
       and fails the next;
     - five correct controls: telemetry beside a real write, a 202 inside its declared window, a
       declared retry, a denial with a positive control, and observe mode;
     - a PBI with no screen, both when its rule holds and when it is broken;
     - a hybrid of a plan on its screen;
     - a crash between a click and its settle.
2. **A scripted policy stands in for the host's model.** It takes the frontier's head and fills
   in the template the engine offers. It writes only what a model would write itself: the
   predicate of a read-back and a synthetic value. Being deliberately plain, it measures the
   ENGINE: whether what is owed leads somewhere. Each host session names its decisions afresh,
   as the protocol requires.
3. **Real engine, fake ports.** The PBI's case runs through the real runner with a browser that
   throws on any call, and is triaged by the real triage. Memory goes through the real knowledge
   ingest over a fake filesystem.
4. **Five gates, over every app:**
   - no false confirmation, which also refuses a confirmation its oracle cannot give;
   - every defect detected, with a defect outcome, an oracle and evidence the journal holds;
   - every correct behaviour recognised as expected. Without this gate, an engine that concludes
     nothing would pass;
   - exactly the expected writes, never a destructive control or case, and only read-only SQL;
   - resume and memory hold: the resend is `AMBIGUOUS`, the write is read back, a person
     releases it, and a second checkpoint or a replay from another host adds no support.
5. **The baseline is printed, not gated.** Decisions, actions, checks, runs, probes, redundant
   steps, refusals and decisions-to-first-defect are shown per mode and family, with each
   session's stop reason. A threshold is set only once there is a baseline to set it from.

## What the first run found — each fixed at its source and held by its own unit test
1. **A double write left its read-back owed forever.** The duplicate family owns the extra row, so
   no persistence finding existed, and the post-write obligation stayed pending. The loop read
   back the same row 35 times, until the budget ran out.
   - Fix: a read-back settles its obligation whichever finding its answer landed in
     (`READ_BACK` in `obligations.mjs`).
2. **Asking the same read again counted as progress.** Each repeat was a new record, so neither
   the three-attempts rule nor `no-progress` could trip.
   - Fix: a check that repeats an earlier one's question and answer is not progress (`learned` in
     `loop.mjs`).
3. **A failed accepted case was re-run without end.** A run finding's key held the run id, and the
   loop was told it could settle the suspicion by running the case again. Every re-run made a
   new suspicion.
   - Fix: runs of one case as written are occurrences of one finding, with PASS as an OBSERVED
     occurrence.
   - A run's failure is a person's (`SETTLES.run` is empty).
   - A pass beside a failure of the same case is not "satisfied": the A04 lesson, now for
     obligations.
4. **The plan's own word was ignored.** A manual scenario and a scenario that is not ready were
   owed to the loop. A destructive case could reach the runner, whose own gate refused it — and
   that refusal read as "the environment".
   - Fix: a manual scenario, a scenario that is not ready and a destructive case are a person's
     to settle.
   - `run-case` refuses a destructive case before anything runs.
5. **A reused decisionId returned an old answer.** A host that restarted its counter in a new
   session got an earlier, unrelated decision's result, marked `replayed: true`.
   - Fix: an id sent again for a different step is refused `ID_REUSED`.

## Consequences
- A change that makes the loop conclude more, write more or loop longer fails a named gate on a
  named app. That is the point: it has to be argued as a change to the truth, never slipped past.
- Adding an app is a row of product behaviour and a row of truth, written before running
  (`test/fixtures/benchmark/README.md`).
- The baseline in this release is small, and every app reaches its stop with no redundant step
  and no refusal. Efficiency thresholds are for a later release, set from it.
