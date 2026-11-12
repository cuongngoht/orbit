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
import { requestOf, stepsOf } from "./skeleton.mjs";

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

// The capability ids whose operation may have an effect, as a sentence names them -- the families table's own.
export const capabilitiesDoing = (effect) => OPERATIONS.filter((o) => o.effects.includes(effect)).map((o) => o.capability);
