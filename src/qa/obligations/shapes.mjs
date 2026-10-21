// The SHAPES a test obligation can take, as data (doc §5; ADR 0031).
//
// An obligation is derived where three things meet: what an ACCEPTED contract says (a property
// it states -- an expected response, a uniqueness key, a deadline, a schedule), a graph
// RELATION the property is about (a workload consuming from a channel, a schedule deciding
// when a workload runs), and -- for what only a running system can show -- the SEMANTICS the
// resolved adapter declares. A shape names all three, the controls a verdict needs (a negative
// result proves nothing without its positive control), the one boundary it may claim, and the
// assertion templates (src/qa/generation/compile.mjs) its slots are compiled from.
//
// Nothing here names a product, a table, a status code or a schedule: "exactly one durable
// effect per business key under redelivery" is the same obligation on any broker, and which
// key, which store and which deadline are the accepted contract's words, through bindings.
// A contract that states no property a shape needs leaves a `missingCriterion` and a question,
// never a default; a shape whose semantics are UNKNOWN on the bound adapter is a gap that
// says what would settle it. `contractOnly` shapes are represented from 0.1.0 and counted in
// the denominator; they stay gaps until an adapter and an oracle exist (doc §5.6).

const shape = (id, boundary, relations, contract, controls, templates, doc, extra = {}) => ({ id, boundary, relations, contract, controls, templates, semantics: {}, doc, ...extra });

