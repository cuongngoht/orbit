// The STRUCTURAL ROLES a system graph is made of -- the only words about a backend that src/
// may know (ADR 0033).
//
// A leaf, read by architecture (which records node and relation facts), by qa (which derives
// obligations over them) and by the adapters (whose outputs carry meanings). Every NAME a
// project uses -- a kind of workload, a kind of channel, a relation like `publishes-to` -- is a
// vocabulary ROW in catalog/topology.json, an organisation's or a project's own file
// (src/topology/vocabulary.mjs), and it means what its row's ROLE says. A role is what the
// engine reasons with; a name is data. So nothing here can mention a broker, a scheduler or a
// database: "a channel a workload publishes to" is the whole of what the engine needs to know
// to owe a test that a publication is observed, whatever the product behind it is called.

export const NODE_ROLES = [
  { id: "component", doc: "a deployable unit of the system under test: one codebase, process or service" },
  { id: "workload", doc: "something a component RUNS: a handler, a scheduler, a job, a producer, a consumer, a worker, a processor, a workflow" },
  { id: "interface", doc: "a way in: an endpoint, an operation, a page" },
  { id: "principal", doc: "a class of identity something acts as or is acted on by" },
  { id: "data-resource", doc: "where state lives: a store, a table, a cache, an object prefix" },
  { id: "channel", doc: "where messages travel: a topic, a queue, an exchange, a subscription, a group, a partition, a retry or dead-letter channel" },
  { id: "schedule", doc: "a declared timetable and the executions it decides" },
  { id: "cursor", doc: "a position somebody keeps in a stream: an offset, a sequence, a checkpoint" },
  { id: "external", doc: "a dependency or a sink outside the system under test" },
  { id: "boundary", doc: "a trust boundary: identity, tenant, network or process" },
];

// What an edge MEANS, with the roles allowed at each end. A relation row in a vocabulary names
// one of these; one that names none is legal, kept and shown, and derives nothing.
export const RELATION_ROLES = [
  { id: "invocation", from: ["component", "workload", "interface"], to: ["interface", "workload", "external"], doc: "one side asks the other synchronously" },
  { id: "data-read", from: ["component", "workload", "interface"], to: ["data-resource"], doc: "reads state" },
  { id: "data-write", from: ["component", "workload", "interface"], to: ["data-resource"], doc: "changes state" },
  { id: "identity", from: ["interface", "workload", "component"], to: ["principal", "external"], doc: "establishes who is asking" },
  { id: "permission", from: ["principal"], to: ["interface", "data-resource", "channel", "workload"], doc: "is allowed to act on" },
  { id: "boundary-crossing", from: ["component", "workload", "interface", "channel"], to: ["boundary"], doc: "crosses a trust boundary" },
  { id: "time", from: ["schedule"], to: ["workload"], doc: "decides when a workload runs" },
  { id: "activation", from: ["schedule", "workload", "interface"], to: ["workload"], doc: "starts another workload" },
  { id: "publish", from: ["workload", "component", "interface"], to: ["channel"], doc: "sends messages to a channel" },
  { id: "consume", from: ["workload", "component"], to: ["channel"], doc: "receives messages from a channel" },
  { id: "route", from: ["channel"], to: ["channel"], doc: "a channel delivers on into another" },
  { id: "retry", from: ["channel", "workload"], to: ["channel"], doc: "a failed delivery is tried again through" },
  { id: "terminal", from: ["channel", "workload"], to: ["channel", "data-resource"], doc: "a delivery that cannot succeed ends in" },
  { id: "progress", from: ["workload"], to: ["cursor"], doc: "records how far it got in" },
  { id: "compensation", from: ["workload"], to: ["workload"], doc: "undoes the effect of" },
];

