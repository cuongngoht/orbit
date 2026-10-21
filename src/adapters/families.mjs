// The FAMILIES of backend operation Orbit can ask for, as data (ADR 0035).
//
// A case and a generator only ever name a family operation -- `orbit.messaging.publish`,
// `orbit.scheduler.observe` -- with logical refs; WHICH adapter answers it is a binding,
// decided at run time from what the project was discovered to use and what each registered
// adapter declares it can do. So nothing here names a transport, a product or a protocol: a
// family is a kind of question, and an operation says which refs it binds, which effects an
// adapter may declare for it, which meanings its output may carry
// (src/topology/vocab.mjs MEANINGS) and which semantics fields an obligation may need of it.
//
// `selects` is false for an operation Orbit answers itself, with no transport to choose by
// (computing the occurrences an accepted schedule implies). `contractOnly` marks a family the
// model REPRESENTS from 0.1.0 but no adapter is published for yet: an obligation on one is a
// coverage gap with its reason, never dropped from the denominator (doc §5.6).

// The effects and bind kinds are leaf vocabulary (src/topology/vocab.mjs): a capability's own
// declaration and the grant rows read them too, and neither may import this file.
export { BIND_KINDS, BIND_KIND_IDS, EFFECTS, EFFECT_IDS, effectOf, mutatingEffect } from "../topology/vocab.mjs";

const op = (name, family, refs, effects, outputs, needs = []) => ({ op: name, capability: `orbit.${family}.${name}`, refs, effects, outputs, needs, selects: true });

export const FAMILIES = [
  { id: "http", doc: "synchronous HTTP interfaces", operations: [
    op("read", "http", ["endpoint", "identity", "schema"], ["read"], ["response.status", "response.headers", "response.body", "schema.valid", "elapsed.ms"]),
    op("write", "http", ["endpoint", "identity", "schema", "fixture"], ["write"], ["response.status", "response.headers", "response.body", "schema.valid", "elapsed.ms"]),
  ] },
  { id: "rpc", contractOnly: true, doc: "remote procedure calls bound by service, method and schema", operations: [
    op("call", "rpc", ["endpoint", "identity", "schema"], ["read", "write"], ["response.status", "response.body", "schema.valid", "elapsed.ms"]),
  ] },
  { id: "messaging", doc: "publication and observation on channels", operations: [
    op("publish", "messaging", ["channel", "identity", "fixture"], ["publish"], ["message.id", "settlement.outcome", "elapsed.ms"], ["publishAck"]),
    op("observe", "messaging", ["channel", "observer", "fixture"], ["create-resource", "read"], ["cursor.baseline", "observation.completeness"], ["observation"]),
  ] },
  { id: "job", doc: "work queues", operations: [
    op("enqueue", "job", ["queue", "identity", "fixture"], ["enqueue"], ["execution.ref", "elapsed.ms"]),
    op("observe", "job", ["queue", "observer"], ["read"], ["execution.ref", "execution.status", "execution.attempt", "cursor.through"]),
  ] },
  { id: "scheduler", doc: "the decisions a running scheduler makes", operations: [
    op("trigger", "scheduler", ["schedule", "occurrence", "fixture"], ["trigger"], ["execution.ref", "occurrence.id", "occurrence.scheduledFor"]),
    op("observe", "scheduler", ["schedule", "observer"], ["read"], ["occurrence.id", "occurrence.scheduledFor", "occurrence.decision", "execution.ref", "cursor.through"], ["decisionReceipts"]),
  ] },
  { id: "schedule", doc: "the occurrences an accepted schedule contract implies, computed by Orbit", operations: [
    { ...op("expect", "schedule", ["schedule"], ["none"], ["occurrence.id", "occurrence.scheduledFor"]), selects: false },
  ] },
  { id: "clock", doc: "an injected business clock", operations: [
    op("advance", "clock", ["clock", "fixture"], ["advance-clock"], ["clock.evaluatedThrough"], ["clockInjection"]),
  ] },
  { id: "workload", doc: "control of a workload the task owns", operations: [
    op("control", "workload", ["workload", "fixture"], ["control-workload"], ["execution.status"]),
  ] },
  { id: "worker", doc: "what a consumer or worker did with each delivery", operations: [
    op("observe", "worker", ["workload", "observer"], ["read"], ["message.id", "delivery.attempt", "settlement.outcome", "terminal.reason", "execution.ref", "cursor.through"]),
  ] },
  { id: "state", doc: "durable state read back below the interface", operations: [
    op("read", "state", ["state", "fixture"], ["read"], ["effect.count", "effect.value"]),
  ] },
  { id: "observe", doc: "waiting on an armed observer, bounded by a deadline", operations: [
    op("await", "observe", ["observer"], ["read", "consume"], ["message.id", "message.key", "message.correlation", "message.payload", "delivery.attempt", "settlement.outcome", "terminal.reason", "cursor.through", "observation.completeness", "observation.gaps"], ["observation"]),
  ] },
  { id: "fixture", doc: "namespaced resources a run owns", operations: [
    op("prepare", "fixture", ["fixture"], ["create-resource", "write"], ["fixture.namespace"]),
    op("cleanup", "fixture", ["fixture"], ["delete-resource"], ["fixture.cleanup"]),
  ] },
  { id: "identity", doc: "synthetic principals a run acts as", operations: [
    op("issue", "identity", ["identity", "fixture"], ["create-resource"], ["principal.claims"]),
  ] },
  { id: "batch", contractOnly: true, doc: "bounded runs over a selection", operations: [
    op("run", "batch", ["workload", "fixture"], ["trigger"], ["execution.ref", "execution.status"]),
  ] },
  { id: "stream", contractOnly: true, doc: "stateful processing of an unbounded stream", operations: [
    op("observe", "stream", ["channel", "observer"], ["read"], ["message.id", "cursor.through", "observation.completeness"]),
  ] },
  { id: "workflow", contractOnly: true, doc: "durable multi-step processes", operations: [
    op("signal", "workflow", ["workload", "identity", "fixture"], ["trigger"], ["execution.ref", "execution.status"]),
    op("observe", "workflow", ["workload", "observer"], ["read"], ["execution.ref", "execution.status", "execution.attempt"]),
  ] },
  { id: "webhook", contractOnly: true, doc: "callbacks received from outside", operations: [
    op("deliver", "webhook", ["endpoint", "identity", "fixture"], ["write"], ["response.status", "elapsed.ms"]),
  ] },
  { id: "file", contractOnly: true, doc: "objects and files a workload processes", operations: [
    op("put", "file", ["state", "fixture"], ["write"], ["effect.value"]),
  ] },
];

export const FAMILY_IDS = FAMILIES.map((f) => f.id);

export const familyOf = (id) => FAMILIES.find((f) => f.id === id) ?? null;
export const operationOf = (family, name) => familyOf(family)?.operations.find((o) => o.op === name) ?? null;

// Every family operation as the capability id a case names, with its family -- what the core
// capability rows are registered from (src/adapters/core.mjs).
export const OPERATIONS = FAMILIES.flatMap((f) => f.operations.map((o) => ({ ...o, family: f.id, contractOnly: Boolean(f.contractOnly) })));

export const operationFor = (capabilityId) => OPERATIONS.find((o) => o.capability === capabilityId) ?? null;
