# ADR 0036 — Bounded helpers and bindings behind a synchronous call; long-lived work is supervised

## Status

Proposed (0.1.0). Extends ADR 0014 (sandbox) and ADR 0020 (an observed check).

## Context

1. **An async capability passes by accident.** `invokeCapability` is synchronous and imports the capability in-process
   (`src/capability/invoke.mjs:32-44,101-104`). The facade's only way to a child process is `process.run`, a spawnSync
   (`src/extensions/context-v1.mjs:44-52`, `src/process/index.mjs:103-108`). An `async invoke` returns a Promise; the
   log records it as `{}`, and `expect: "Boolean(it)"` passes on it. That is a PASS nobody earned.
2. **The run budget never reaches a child.** `remainingMs` (`src/run/budget.mjs:31`) has no caller.
3. **Backend work is asynchronous, and some of it outlives a call.** A publish, a wait for delivery and a scheduler's
   decision are asynchronous. An observer, a worker and a broker need a process that outlives one call. Meanwhile
   `ranCase` is a 30-minute spawnSync (`cli/autonomous-qa.mjs:138-142`), during which nothing can cancel, pause or show
   progress.
4. **Inputs and outputs are unguarded.** run-case binds no connection, and a capability's whole return value is recorded
   in `run-log.jsonl` unscrubbed.

## Decision

- **The runner stays synchronous; a thenable is BLOCKED.** `invoke.mjs` refuses a returned thenable, and the registry
  refuses an `AsyncFunction` invoke at registration, naming the capability.
- **A helper is the one way out of the process for an asynchronous operation.**
  - It lives in `src/capability/helper.mjs` and appears as the facade surface `helper.run(op, request)`. The surface
    exists only when the composition root bound helpers, and only for a capability that declares `helper`.
  - Request, on stdin: `{v: "orbit.helper/v1", op, request, bound, limits, deadlineMs}`.
  - Answer: exactly one JSON line, within `answerBytes`.
  - Error classes, each typed into Blocked or Refused: transport, protocol, timeout, incomplete, ambiguous, refused.
    Anything else is an EXECUTION_ERROR.
  - The timeout is the smallest of the declared limit, the policy and `remainingMs`. When the run deadline is what
    clipped it, the answer says so.
- **Bindings are a gate.**
  - An `inputSchema` row may say `bind:` with one of the `BIND_KINDS` (`src/adapters/families.mjs`): endpoint,
    identity, channel, queue, schedule, occurrence, clock, workload, state, observer, fixture, schema.
  - A `binding` row in `GATES` resolves each logical ref through `ctx.bindings.resolve`, a port with a fake. Gate
    order: input → binding → mutation → tools → connection. With nothing bound, the step is BLOCKED.
  - Non-secret bound values travel in the request; a secret only in the child's environment. Neither ever appears in
    argv or a log.
- **An answer is projected before it is logged.** A provider returns its family's allow-listed output, as scrubbed,
  bounded values, and its `gaps` are recorded.
- **Asynchronous operations return references.**
  - A publish returns a message reference and a publication receipt.
  - `orbit.observe.await` reads an observer's output from a baseline cursor to a through cursor, against a compiled
    condition and a deadline. It returns the observations, both cursors and the completeness.
- **Long-lived work is a Runtime session.** Each session has a `kind` (component, service, observer, worker or
  supervisor), and ownership gains container rows.
- **The supervisor** (`src/runtime/sandbox/supervise.mjs`, `cli/sandbox-supervisor.mjs`):
  - is launched with a receipt, one per sandbox and verification session, locked, with a hard lifetime;
  - writes heartbeats;
  - takes signals from the composition roots that already own cancel;
  - enforces deadlines and budgets;
  - stops only sessions whose ownership is proven;
  - launches nothing and knows no transport.
- **Only the investigation step awaits.** `ranCase` runs the worker attached, through `runObserved`. A spent deadline
  stops the worker by its receipt.

## Consequences

- The pipeline stays synchronous in 0.1.0; making it asynchronous needs its own ADR and regression evidence.
- `test/fakes/process.mjs` gains `start`, and helpers and bindings get fakes of their own.