export const OBLIGATION_SHAPES = [
  shape("response-conforms", "synchronous", ["invocation"], ["response"], ["positive"], ["value-eq", "value-in", "schema-valid"], "an interface answers what its accepted contract says: status, body, schema and error semantics"),
  shape("permission-enforced", "synchronous", ["permission"], ["permission"], ["positive", "negative"], ["value-eq", "value-excludes"], "an actor without the right is refused, and the allowed actor is not -- one without the other proves nothing"),
  shape("no-foreign-effect", "state", ["permission", "data-write", "data-read"], ["tenant-scope"], ["positive", "negative", "state"], ["count-eq", "value-excludes", "absent-within"], "nothing of another owner or tenant is read or changed, within the accepted window"),
  shape("persisted-after-write", "state", ["data-write"], ["effect"], ["positive", "state"], ["count-eq", "value-eq"], "a write the interface accepted is there below it, read back"),
  shape("idempotent-under-repeat", "state", ["data-write"], ["idempotency"], ["duplicate", "state"], ["count-eq"], "a second request with the same idempotency key, on purpose, leaves one persisted effect"),
  shape("publication-routed", "publication", ["publish", "route"], ["message-contract"], ["positive"], ["value-eq", "complete"], "a publication reaches the channels its contract routes it to, with its identity and schema", { semantics: { observation: ["shadow-subscription", "independent-cursor", "peek-cursor", "read-only-query", "tap"] } }),
  shape("effect-once-per-key", "state", ["consume", "data-write"], ["unique-by"], ["duplicate", "state"], ["count-eq"], "a redelivered or duplicated message leaves exactly one durable effect per business key", { semantics: { delivery: ["at-least-once", "effectively-once-within-window"] } }),
  shape("crash-before-effect", "state", ["consume", "data-write"], ["effect"], ["fault", "state"], ["count-eq"], "a consumer that stops before its effect loses nothing: the message comes back and the effect happens once", { semantics: { redeliveryTriggers: ["crash-before-settle", "connection-loss", "lock-expiry", "visibility-timeout", "ack-wait"] } }),
  shape("crash-after-effect-before-ack", "state", ["consume", "data-write"], ["unique-by"], ["fault", "state"], ["count-eq"], "a consumer that stops after its effect and before it settled does not do it twice", { semantics: { redeliveryTriggers: ["crash-before-settle", "connection-loss", "lock-expiry", "visibility-timeout", "ack-wait"] } }),
  shape("competing-workers", "state", ["consume"], ["unique-by"], ["duplicate", "state"], ["count-eq"], "two workers that receive one job leave one effect"),
  shape("lease-expiry-fencing", "state", ["consume"], ["unique-by"], ["fault", "state"], ["count-eq", "count-at-most"], "a worker whose lease expired cannot leave an effect the contract forbids", { semantics: { redeliveryTriggers: ["lock-expiry", "visibility-timeout", "ack-wait"] } }),
  shape("terminal-after-retries", "processing", ["consume", "retry", "terminal"], ["retry-policy"], ["fault"], ["count-eq", "value-eq"], "a message that cannot succeed is retried as the policy says and ends where it says, linked to the original", { semantics: { deadLetter: ["broker-routed", "broker-subqueue", "advisory", "app-managed"] } }),
  shape("ordered-transitions", "state", ["consume"], ["ordering"], ["positive"], ["order-eq"], "state moves in the order the contract requires, within the scope it states", { semantics: { orderingScope: ["key", "partition", "session", "group", "queue", "stream"] } }),
  shape("completes-by-deadline", "processing", ["consume", "activation"], ["deadline"], ["positive"], ["complete"], "the business condition holds by the accepted deadline -- measured on observation that stayed complete"),
  shape("outbox-atomic", "chain", ["data-write", "publish"], ["outbox"], ["fault", "state"], ["count-eq"], "the business write and its outgoing message commit together, and a relay restart loses neither"),
  shape("occurrence-one-execution", "scheduler-timing", ["time"], ["schedule"], ["positive"], ["count-eq", "value-eq"], "a due occurrence produces one execution, attributed to that occurrence", { semantics: { decisionReceipts: ["cursor"] } }),
  shape("not-before-due", "scheduler-timing", ["time"], ["schedule"], ["negative"], ["absent-within"], "nothing of an occurrence runs before it is due", { semantics: { decisionReceipts: ["cursor"] } }),
  shape("missed-occurrence-policy", "scheduler-timing", ["time"], ["misfire"], ["fault"], ["count-eq"], "an occurrence missed while the scheduler was down is caught up, skipped or bounded as the policy says"),
  shape("overlap-policy", "scheduler-timing", ["time"], ["overlap"], ["duplicate"], ["count-at-most"], "an occurrence due while the last one still runs is allowed, refused or replaced as the policy says"),
  shape("zone-and-calendar", "scheduler-timing", ["time"], ["timezone"], ["positive"], ["value-eq"], "occurrences fall where the zone, the calendar and the declared daylight-saving policy put them"),
  shape("batch-partial-failure", "processing", ["activation", "data-write"], ["batch-contract"], ["fault", "state"], ["count-eq"], "a batch that fails part way says which records, and a rerun is idempotent per period", { contractOnly: true, family: "batch" }),
  shape("stream-late-events", "processing", ["consume", "progress"], ["window-contract"], ["positive"], ["value-eq"], "events late beyond the watermark are handled as the window contract says", { contractOnly: true, family: "stream" }),
  shape("workflow-compensation", "chain", ["activation", "compensation"], ["workflow-contract"], ["fault", "state"], ["value-eq"], "a workflow that fails after completed steps compensates them as the contract says", { contractOnly: true, family: "workflow" }),
  shape("webhook-authenticity", "synchronous", ["invocation", "identity"], ["signature-contract"], ["positive", "negative", "duplicate"], ["value-eq"], "a callback without a valid signature, or a replay, is refused; a duplicate is idempotent", { contractOnly: true, family: "webhook" }),
  shape("file-integrity", "state", ["data-write"], ["file-contract"], ["positive", "fault"], ["value-eq"], "an object is processed once per identity and version, never from a partial upload", { contractOnly: true, family: "file" }),
];

export const SHAPE_IDS = OBLIGATION_SHAPES.map((s) => s.id);

export const shapeOf = (id) => OBLIGATION_SHAPES.find((s) => s.id === id) ?? null;