// What an OBSERVED value means, whoever observed it. An adapter's output field declares one of
// these (`means`), a structured criterion states an expectation over one, and a compiled
// assertion reads the field whose meaning matches -- so an assertion never names a provider's
// field. `layer` is the DSL layer a call observing it proves (src/dsl/registry.mjs LAYERS):
// the interface it was read at, or the data below it. A meaning with no layer is ABOUT the
// observation (its completeness, its cursor) and proves nothing by itself.
export const MEANINGS = [
  { id: "response.status", layer: "api", doc: "the status a synchronous interface answered" },
  { id: "response.headers", layer: "api", doc: "the allow-listed headers it answered with" },
  { id: "response.body", layer: "api", doc: "the projected body it answered with" },
  { id: "schema.valid", layer: "api", doc: "whether a body conforms to a pinned schema" },
  { id: "principal.claims", layer: "api", doc: "the claims of the identity an interface saw" },
  { id: "message.id", layer: "api", doc: "the logical identity of a message, stable across deliveries" },
  { id: "message.key", layer: "api", doc: "the routing or partition key a message carried" },
  { id: "message.correlation", layer: "api", doc: "the correlation and causation a message carried" },
  { id: "message.payload", layer: "api", doc: "the projected payload of a message" },
  { id: "delivery.attempt", layer: "api", doc: "which delivery of a message this was" },
  { id: "settlement.outcome", layer: "api", doc: "how a publication or a delivery was settled: confirmed, rejected, acknowledged, dead-lettered" },
  { id: "terminal.reason", layer: "api", doc: "why a delivery ended where it did" },
  { id: "occurrence.id", layer: "api", doc: "the planned period a schedule decided, with its revision" },
  { id: "occurrence.scheduledFor", layer: "api", doc: "the business time an occurrence was planned for" },
  { id: "occurrence.decision", layer: "api", doc: "what a schedule decided at an evaluation: due, not due, missed, skipped" },
  { id: "execution.ref", layer: "api", doc: "a job, workflow or consumer execution a workload reported" },
  { id: "execution.status", layer: "api", doc: "how that execution stands" },
  { id: "execution.attempt", layer: "api", doc: "which attempt of that execution" },
  { id: "effect.count", layer: "sql", countOf: "effect.value", doc: "how many durable effects a read-back found -- or, where only the effects are answered, how many of them there are" },
  { id: "effect.value", layer: "sql", doc: "the value a durable effect holds" },
  { id: "clock.evaluatedThrough", layer: null, doc: "the business time an injected clock has been evaluated through" },
  { id: "cursor.baseline", layer: null, doc: "where an observer stood before the trigger" },
  { id: "cursor.through", layer: null, doc: "how far an observer has read" },
  { id: "observation.completeness", layer: null, doc: "whether an observation saw everything its window promised" },
  { id: "observation.gaps", layer: null, doc: "what an observation could not see" },
  { id: "fixture.namespace", layer: null, doc: "the namespace a fixture was prepared in" },
  { id: "fixture.cleanup", layer: null, doc: "what a cleanup removed, and what it could not" },
  { id: "elapsed.ms", layer: null, doc: "how long an operation took, by a monotonic clock" },
];

// The BOUNDARY a result is allowed to claim, and the meanings that can prove it. A publication
// receipt proves publication and never processing; a read-back proves state and never that a
// message was delivered -- coverage is never summed from one receipt (doc §5.9).
export const BOUNDARIES = [
  { id: "synchronous", provedBy: ["response.status", "response.body", "schema.valid"], doc: "what a synchronous interface answered" },
  { id: "publication", provedBy: ["message.id", "settlement.outcome"], doc: "a message was accepted by the channel" },
  { id: "delivery", provedBy: ["delivery.attempt"], doc: "a message reached a consumer" },
  { id: "processing", provedBy: ["execution.status", "settlement.outcome", "terminal.reason"], doc: "a consumer or a job finished with it" },
  { id: "state", provedBy: ["effect.count", "effect.value"], doc: "the durable effect is there, read back below the interface" },
  { id: "scheduler-timing", provedBy: ["occurrence.id", "occurrence.decision", "occurrence.scheduledFor"], doc: "a schedule decided the right occurrence at the right time" },
  { id: "chain", provedBy: [], doc: "every boundary along one lineage, each proved by its own evidence" },
];

