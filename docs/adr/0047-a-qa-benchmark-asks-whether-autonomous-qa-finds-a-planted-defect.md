# ADR 0047 — A QA benchmark asks whether Orbit's autonomous QA finds a planted defect, and credits only what the clean application refutes

## Status

Accepted (development tooling; no engine contract changes). Extends ADR 0046 (the Docker benchmark). Builds on
ADR 0037 (a test writes only through a grant), ADR 0038 (an active generated test runs only where isolation is proven)
and ADR 0039 (a sandbox's topology is composed from declarations).

## Context

1. Orbit's native acceptance (`acceptance/run.mjs`) already takes a synthetic application through the whole QA loop
   on an isolated sandbox. Each stack has variants that plant one defect in the application's tree, and a ground
   truth says what every generated test must come to. But the host's side of that loop is SCRIPTED: the designs are
   written ahead of time. Nothing measured whether a real coding host, working Orbit's autonomous QA, finds what was
   planted.
2. A generated test runs only where isolation is proven, so the investigation's engine needs Docker. The benchmark
   gives no container a Docker socket (ADR 0046), and a coding host runs in a container.
3. The planted variants are labelled branches in the application's source, so any host that reads that source learns
   the defects by name.
4. A QA that contradicts everything would "find" every planted defect. A contradiction proves a defect only when the
   same test does not contradict the application without it.

## Decision

### A QA case is data, of a kind of its own

`case.json` takes `kind: "qa"` and a `target`:

- the application, a name the harness knows (`lib/qa/invoice.mjs`, Orbit's own acceptance application);
- its stack, the variant planted, and the variant with nothing planted;
- the accepted plan the investigation is held to, and its mode;
- the globs the host's plugin never carries.

Its ground truth (`verifier/truth.json`) is acceptance's own row for that stack and variant, and a test holds it there.
Every QA case on one application is asked the same request, which names no variant and no test shape.

### The engine runs beside the controller; the host reaches it through a relay

The application is assembled from the run's frozen copy with the variant planted. Orbit's own engine, from the frozen
checkout and in a store of the run's own, then does what acceptance does once, in the way a person does it in Orbit
Control:

- seats the project and records its system graph;
- enables autonomous QA with its tenancy contract;
- sets the sandbox policy: isolation required, the QA worker image, and the writes a test may make on its own fixture;
- trusts each fingerprint the sandbox asks to be trusted;
- prepares and starts the task's isolated sandbox, and opens ONE investigation on it.

The coding host runs in the runner container, as in a repair round. Its plugin's `cli/autonomous-qa.mjs` is a relay
client. The relay is two directories: requests the runner writes, and answers it can only read. The controller serves
them through the engine one at a time, held to a table (`RELAY`):

- the subcommands an investigation's host uses, about the run's own investigation and no other;
- a decision or a plan on stdin, and never a path;
- a person's approvals, a second investigation and an environment's browser are refused by name.

A request that is not a regular file is removed unread. The log keeps a decision's digest, never the decision: the
engine's journal keeps that.

So the host decides, and the engine executes inside its own gates, exactly as for any Orbit user. The isolation is the
sandbox's, and no container is ever handed the Docker socket.

### The host sees what a black-box tester sees

The runner is handed:

- the plugin, without the case's withheld paths. Those are the ground truth, the reference designs, and the one test
  that names a variant. Every case withholds the same set, so what is missing says nothing of what is planted;
- the application's accepted requirement, its contracts and its accepted plan;
- the investigation's id.

It never gets the application's source, and it cannot reach the application: every test it designs runs in the
sandbox, through the engine.

### Found means refuted by the clean application

What the investigation came to is read off the engine's journal: each test shape's latest verification, which the
engine decided from its own check of the worker's envelope. Nothing a host or a worker says is evidence.

Each design that contradicted the planted application is replayed on the clean one: the same design, in a sandbox and
an investigation of its own. Each shape then earns one credit:

| Credit | When |
|---|---|
| DETECTED | the clean application satisfies the design |
| FALSE_ALARM | the clean application contradicts it too, or the planted application IS the clean one |
| UNCONFIRMED | the clean application's run did not settle |
| MISSED | a planted shape was never contradicted |
| BLOCKED | the environment kept the test from running; this is neither coverage nor a miss |

The verdict is an ordered table:

1. BLOCKED when the environment kept a planted defect's test from running.
2. FAIL on a false alarm.
3. FAIL on a defect missed.
4. FAIL when coverage is under the case's minimum.
5. INCONCLUSIVE on an unconfirmed contradiction.
6. PASS otherwise.

A contradiction the ground truth does not list, but that the clean application refutes, is reported as found beyond
the truth.

### The verifier is proved without a model

Each QA case's controls run it with a scripted host, through the same relay admission, engine and judge:

| Host | Does | Must earn |
|---|---|---|
| reference | acceptance's own designs, for every test obligation the engine owes | PASS |
| idle | tests nothing | FAIL |
| false-alarm | the reference designs, one of them reading back a record nothing writes | FAIL |

### A run is still one Orbit task

As for a source run, the run is one task written through `cli/task.mjs`, in four phases:

| Stage | Phase |
|---|---|
| `ENVIRONMENT` | target |
| `TESTING` | the host's round |
| `REVIEWING` | the read-back |
| `REGRESSION` | the confirmation |

`resume` reads the run's place off the task's journal. The setup and the confirmation are done again; the host's
round is never sent again, and what it left is read back. A sandbox that never came up is released and blocks the run.
The sentinel looks for the sandbox's per-run tokens beside the coding host's credential.

## Consequences

- `node benchmark/run.mjs run <ORBIT-QA-…>` measures a coding host's QA, and `controls <ORBIT-QA-…>` proves the
  verifier, live, with no model.
- The QA worker image starts from the official Playwright image, pinned by digest. It installs the pinned browser CLI,
  and links the Chromium revision the CLI names to the one the image ships. It builds on a network that reaches only a
  registry.
- A new application becomes a QA target by naming it in `TARGETS`, with what a person sets up for it. That is no
  general framework: an application earns a row when a case needs it.
- The engine running beside the controller acts on a host's decisions with the run's own store and Docker, within its
  own gates. A host can reach nothing else of the controller's machine: no path crosses the relay, and no subcommand
  outside the table runs.
