# ADR 0037 — A test writes only through an engine-minted, fixture-bound grant

## Status

Proposed (0.1.0). Extends ADR 0012 (a task is an execution) and ADR 0014 (sandbox).

## Context

1. **No backend write could be tested autonomously.** A capability with `mutates: true` needs its case to say
   `destructive: true` (`src/capability/invoke.mjs:67-70`), and autonomous QA never runs a destructive case
   (`src/investigation/dispatch.mjs:36`, `gates.mjs:51`, `cli/autonomous-qa.mjs:139`). A data check also refuses a
   mutating capability (`src/investigation/data.mjs:94`). So the POST, publish, enqueue, trigger or acknowledgement a
   backend obligation needs was out of reach.
2. **`creates` assumes a browser.** Its guard is a `skip-if` before the first `changes` step
   (`src/dsl/rules/head.mjs:61-69`). A mutating `call` is not a `changes` verb, so the rule can neither see a backend
   write nor be satisfied by one.
3. **The obvious ways round are not rules.** Labelling a write `mutates: false`, or reaching for `--force-destructive`,
   bypasses the gate instead of governing the write.

## Decision

- **`mutates` does not imply destructive.** A test may write the resources of its own fixture through a GRANT that the
  engine mints. A destructive test outside the fixture stays refused in every mode.
- **Minting is an ordered table.** `MINT` (`src/runtime/sandbox/test-grants.mjs`); each row refuses with its own id:

  | Row | Requires |
  |---|---|
  | `OWNED` | the task owns the sandbox |
  | `ISOLATED` | the isolation profile holds (ADR 0038) |
  | `MODE` | the investigation mode allows the operation class |
  | `CAPABILITY` | active, pinned, and declaring this class and its effects |
  | `FIXTURE` | every resource is in this run's fixture receipt |
  | `INDIRECT` | every downstream effect lands in a fixture sink: a publish never licenses a real email, payment or webhook |
  | `DESIGN` | an oracle and a design are bound |
  | `ALLOWLIST` | the operation is one the design declared |
  | `BUDGET` | budget is left |
  | `TREE` | the source tree is current |
  | `POLICY` | a person's standing policy covers it; otherwise a task approval granted in Control, spent once |

  A grant is minted at dispatch, once the sandbox, endpoints, fixture and tree are known. Nothing an agent sends — a
  field, a flag, `--human` — mints one.
- **A grant names everything.**
  - Identity: task, run and attempt; sandbox and tree; capability and adapter with their versions; principal; resource
    bindings.
  - The operation class and its selectors: method and path; or channel, group and publish/consume/ack/commit; or
    schedule, occurrence and clock.
  - Limits: an input digest, the effects, and bounds on uses, rate, concurrency, messages, jobs, range and count.
  - Validity: an expiry on a monotonic clock, the policy revision, and the oracle and design refs.
- **Spent once, before the effect.** A locked append consumes one use and writes an effect-intent receipt
  `{grant, class, operationKey, requestDigest}` before the send. The acknowledgement receipt follows the send.
- **AMBIGUOUS is read back, never resent.** A lost answer after a write, publish, enqueue, trigger, signal or ack is
  reconciled through the adapter's declared read-back:
  - **present:** the late result is linked;
  - **absent:** a new attempt, under a NEW grant, only where the design says the operation is safe to retry;
  - **unknown:** it stays AMBIGUOUS, and a person releases it.
- **An intentional duplicate is its own grant** (`duplicateOf`), and so is a replay (`replayOf`, with a range and a
  count). A second use of any grant, which is what a transport retry would be, is refused.
- **The gates read the grant.**
  - `invoke.mjs` asks `grants.problem` where it now asks `destructive`.
  - `caseWrites` counts a mutating `call`.
  - A `fixture-write` mode.
  - New gate rows: `UNGRANTED`, `NOT_ISOLATED`, `NO_FIXTURE`.
  - `createsOf` is satisfied by a fixture-scoped mutating capability with a fresh-namespace receipt
    (`src/run/gates/fixture.mjs`). It sees a mutating `call` through a capability lookup handed to `validate()`.

## Consequences

- An approval stays a person's (Control's door). A grant is never a standing permission.
- Runtime governance gains three operations: FIXTURE_SEED, FIXTURE_CLEANUP and TEST_DISPATCH.