// What an operation can DO to the world. `mutates` is the column the grant rows read
// (the grant rows, src/runtime/sandbox/test-grants.mjs): an observation that takes a message is `consume`,
// a mutation however it is named (doc §5.7).
export const EFFECTS = [
  { id: "none", mutates: false, doc: "computes, asks nothing of the system under test" },
  { id: "read", mutates: false, doc: "reads without changing anything anybody else can see" },
  { id: "write", mutates: true, doc: "changes durable state" },
  { id: "publish", mutates: true, doc: "sends a message" },
  { id: "enqueue", mutates: true, doc: "puts a job on a queue" },
  { id: "trigger", mutates: true, doc: "makes a workload run now" },
  { id: "consume", mutates: true, doc: "reserves or takes a message -- allowed only on a resource the fixture owns" },
  { id: "settle", mutates: true, doc: "acknowledges, rejects, commits or completes a delivery" },
  { id: "create-resource", mutates: true, doc: "creates a channel, a subscription, a group or a namespace" },
  { id: "delete-resource", mutates: true, doc: "removes a resource the fixture owns" },
  { id: "advance-clock", mutates: true, doc: "moves an injected business clock" },
  { id: "control-workload", mutates: true, doc: "stops, starts, restarts or faults a workload" },
  { id: "replay", mutates: true, doc: "delivers stored messages again, over a bounded range" },
];

// The kinds of logical ref an operation binds. A ref is an ALIAS the binding resolves through
// Runtime and the fixture; a URL, an address, a credential or a shell line is never one.
export const BIND_KINDS = [
  { id: "endpoint", doc: "a synchronous interface of a component the task started" },
  { id: "identity", doc: "an approved synthetic principal" },
  { id: "channel", doc: "a channel the accepted contract names" },
  { id: "queue", doc: "a work queue" },
  { id: "schedule", doc: "a declared schedule" },
  { id: "occurrence", doc: "one planned period of a schedule" },
  { id: "clock", doc: "an injected business clock" },
  { id: "workload", doc: "a workload the task's sandbox runs" },
  { id: "state", doc: "a store the fixture may read back" },
  { id: "observer", doc: "an observer session armed before a trigger" },
  { id: "fixture", doc: "a fixture namespace of this run" },
  { id: "schema", doc: "a pinned schema document" },
];

const ids = (rows) => rows.map((r) => r.id);

export const NODE_ROLE_IDS = ids(NODE_ROLES);
export const RELATION_ROLE_IDS = ids(RELATION_ROLES);
export const MEANING_IDS = ids(MEANINGS);
export const BOUNDARY_IDS = ids(BOUNDARIES);
export const EFFECT_IDS = ids(EFFECTS);
export const BIND_KIND_IDS = ids(BIND_KINDS);

export const effectOf = (id) => EFFECTS.find((e) => e.id === id) ?? null;
export const mutatingEffect = (id) => effectOf(id)?.mutates === true;

export const meaningOf = (id) => MEANINGS.find((m) => m.id === id) ?? null;
export const boundaryOf = (id) => BOUNDARIES.find((b) => b.id === id) ?? null;
export const relationRoleOf = (id) => RELATION_ROLES.find((r) => r.id === id) ?? null;

// A meaning may be named with a sub-path -- `response.body.id` is the `id` field of the
// response body -- so the meaning is its longest known prefix.
export const meaningAt = (path) => MEANINGS.filter((m) => path === m.id || String(path).startsWith(`${m.id}.`)).sort((a, b) => b.id.length - a.id.length)[0] ?? null;

// What an OUTPUTS map declares, flat: each field and the meaning it carries, or -- for a list --
// each item's fields, as `field[].item` (`{ messages: { each: { id: "message.id" } } }`). A
// capability and an adapter declare outputs the same way, so they are read the same way.
export const meaningEntries = (outputs, prefix = "") => Object.entries(isTable(outputs) ? outputs : {}).flatMap(([field, means]) => (isTable(means) && isTable(means.each) ? meaningEntries(means.each, `${prefix}${field}[].`) : [[`${prefix}${field}`, means]]));

const isTable = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
