// The orbit-backend-test PACK's capabilities (ADR 0034, 0035; doc §5.3-§5.7): every backend
// family operation a case may call -- orbit.messaging.publish, orbit.observe.await,
// orbit.scheduler.trigger, orbit.fixture.cleanup ... -- behind the one `call` verb, and the one
// operation Orbit answers itself, orbit.schedule.expect.
//
// A family capability knows no transport. Its rows come from the engine's family table
// (src/adapters/core.mjs): it binds logical refs, carries the operation's own parameters in
// `request`, and asks the ADAPTER its bound resource resolves to -- this pack's AMQP reference
// adapter (adapters.json), or any adapter a project registers for its own broker, scheduler or
// queue. A transport nothing serves is a named gap, never a fallback.
//
// orbit.schedule.expect computes, from the accepted schedule contract the run bound
// (`scheduleRef`), the occurrences it implies -- which are due, which were missed and what the
// misfire policy does with them -- through schedule/helper.mjs. It asks no scheduler: a
// scheduler's own decisions are orbit.scheduler.observe's.
import { familyCapabilities } from "../../src/adapters/core.mjs";

const expect = {
  id: "orbit.schedule.expect",
  apiVersion: "orbit.capability/v1",
  doc: "compute the occurrences an accepted schedule contract implies -- in a window, due by an evaluation point, or missed since a last run",
  page: false,
  inputSchema: {
    scheduleRef: { type: "string", bind: "schedule", doc: "The accepted schedule contract, by its alias: expression, dialect, timezone and revision as the run pinned them." },
    request: { type: "object", doc: "{ ask: occurrences | due | missed } and its instants (ISO 8601 with an offset, or epoch milliseconds): from/to, evaluatedThrough/since, lastRun/now; limit." },
  },
  required: ["scheduleRef", "request"],
  effects: ["none"],
  outputs: {
    occurrences: { each: { occurrenceId: "occurrence.id", scheduledFor: "occurrence.scheduledFor", state: "occurrence.decision" } },
    fire: { each: { occurrenceId: "occurrence.id", scheduledFor: "occurrence.scheduledFor" } },
    skip: { each: { occurrenceId: "occurrence.id", scheduledFor: "occurrence.scheduledFor", reason: "occurrence.decision" } },
    unknowns: "observation.gaps",
  },
  helper: { argv: ["schedule/helper.mjs"], runIn: "host" },
  invoke: (ext, input) => ext.helper.run("expect", input.request),
};

export default [...familyCapabilities(), expect];
