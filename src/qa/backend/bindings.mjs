// What a backend test is BOUND to, as sidecar tables (doc §4.4, §5.7; ADR 0032, 0035).
//
// A test names logical refs; the engine binds each one, at prepare and again at dispatch, to the
// workload, the channel, the schedule, the clock and the observer the task's sandbox actually
// holds -- and these tables are what that binding RECORDS, so a result can always say which
// adapter at which version saw what, through which cursors. Almost every field is the engine's
// to stamp: a host proposes the workload it means and the kind of trigger, nothing else.
//
// Three attempt counters are kept apart on purpose (doc §4.4): a TEST attempt (the run), a
// DELIVERY attempt (how many times the channel gave a consumer one logical message) and a
// workflow or job attempt. And a broker's observation cursor is not an event-time watermark:
// `baseline`/`through` say where an observer read, never when the business events happened.
const text = (doc) => ({ type: "string", doc });
const texts = (doc) => ({ type: "array", items: { type: "string" }, doc });
const count = (doc) => ({ type: "integer", minimum: 0, doc });

export const TRIGGER_KINDS = ["interface", "schedule", "message", "manual", "none"];

export const WORKLOAD_FIELDS = {
  workloadRef: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$", doc: "The workload's alias in the system graph -- a logical name, never an address." },
  triggerKind: { enum: TRIGGER_KINDS, doc: "How it is made to run in this test: through an interface, a schedule, a message, by hand, or not at all." },
  workloadKinds: texts("Its kinds, from the graph's vocabulary (a component may run several)."),
  definitionDigest: text("The digest of the definition it was started from."),
  semanticsProfile: { type: "object", doc: "The resolved adapter, its version and fingerprint, and the semantics it declared -- what every conclusion about delivery rests on." },
  resourceRefs: texts("The channel, queue, schedule and store aliases it was bound to."),
  dependencyRefs: texts("What it needs running beside it, from the dependency closure."),
};

export const MESSAGE_FIELDS = {
  messageId: text("The logical message identity, stable across deliveries and duplicate publications."),
  correlationId: text("The correlation scope it travels in."),
  causationId: text("What caused it: an outbox record, an occurrence, another message."),
  deliveryAttempt: count("Which delivery this was -- a transport counter, never a test attempt."),
  schemaDigest: text("The digest of the message contract it was checked against."),
  key: text("The routing or partition key, when the contract has one."),
  businessKey: text("The business operation key a consumer must be idempotent by."),
};

export const SCHEDULE_FIELDS = {
  occurrenceId: text("The planned period and schedule revision -- kept by a retry, which gets a new execution attempt instead."),
  scheduledFor: text("The business time the occurrence was planned for, with its offset. Never the time a worker happened to start."),
  timezone: text("The zone the schedule is evaluated in."),
  clockRef: text("The clock the decision loop read: an injected one, by alias, or real time."),
  revision: text("The schedule definition's revision."),
};

export const OBSERVATION_FIELDS = {
  observerSession: text("The observer session that watched, by its receipt."),
  baseline: text("Where the observer stood before the trigger."),
  through: text("How far it had read when the observation closed."),
  window: { type: "object", doc: "The accepted observation window: opened, closed, and what closed it (a deadline, a barrier, a terminal state)." },
  completeness: { enum: ["complete", "partial", "unknown"], doc: "Whether the observation saw everything its window promised. Only complete may conclude an absence." },
  health: { enum: ["healthy", "degraded", "lost"], doc: "Whether the observer stayed armed for the whole window." },
  gaps: texts("What it could not see, and why."),
  truncated: { type: "boolean", doc: "Whether a bound cut what it kept." },
  effectRefs: texts("The read-backs that saw the durable effects."),
};

export const TEMPORAL_FIELDS = {
  clockRef: text("The clock the deadline is measured on -- a business clock is never Orbit's own budget, which is monotonic."),
  scheduledFor: text("The planned business time, when a schedule is involved."),
  occurrenceId: text("The occurrence it is about."),
  deadline: { type: "integer", minimum: 1, doc: "Seconds the accepted contract allows for completion. Absent when no accepted source states one: then an expired budget is INCONCLUSIVE, never a contradiction." },
  deadlineRef: text("The binding the deadline came from."),
  baselineCursor: text("Where observation started."),
  throughCursor: text("Where it ended."),
  completeness: { enum: ["complete", "partial", "unknown"], doc: "What the observation could promise about the window." },
};

// The definitions, with what a HOST may propose: everything else is stamped by the engine and
// refused by name when a proposal carries it (src/qa/obligations/validate.mjs).
export const BACKEND_DEFINITIONS = {
  workload: { table: WORKLOAD_FIELDS, required: ["workloadRef"], stamped: ["workloadKinds", "definitionDigest", "semanticsProfile", "resourceRefs", "dependencyRefs"] },
  message: { table: MESSAGE_FIELDS, required: ["messageId"], stamped: Object.keys(MESSAGE_FIELDS), proposable: false },
  schedule: { table: SCHEDULE_FIELDS, required: ["occurrenceId", "scheduledFor"], stamped: Object.keys(SCHEDULE_FIELDS), proposable: false },
  observation: { table: OBSERVATION_FIELDS, required: ["observerSession", "completeness"], stamped: Object.keys(OBSERVATION_FIELDS), proposable: false },
  temporal: { table: TEMPORAL_FIELDS, required: [], stamped: Object.keys(TEMPORAL_FIELDS), proposable: false },
};
