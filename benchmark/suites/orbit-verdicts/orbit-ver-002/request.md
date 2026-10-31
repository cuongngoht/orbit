# ORBIT-VER-002 — a cause is never guessed: a failure that recorded no phase is not a failed browser command

`src/query/classify.mjs` says what a run that did not pass is evidence OF, so the right owner makes the next move. It
decides no verdict. `classify(facts)` answers `{ type, confidence, because, next, handoff }` from one ordered table over
facts a caller can DEMONSTRATE, never over the text of an error message: the first row that holds wins, and the last
row always holds. The field that makes it possible is the stopped step's `phase` (`failure.phase`), recorded by
whoever threw: `bind` (a placeholder reached the step unfilled), `act` (the browser command itself failed) or `wait`
(the predicate never held). A failure that recorded no phase, from a log written before the field existed, says
nothing about which part of the step stopped, and is never read as `act`.

The table, in order (a "failed browser command" is a stopped step whose phase is `act`):

1. `DSL_INVALID`, high, handed to `orbit-dsl-doctor` — the validator has findings (`invalid`).
2. `AUTH`, high — the session was signed out (`signedOut`), or there is an identity problem (`identityProblem`).
3. `ENVIRONMENT`, high — the run is BLOCKED and a step stopped (`failure`).
4. `DATA`, high — the step stopped in phase `bind`.
5. `DATA`, low — the run is BLOCKED and no step stopped.
6. `PRODUCT_FAILURE`, low — a failed browser command on a step that did not rule (`ruled: false`), with a call
   outside 2xx (`nonTwoXx`).
7. `MAP_DRIFT`, high, handed to `orbit-map-healer` — a failed browser command on a step that did not rule, on a known
   edge whose locator was resolved (`edgeKnown`, `selectorResolved`), no call outside 2xx, and the record named as
   drifted (`driftedRecord`).
8. `MAP_DRIFT`, low — the same without the record named as drifted.
9. `PRODUCT_FAILURE`, high — the run FAILed on a step that ruled (`ruled: true`).
10. `TIMING`, low — the step stopped in phase `wait`, and this machine passed the case at the same build
    (`passedHereAtSameBuild`).
11. `CASE_LOGIC`, high — the run is INCONCLUSIVE and the whole case ran (`whole`).
12. `UNKNOWN`, low — everything else.

Confidence is two-valued, and only a `high` classification carries a `handoff`; every other answer's `handoff` is
`null`.

Make the smallest change in `src/query/` that gives this behaviour, and add a regression test under `test/` that fails
before your change and passes after it. Do not change or delete an existing test.
