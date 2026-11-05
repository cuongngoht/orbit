# ADR 0052 — An adapter operation declares what its request carries, and a design is held to it where it is made

## Status

Accepted (0.5.0). Extends ADR 0035 (the Orbit adapter protocol) additively: `orbit.adapter/v1` gains one optional field
and keeps its apiVersion. Builds on ADR 0036 (helpers and bindings behind a synchronous call) and ADR 0038 (generated
tests run only in a proven isolation worker).

## Context

1. A family operation's capability carries the operation's own parameters in `request`, "handed to the adapter as they
   are" (`src/adapters/core.mjs`). An adapter declared what each operation DOES (`effects`) and what it ANSWERS
   (`outputs`, each field with its meaning), and nothing about what it READS.
2. So a request field the answering helper never reads went unseen until a run. A real host's design read state with
   `request.businessKey`; the adapter that answers `orbit.state.read` reads `key` or `match`. Generation made a draft,
   froze a version, the sandbox dispatched it, and only the helper refused it ("a read below the interface names what it
   reads"). One design, one version and one dispatch were spent on a guess, and the refusal arrived as a stopped run.
3. Worse, a helper may DROP what it does not read: the test-hook adapters answer a `match` only by the fields they know,
   so an observation matched on another field answered every item it read -- with nothing said.

## Decision

- **An operation may declare `request`**: one row per field its helper READS -- `doc` (required), and `type`, `enum`,
  `pattern`, `minimum`, `maximum`, `required`, and for an object `fields` (its own keys, each a row of its own). A row
  says what may be SENT, never what to send: no default, no example, no value. An operation that reads nothing from its
  request declares `{}`.
- **The table is judged with the declaration**, before anything registers, by the walker every field table shares
  (`src/walk.mjs`, `REQUEST_FIELD_FIELDS` in `src/adapters/contract-v1.mjs`), and a `pattern` that does not compile is
  refused.
- **A request is held to it by `requestFindings`** (`src/adapters/contract-v1.mjs`): a field the table does not name is
  refused, naming the fields it reads; a required one missing is named; each field is held to its row by the one leaf
  every table's constraints are enforced by (`src/constraints.mjs`); an object's own keys to its `fields`, when declared.
- **Where: at generation.** The QA generation port (`skills/orbit-qa/ports.mjs`) asks it of every call step a design
  makes, for the adapter selection picks for that step -- the very one the compiler reads the step's `outputs` from -- so
  the validate stage refuses the design as `INVALID_TEST` before a draft exists. Not at run time: the helper stays the
  authority on what it can do, and a request the table allows may still be refused there.
- **Optional.** An operation that declares no table holds its request to nothing here: unknown is never a refusal. The
  adapters this plugin ships declare one for every operation, from what their helpers read.

## Consequences

- A design that names a field its adapter does not read is refused where it is made, saying what the adapter reads;
  nothing is frozen or dispatched for it. A `match` on a field a hook never answers by is refused instead of dropped.
- An adapter's fingerprint is the digest of its declaration (`src/adapters/dispatch.mjs fingerprintOf`), so declaring
  the tables changed the fingerprint of every shipped adapter. Their conformance receipts in
  `docs/backend-acceptance.json` no longer count, and `query adapters --matrix` reads them as unknown until the kits run
  again on the real systems: `node acceptance/kits/messaging.mjs amqp.reference --record`,
  `node acceptance/kits/messaging.mjs jetstream.reference --record`, `node acceptance/kits/state.mjs --record` and
  `node acceptance/kits/hooks.mjs --record` -- Docker with RabbitMQ, NATS JetStream, PostgreSQL 16 and the example
  invoice-a stack. Nothing offline can write a receipt, by design: a receipt is what a real system showed. (The
  test-hook adapters' receipts had already stopped counting when their helper's code moved in 0.4.0.) Selection never
  reads a support level, so no run is affected.
- A project's own adapter gains the check when it declares a table; one that declares none is held to nothing here.
- `docs/agents/extend.md` has the row: what an adapter operation's REQUEST may carry.

## Amendment, 2026-11-05 (0.5.0) — what a match compares, and what a correct application can be held to

The release pre-check (Sonnet 5.5, the real Claude Code host) ended six ORBIT-QA rows of seven FALSE_ALARM: each a
generated test the engine validated and froze that contradicted the CLEAN application too. Two of them were provable from
the design and its declarations, if the declarations said one more thing each:

- **A request row may say `means`** -- for a field a match compares, the meaning (`src/topology/vocab.mjs`) of the
  answered item's field it is compared with -- **and a match row `selects`**: `answer` (only the items that carry every
  one of its fields are answered) or `count` (every item read is answered, and those that carry every one are what the
  request's `count` counts before the wait ends). Absent, either is unknown, and nothing is concluded from it. A `means`
  that is not a meaning is refused with the declaration. The shipped adapters declare both for every match they read:
  the brokers' `observe.await` (`count`) and the hooks' scheduler and worker observations (`answer`).
- **A design is held to them where it is made** (`src/qa/backend/contradictions.mjs`, the `contradiction` stage of
  `src/qa/generation/design.mjs`, GENERATION_FAILED before a draft exists): an assertion that waits for one value of a
  field on a step whose own match names that field with another (`MATCH_PINS`) -- an answer of only the other value
  never holds it, and a wait a count of the other value ends cuts short the window the criterion gives its own -- and,
  naming its own subject, an effect-once-per-key design that holds a second message under a business key to the
  settlement it holds the first to (`SECOND_SETTLED`; the business key is the backend vocabulary's `businessKey`).
- **What a made design rests on and never causes is said, never refused** (`advice`, beside the generate answer): a
  later delivery with no step that faults, stops or restarts a workload, a schedule's decision with no step that moves
  the clock, a second message held alone to a settlement. A correct application need do none of them, and may yet --
  so the engine cannot show the contradiction, and says what it rests on.

Consequences: the four adapters whose declarations gained `means` and `selects` have new fingerprints, so their
conformance receipts are recorded again on the real systems (`acceptance/kits/messaging.mjs`, `acceptance/kits/hooks.mjs`).
A project adapter that declares neither is held by none of this. The playbook's worked designs for occurrence-one-execution
and overlap-policy, which read a schedule's `due` after manual triggers alone, now move the clock first: a trigger
proves the handler, never the schedule.
