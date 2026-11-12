// ONE MODEL of what a design causes (0.6.0): what each of its steps does to the system and what each reads of it, from
// declarations only -- so every rule that holds a design to what a correct application can meet (contradictions.mjs) is a
// selection over one reading, never a list of operation ids or shapes of its own.
//
//   effects    what the step's family operation may do (src/adapters/families.mjs `effects`, the leaf vocabulary's EFFECTS)
//   on         the logical references it acts on or reads, by bind kind -- a channel, a queue, a schedule, a workload --
//              never the identity it acts as, the fixture it is namespaced in, a schema or an observer session
//   arms       the observer session it ARMS (an operation that binds an observer and creates a resource)
//   reads      the observer session it READS (one that binds an observer it does not create)
//   sets       what its request SETS of what it sends: each field holding a literal whose request row says which meaning
//              it is (`means`, orbit.adapter/v1) -- the field a publication puts on the message, the occurrence a trigger
//              names, the instant a clock is moved to
//   pins       what its request's match PINS: each match field holding a literal whose row says what it is compared with,
//              beside what the match picks (`selects`: the answer, or the count that ends the wait)
//   routes     whether it names a field that routes what it sends elsewhere (one meaning `message.key`)
//   semantics  how the system behind its answering adapter behaves, as that adapter declares (catalog/semantics.json)
//
// and, beside each step, the assertions that rule on it with the accepted expectation each names (`ruled`). A field
// whose row says nothing, a value a binding fills, an adapter that declares nothing: unknown, and unknown is never a
// refusal -- a rule reads only what is there. Nothing here names a family operation or a shape: an effect, a bind kind,
// a meaning and a semantics field are the vocabulary's words.
import { OPERATIONS } from "../../adapters/families.mjs";
import { effectOf, meaningOf } from "../../topology/vocab.mjs";
import { EXPECT_OP } from "../vocab.mjs";
import { actionsWhere, requestOf, stepsOf } from "./skeleton.mjs";

export const literal = (v) => typeof v === "string" && v.length > 0 && !v.includes("${");
export const isTable = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// The bind kinds a step acts as or within, never what it acts ON (src/topology/vocab.mjs BIND_KINDS).
const AS = ["identity", "fixture", "schema", "observer"];
const OBSERVER = "observer";
const ROUTE = "message.key";

const tableOf = (cx, i) => ((t) => (isTable(t) ? t : {}))(cx.requestTableOf?.(i));

const setsOf = (s, table) => Object.entries(table).filter(([k, row]) => typeof row?.means === "string" && literal(requestOf(s)[k])).map(([k, row]) => ({ key: k, value: requestOf(s)[k], means: row.means }));

function pinsOf(s, table) {
  const row = table.match;
  const match = isTable(requestOf(s).match) ? requestOf(s).match : {};
  return Object.entries(match).filter(([k, v]) => literal(v) && typeof row?.fields?.[k]?.means === "string").map(([k, v]) => ({ key: k, value: v, means: row.fields[k].means, selects: row.selects ?? null }));
}

const onOf = (s) => (s.op?.refs ?? []).filter((kind) => !AS.includes(kind) && literal(s.step?.input?.[`${kind}Ref`])).map((kind) => ({ kind, alias: s.step.input[`${kind}Ref`] }));
const observerOf = (s) => ((alias) => (literal(alias) && (s.op?.refs ?? []).includes(OBSERVER) ? alias : null))(s.step?.input?.[`${OBSERVER}Ref`]);
const creates = (s) => (s.op?.effects ?? []).includes("create-resource");
const routesOf = (s, table) => Object.entries(table).some(([k, row]) => row?.means === ROUTE && Object.hasOwn(requestOf(s), k));

// One step as the model reads it.
function stepCause(s, cx) {
  const table = tableOf(cx, s.i);
  const observer = observerOf(s);
  return { ...s, effects: s.op?.effects ?? [], on: onOf(s), arms: creates(s) ? observer : null, reads: creates(s) ? null : observer, sets: setsOf(s, table), pins: pinsOf(s, table), routes: routesOf(s, table), table, request: requestOf(s), semantics: cx.semanticsOf?.(s.i) ?? {} };
}

// Each assertion beside the accepted expectation it names and the step it is on: every value is the criterion owner's.
const ruledOf = (d, steps, cx) => (d.assertions ?? []).map((a) => ({ ref: a.criterionRef, e: cx.expectations?.get?.(a.criterionRef), s: steps.find((s) => s.i === a.step) })).filter((x) => x.e && x.s).map((x) => ({ ...x, template: EXPECT_OP.get(x.e.op)?.template ?? null, op: EXPECT_OP.get(x.e.op) ?? null }));

// What a design causes: { steps, ruled }.
export const causesOf = (design, cx = {}) => ((steps) => ({ steps, ruled: ruledOf(design ?? {}, steps, cx) }))(stepsOf(design ?? {}).map((s) => stepCause(s, cx)));

// ── selections every rule reads ────────────────────────────────────────────

export const doing = (m, effect) => m.steps.filter((s) => s.effects.includes(effect));
export const before = (steps, x) => steps.filter((s) => s.i < x.i);
export const between = (steps, a, b) => steps.filter((s) => s.i > a.i && s.i < b.i);

// Whether a step's effects include one whose row says so (`emits`, src/topology/vocab.mjs EFFECTS).
export const emits = (s) => s.effects.some((e) => effectOf(e)?.emits === true);

// The meanings a step's answer may carry that name WHICH repetition of a thing it is (`ordinal`, src/topology/vocab.mjs).
export const ordinalsOf = (s) => (s.op?.outputs ?? []).filter((means) => meaningOf(means)?.ordinal === true);

// The ruled assertions that wait for a value to be seen (the `complete` template), on one meaning or on any.
export const waits = (m) => m.ruled.filter((x) => x.template === "complete");
export const waitingFor = (m, means) => waits(m).filter((x) => x.e.property === means);

// The last step that armed the observer a step reads, before it -- or null.
export const armedFor = (m, s) => (s.reads ? before(m.steps, s).filter((a) => a.arms === s.reads && a.on.length > 0).at(-1) ?? null : null);

// What a step reads, by reference: its own, and, where it reads an observer, what that observer was armed on.
export const readsOn = (m, s) => [...s.on, ...(armedFor(m, s)?.on ?? [])];
export const sameReference = (a, b) => a.some((x) => b.some((y) => x.kind === y.kind && x.alias === y.alias));

// The capability ids whose operation may have an effect, as a sentence names them -- the families table's own, of the
// families an adapter may answer (a contract-only one is never designed).
export const capabilitiesDoing = (effect) => OPERATIONS.filter((o) => o.effects.includes(effect) && !o.contractOnly).map((o) => o.capability);

// The effect a step emits by, or null.
export const emittedBy = (s) => s.effects.find((e) => effectOf(e)?.emits === true) ?? null;

// ── what brings a thing again, and what moves time ─────────────────────────
//
// A workload control INTERRUPTS the run a delivery in flight is in only by an action that ends it (skeleton.mjs
// WORKLOAD_ACTIONS: a fault, a stop, a restart -- never a start), and only in the workload it names: a wait on what one
// workload did is interrupted by a control of that workload, and a wait that names no workload by a control of any.
const CONTROLS = "control-workload";
const INTERRUPTING = actionsWhere("interrupts");

export const interrupts = (s) => s.effects.includes(CONTROLS) && INTERRUPTING.includes(s.request.action);
const workloadsOf = (s) => s.on.filter((r) => r.kind === "workload");
const consumes = (c, s) => workloadsOf(s).length === 0 || sameReference(c.on, workloadsOf(s));
export const interruptedBefore = (m, s) => before(m.steps, s).filter((c) => interrupts(c) && consumes(c, s));

// What makes a channel deliver the same message again (catalog/semantics.json redeliveryTriggers), by what a design does
// about it: a crash or a lost connection a design causes by interrupting the workload that consumes it; the application's
// own rejection, which a correct one need never make; or something that comes on its own once time passes -- a lock, a
// visibility timeout, an ack wait, a rebalance -- which a correct application may yet see. test/qa-causes.test.mjs holds
// it to the vocabulary's values both ways; a value a project's own layer adds is unknown, and unknown is never a refusal.
export const REDELIVERY = { "crash-before-settle": "interrupt", "connection-loss": "interrupt", nack: "rejects", "lock-expiry": "elapses", "visibility-timeout": "elapses", "ack-wait": "elapses", rebalance: "elapses" };

const listOf = (v) => (Array.isArray(v) ? v : []);

// What the adapters answering the design's steps declare brings a delivery back, with what the obligation's shape needs
// of one: "never" where every one is declared and none comes on its own, "may" where one may, "unknown" where none is.
export function redeliveryOf(m, shape) {
  const triggers = [...new Set([...m.steps.flatMap((s) => listOf(s.semantics.redeliveryTriggers)), ...listOf(shape?.semantics?.redeliveryTriggers)])];
  if (triggers.length === 0) return "unknown";
  return triggers.every((t) => REDELIVERY[t] && REDELIVERY[t] !== "elapses") ? "never" : "may";
}

// The instant each of a design's clock moves takes the business clock to, where its request sets it (a literal the
// adapter's row says means clock.evaluatedThrough): [{ s, at, value }].
const CLOCK = "advance-clock";
const THROUGH = "clock.evaluatedThrough";

export const clockMoves = (m) => doing(m, CLOCK).flatMap((s) => s.sets.filter((f) => f.means === THROUGH && Number.isFinite(Date.parse(f.value))).map((f) => ({ s, at: Date.parse(f.value), value: f.value })));
