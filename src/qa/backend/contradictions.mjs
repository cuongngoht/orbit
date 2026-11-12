// What a correct application can never be held to (0.5.0; one model, 0.6.0): an assertion a design rules with that its
// OWN steps -- read with what their answering adapters declare and what its obligation's shape says -- rule out, or
// satisfy (or fail) whatever the application does, or that rests on something the design never causes. Real coding hosts
// sent such designs on the 0.5.0 release pre-check: each was validated and frozen, ran, and contradicted the CLEAN
// application too -- a false alarm only a confirmation on the clean application caught. So a design is held to them where
// it is made, by what can be shown -- one principle: a verdict depends on the application, never on what the design
// itself causes, and is never one a correct application cannot meet:
//
//   refused  what follows from the design and the declarations alone -- or from them and the investigation's own record
//            of what an earlier test did (SETTLED_BEFORE, NEVER_DECIDED): the `contradiction` stage
//            (src/qa/generation/design.mjs) stops it as GENERATION_FAILED before a draft exists, naming the step, the
//            field, both values and what holds instead, in that order -- the start of a finding is what a host sees of it
//   advised  what holds only if the application does on its own what the design never causes -- a later delivery, a
//            schedule's loop reaching an occurrence, a second message settling some way -- or what a link the
//            declarations do not show would make so: said beside the answer of a design that was made (`advice`); it
//            decides, records and refuses nothing
//
// Every rule reads the design through ONE model of what it causes (causes.mjs causesOf): per step its effects, the
// references it acts on, the observer it arms or reads, what its request sets and its match pins (orbit.adapter/v1
// request rows' `means` and `selects`), its adapter's semantics -- and what rules on it. A field whose row says nothing
// is unknown, and unknown is never a refusal. Which business key a publication is under is the backend vocabulary's word
// for it (bindings.mjs MESSAGE_FIELDS businessKey), read the way a design's keys are read (shared.mjs keysOf) -- never
// guessed from a value. Nothing here names a family operation or a shape: what a step does is its effects, which
// repetition an answer is a meaning's `ordinal`, and what comes again of work already done its shape's `again`
// (src/qa/obligations/shapes.mjs).
import { shapeOf } from "../obligations/shapes.mjs";
import { armedFor, before, between, capabilitiesDoing, causesOf, clockMoves, doing, emittedBy, emits, interruptedBefore, interrupts, literal, ordinalsOf, readsOn, redeliveryOf, sameReference, waitingFor, waits } from "./causes.mjs";
import { keysOf } from "./shared.mjs";

const cut = (v) => String(v).slice(0, 120);
const said = (effect) => capabilitiesDoing(effect).join(", ");

// ── a value the step's own match rules out ────────────────────────────────
//
// An assertion holds a field to a value (or to one of several: what its op `admits`, src/qa/vocab.mjs) on a step whose
// own match names that very field with ANOTHER value. A match that picks the answer leaves only the other value there:
// the assertion never holds, whatever its template. A match whose count ends the wait ends it when the other value came,
// so the window a windowed slot gives its own value is cut short by what the step waited for -- and a window cut short is
// not the window a verdict rules on (skills/orbit-backend-test/window.mjs), while the observation says it saw everything
// it was asked: a correct application whose own value comes after the other one, or never in this test, is ruled
// against. Either way the verdict is not the criterion's. A match its request ends no wait on, or one whose adapter does
// not say what it picks, rules out nothing.
const ADMITS = { one: (v) => (literal(v) ? [v] : null), any: (v) => (Array.isArray(v) && v.length > 0 && v.every(literal) ? v : null) };
const admitted = (x) => ADMITS[x.op?.admits]?.(x.e.value) ?? null;

// Whether a pin is all the step can rule on: an answer of only what it names, or a window its request ends on a count.
const PINNING = { answer: () => true, count: (x) => x.op?.window === true && Number.isInteger(x.s.request.count) };
const pinning = (x, p) => Object.hasOwn(PINNING, String(p.selects)) && PINNING[p.selects](x);

const matchPins = (m) => m.ruled.flatMap((x) => ((values) => (values ? x.s.pins.filter((p) => p.means === x.e.property && !values.includes(p.value) && pinning(x, p)).map((p) => pinSay(x, p, values)) : []))(admitted(x)));

const PINNED = { answer: "its answer holds only what its match names", count: "its wait ends once its match is met, so the window the slot is judged in is cut short of its own" };

const needs = (values) => (values.length === 1 ? cut(values[0]) : `one of ${values.map(cut).join(", ")}`);

const pinSay = (x, p, values) => `step ${x.s.i} waits for ${cut(p.value)} (request.match.${p.key}) and ${x.ref} needs ${needs(values)} there: match on that and bring it about first — ${p.means} is the field both name, and ${PINNED[p.selects]}`;

// ── what the design's own emission puts where its step reads ──────────────
//
// A criterion that waits for something to be seen (complete-within on a field of a message, an occurrence, a job) is
// about what the SYSTEM sends: the period's request its schedule publishes, the event its write emits, the occurrence its
// loop decides. A design that emits one itself -- publishes the message, enqueues the job, triggers the occurrence: any
// effect that `emits` (src/topology/vocab.mjs) -- on the very reference its step reads, carrying the very value the slot
// waits for, is read by that step: so the wait holds (or stays undecided) whatever the application does, and its verdict
// is the design's, never the criterion's (ORBIT-QA-007 and ORBIT-TOOL-001 on the 0.5.0 pre-check: the clean worker
// settled the hand-published message as the duplicate it was). Its mirror is a slot that rules the value ABSENT
// (absent-within) after the design emitted it there itself: it fails whatever the application does. Refused
// (SELF_SATISFIED) only where every link is declared or shown:
//
//   the field     the emitting adapter's request row says which field of what it sends it sets (`means`), and that is the
//                 slot's property, with the slot's value as a literal
//   the reference the step reads an observer armed on the emission's own reference, with nothing in its request that
//                 narrows what it sees, and the emission names no field that routes it elsewhere (a `message.key`)
//   the delivery  the emitting adapter declares the reference drops nothing as a duplicate (`publishDedupe: none`), and no
//                 other read of that observer, between the emission and the step, read it first
//   the answer    the step's match answers every item it reads (`selects: count`), names nothing, or names only what
//                 the emission carries
//
// What only looks like it -- an observer armed after the emission, a reference that may drop it, a route it may take
// elsewhere, a step that reads by a cursor nothing declares the start of -- is said beside the answer (SELF_PUBLISHED),
// never refused: the system may yet send one of its own under that value. What holds instead is said per effect, and
// never as a way to make a schedule decide: a trigger proves the handler, never the schedule (UNCAUSED_DECISION below).
const SELF = { complete: "waits", "absent-within": "absent" };

const selfRuled = (m) => m.ruled.filter((x) => Object.hasOwn(SELF, x.template) && literal(x.e.value));

// Each such slot beside one of the design's own emissions that set its value where its step reads: { x, arm, p, f }.
const selfWaits = (m) => selfRuled(m).flatMap((x) => before(m.steps, x.s).filter((p) => emits(p) && sameReference(p.on, readsOn(m, x.s))).flatMap((p) => p.sets.filter((f) => f.means === x.e.property && f.value === x.e.value).map((f) => ({ x, arm: armedFor(m, x.s), p, f }))));

// Whether the step's match answers the emission: every item read, nothing named, or only what it carries.
const answers = (w) => w.x.s.table.match?.selects === "count" || w.x.s.pins.length === 0 || w.x.s.pins.every((pin) => w.p.sets.some((f) => f.means === pin.means && f.value === pin.value));

const readBetween = (m, w) => between(m.steps, w.p, w.x.s).some((s) => s.reads === w.x.s.reads);

// Each link of the proof, in the order the comment above gives them.
const SEEN = [
  (w) => w.arm !== null && w.arm.i < w.p.i,
  (w) => Object.keys(w.arm.request).length === 0,
  (w) => !w.p.routes,
  (w) => w.p.semantics.publishDedupe === "none",
  (w, m) => !readBetween(m, w),
  (w) => answers(w),
];

const seen = (w, m) => SEEN.every((holds) => holds(w, m));

function selfSatisfied(m, refuses) {
  const all = selfWaits(m);
  const proven = all.filter((w) => seen(w, m));
  return refuses ? proven.map(selfSay) : all.filter((w) => !proven.some((v) => v.x === w.x)).map(publishedSay);
}

// What holds instead of each kind of emission: bring it about as the system does, and await the system's own.
const INSTEAD = {
  publish: () => `publish none; bring its occurrence about as the system does — move the clock to it (${said("advance-clock")}), or where the clock cannot move trigger the handler that sends it (${said("trigger")}: that proves the handler, never the schedule), or send the request its interface takes — and await the system's own`,
  enqueue: () => `enqueue none; send the request its interface takes, or bring its occurrence about (${said("advance-clock")}), and await the job the system enqueues`,
  trigger: () => `trigger none; move the clock to its occurrence (${said("advance-clock")}) and await what the schedule's own loop decides — a trigger proves the handler, never the schedule`,
};

const insteadOf = (w) => (INSTEAD[emittedBy(w.p)] ?? INSTEAD.publish)();
const verbOf = (effect) => `${effect}${/sh$/.test(effect) ? "es" : "s"}`;
const onSaid = (w) => cut((w.arm ? w.p.on.find((r) => sameReference([r], w.arm.on)) : null)?.alias ?? w.p.on[0]?.alias);
const ruledAs = (w) => (SELF[w.x.template] === "waits" ? `waits for ${w.f.key} ${cut(w.x.e.value)}` : `rules ${w.f.key} ${cut(w.x.e.value)} absent`);
const holdsAs = (w) => (SELF[w.x.template] === "waits" ? "this wait holds" : "this slot fails");

const selfSay = (w) => `step ${w.x.s.i} ${ruledAs(w)} (${w.x.ref}), which step ${w.p.i} ${verbOf(emittedBy(w.p))} itself: ${insteadOf(w)} — observer ${cut(w.arm.arms)} was armed on ${onSaid(w)} before step ${w.p.i}, which sets ${w.x.e.property} there (request.${w.f.key}), so ${holdsAs(w)} whatever the application does and rules nothing of the criterion`;

const publishedSay = (w) => `step ${w.x.s.i} ${ruledAs(w)} (${w.x.ref}), which step ${w.p.i} ${verbOf(emittedBy(w.p))} on ${onSaid(w)} itself: ${insteadOf(w)}, unless the system sends one of its own too — whether step ${w.x.s.i} reads step ${w.p.i}'s own on ${onSaid(w)} is not shown here, so it is said, never refused`;

// ── what comes again of work already done ─────────────────────────────────
//
// What an obligation's shape declares comes again (`again`, src/qa/obligations/shapes.mjs) is not a second effect: how
// it settles is the system's own word -- never a second success to wait for. It comes two ways:
//
//   business-key  a second message a design emits under a business key it already emitted one under. A step whose answer
//                 is narrowed to that second message (its match names the message's id, on a match that picks the
//                 answer) and that waits for it to settle exactly as the step on the FIRST message waits for that one,
//                 holds the second to the first one's success: refused, whatever the word is
//   redelivery    the same message delivered again. A step narrowed to one message whose match picks only deliveries that
//                 settled one way (a match on how it settled) and counts more than one of them holds every delivery after
//                 the first to the first one's word: refused. One that waits for a later delivery (a slot on an ordinal
//                 above the first) settled the way another step waits for its first one to settle: refused too
//
// One that waits for the second alone to settle some way may be ruling it by what an accepted criterion states a second
// one comes to: said, never refused.
const BY_KEY = "business-key";
const REDELIVERY = "redelivery";
const SETTLES = "settlement.outcome";
const MESSAGE = "message.id";
const BUSINESS_KEY = "businessKey";

// Whether a shape declares something comes again that way (shapes.mjs `again`).
const comesAgain = (shape, way) => (shape?.again?.ways ?? []).includes(way);

// Every emission the design makes, in order, with the message id it sets and the business keys its request names.
const publications = (m) => m.steps.filter(emits).map((s) => ({ i: s.i, id: s.sets.find((f) => f.means === MESSAGE)?.value, keys: businessKeysOf(s) })).filter((p) => p.id !== undefined);

const businessKeysOf = (s) => [...keysOf({ skeleton: { steps: [s.step] } })].filter(([, as]) => as.includes(BUSINESS_KEY)).map(([value]) => value);

// Each message emitted under a business key the design's first emission under it named with another id: { id, key,
// first }. The same id emitted again is that same message, never a second one.
const seconds = (m) => ((pubs) => pubs.flatMap((p) => p.keys.flatMap((key) => secondOf(pubs.find((q) => q.keys.includes(key)), p, key))))(publications(m));

const secondOf = (first, p, key) => (first.i < p.i && first.id !== p.id ? [{ id: p.id, key, first: first.id }] : []);

// The message a step's answer is narrowed to, by a match field its adapter says is compared with the message's id.
const narrowedTo = (s) => s.pins.find((p) => p.means === MESSAGE && p.selects === "answer")?.value ?? null;

function secondsSettled(m, cx, refuses) {
  if (!comesAgain(cx.shape, BY_KEY)) return [];
  const settled = waitingFor(m, SETTLES).map((x) => ({ ...x, on: narrowedTo(x.s) }));
  return seconds(m).flatMap((n) => settled.filter((x) => x.on === n.id && Boolean(asFirst(settled, n, x)) === refuses).map((x) => settledSay(x, n, asFirst(settled, n, x))));
}

// The step on the first message under that key that waits for the very settlement this one waits for -- or null.
const asFirst = (settled, m, x) => settled.find((y) => y.on === m.first && y.e.value === x.e.value) ?? null;

const settledSay = (x, m, first) => (first ? asFirstSay(x, m, first) : aloneSay(x, m));

const asFirstSay = (x, m, first) => `step ${x.s.i} waits for ${cut(m.id)} to settle as ${cut(x.e.value)} (${x.ref}) like ${cut(m.first)} at step ${first.s.i}, the first under that businessKey: rule step ${x.s.i} by its first delivery, or publish ${cut(m.first)} twice and count both in one observation — a second message under a business key is not a second effect, and how it settles is the system's own word`;

const aloneSay = (x, m) => `step ${x.s.i} waits for ${cut(m.id)} to settle as ${cut(x.e.value)} (${x.ref}), the second message here under ${cut(m.first)}'s businessKey: unless a criterion states how a second one settles, rule it by its first delivery — how it settles is the system's own word (businessKey ${cut(m.key)})`;

// Each wait narrowed to one message whose match picks only deliveries settled one way: { x, id, pin, count, n }, n the
// delivery it waits for -- the count its request ends on, or the ordinal its slot names.
const countOf = (x) => (Number.isInteger(x.s.request.count) ? x.s.request.count : 1);
const ordinalOf = (x) => (ordinalsOf(x.s).includes(x.e.property) && Number.isInteger(x.e.value) ? x.e.value : 1);
const heldTo = (m) => waits(m).map((x) => ({ x, id: narrowedTo(x.s), pin: x.s.pins.find((p) => p.means === SETTLES && p.selects === "answer"), count: countOf(x), n: Math.max(countOf(x), ordinalOf(x)) })).filter((h) => h.id !== null && h.pin);

// The step that waits for the FIRST delivery of that message to settle that way: narrowed to it, waiting for no later one.
const firstHeld = (m, h) => waits(m).find((y) => y.s !== h.x.s && narrowedTo(y.s) === h.id && countOf(y) === 1 && ordinalOf(y) === 1 && settlesAs(y, h.pin.value)) ?? null;
const settlesAs = (y, value) => (y.e.property === SETTLES && y.e.value === value) || y.s.pins.some((p) => p.means === SETTLES && p.selects === "answer" && p.value === value);

// Refused: a count of more than one under the match, or a later one held like the first; said: a later one alone.
const REDELIVERED = [
  { refuses: true, holds: (h) => h.count > 1, say: (h, shape) => countedSay(h, shape) },
  { refuses: true, holds: (h, m) => h.count === 1 && h.n > 1 && firstHeld(m, h) !== null, say: (h, shape, m) => likeFirstSay(h, shape, firstHeld(m, h)) },
  { refuses: false, holds: (h, m) => h.count === 1 && h.n > 1 && firstHeld(m, h) === null, say: (h, shape) => laterSay(h, shape) },
];

const redelivered = (m, cx, refuses) => (comesAgain(cx.shape, REDELIVERY) ? heldTo(m).flatMap((h) => REDELIVERED.filter((r) => r.refuses === refuses && r.holds(h, m)).map((r) => r.say(h, cx.shape, m))) : []);

const settledWhy = (shape) => `${shape.again.what} is not a second effect, and how it settles is the system's own word`;

const countedSay = (h, shape) => `step ${h.x.s.i} counts ${h.count} deliveries of ${cut(h.id)} that settle as ${cut(h.pin.value)} (request.match.${h.pin.key}, ${h.x.ref}), holding each after the first to the first one's word: drop ${h.pin.key} from its match and rule it by ${shape.again.by} — ${settledWhy(shape)}`;

const likeFirstSay = (h, shape, first) => `step ${h.x.s.i} waits for delivery ${h.n} of ${cut(h.id)} to settle as ${cut(h.pin.value)} (request.match.${h.pin.key}, ${h.x.ref}) like its first at step ${first.s.i}: drop ${h.pin.key} from step ${h.x.s.i}'s match and rule it by ${shape.again.by} — ${settledWhy(shape)}`;

const laterSay = (h, shape) => `step ${h.x.s.i} waits for delivery ${h.n} of ${cut(h.id)} to settle as ${cut(h.pin.value)} (request.match.${h.pin.key}, ${h.x.ref}): unless a criterion states how it settles, drop ${h.pin.key} from its match and rule it by ${shape.again.by} — ${settledWhy(shape)}`;

// ── a business key an earlier test of the investigation already settled ───
//
// The tests of one investigation run in its one sandbox and share its state (shared.mjs ONE_SANDBOX), and what an earlier
// test PROVED of that state is in its own record: a version that ran and was SATISFIED held every assertion it made, so a
// message it published under a business key and waited for, on an observation narrowed to that message, settled as it
// waited -- in this sandbox, before this design runs. A design that publishes ANOTHER message under that business key and
// waits, narrowed to it, for the very settlement the earlier test's message met holds a second message under a business
// key to the first one's success -- SECOND_SETTLED across two tests instead of inside one: refused, naming the earlier
// version, the key and what holds instead. It is said where the investigation's accepted plan holds the system to one
// effect per business key (an accepted obligation of the same investigation whose shape declares a second message under
// one comes again), whatever this design's own obligation is. `cx.investigation` is that record
// (src/investigation/generate.mjs): `{ shapes, earlier: [{ version, shape, design, cx, outcome }] }`, each earlier entry a
// version that RAN, with the word it ran to, its design read back and the context it is read in.
//
// What a value only suggests the record does not prove, and stays advice (shared.mjs sharedWith): an occurrence an earlier
// test brought about publishes under business keys the APPLICATION composes from it, for whatever its job selects -- no
// declaration says which key, so a message published by hand for that occurrence may as well be the first under its own.
const HELD = "SATISFIED";

const ranBefore = (cx) => cx.investigation?.earlier ?? [];
const proven = (cx) => ((cx.investigation?.shapes ?? []).some((id) => comesAgain(shapeOf(id), BY_KEY)) ? ranBefore(cx).filter((e) => (e.outcome ?? HELD) === HELD) : []);

// Every wait on how a message settles, beside the message its observation is narrowed to.
const settledOn = (m) => waitingFor(m, SETTLES).map((x) => ({ ...x, on: narrowedTo(x.s) })).filter((x) => x.on !== null);

// What an earlier proven version's own messages settled as under each business key: [{ version, shape, key, id, value }].
const metBy = (e) => ((em) => ((settled) => publications(em).flatMap((q) => q.keys.flatMap((key) => settled.filter((y) => y.on === q.id).map((y) => ({ version: e.version, shape: e.shape, key, id: q.id, value: y.e.value })))))(settledOn(em)))(causesOf(e.design, e.cx ?? {}));

function settledBefore(m, cx) {
  const met = proven(cx).flatMap(metBy);
  const settled = settledOn(m);
  return publications(m).flatMap((p) => p.keys.flatMap((key) => met.filter((n) => n.key === key && n.id !== p.id).flatMap((n) => settled.filter((x) => x.on === p.id && x.e.value === n.value).map((x) => beforeSay(x, p, n)))));
}

const beforeSay = (x, p, m) => `step ${x.s.i} waits for ${cut(p.id)} to settle as ${cut(x.e.value)} (${x.ref}) under businessKey ${cut(m.key)}, which ${m.version} (${m.shape ?? "an earlier test"}) of this investigation already published ${cut(m.id)} under and saw settle as ${cut(m.value)}: use a business key no earlier test of this investigation used, or rule this one by what that test left — its tests share one sandbox, and a second message under a business key is not a second effect`;

// ── a later delivery nothing in the design causes ─────────────────────────
//
// A delivery after the first comes when one before it failed or was interrupted before it settled -- what the adapters
// answering the design declare brings one back (`redeliveryTriggers`, with what the obligation's shape needs of one;
// causes.mjs REDELIVERY): a crash or a lost connection, which a design causes by faulting, stopping or restarting the
// workload that consumes it BEFORE it waits (a start interrupts nothing, and a control of another workload interrupts
// none of this one's deliveries); the application's own rejection, which a correct one need never make; or a lock, a
// visibility timeout, an ack wait that comes once time passes. Which repetition a slot waits for is a meaning its step's
// family declares an ordinal of (a delivery's attempt, a job's). A design that causes none waits on the application
// failing on its own:
//
//   refused  where every way the declarations name is one a design causes or a correct application never takes
//            (NEVER_REDELIVERED) -- a real host sent exactly that on ORBIT-QA-002 after the advice alone was said
//            (0.5.0 re-verify), and it was the run's one false alarm
//   said     where one comes on its own once time passes, or nothing declares how one comes (UNCAUSED_REDELIVERY)
const CONTROLS = "control-workload";

// A wait for a repetition above the first: a slot on a meaning the step's own answer may carry as an ordinal.
const later = (m) => waits(m).filter((x) => ordinalsOf(x.s).includes(x.e.property) && Number.isInteger(x.e.value) && x.e.value > 1);

const uncausedRedelivery = (m, cx, refuses) => ((never) => (never === refuses ? later(m).filter((x) => interruptedBefore(m, x.s).length === 0).map((x) => redeliverySay(m, x, narrowedTo(x.s))) : []))(redeliveryOf(m, cx.shape) === "never");

const consumer = (m, x) => (m.steps.some(interrupts) ? `no step before it faults, stops or restarts ${x.s.on.find((r) => r.kind === "workload")?.alias ?? "a workload"}` : "no step here faults, stops or restarts a workload");

const redeliverySay = (m, x, id) => `step ${x.s.i} waits for delivery ${x.e.value} of ${id ? cut(id) : "a message"} (${x.ref}) and ${consumer(m, x)}: arm a fault before it settles (${said(CONTROLS)}), or rule the step by its first delivery — a correct application need deliver a message it settles only once`;

// ── a schedule's decision nothing in the design brings about ──────────────
//
// A schedule decides an occurrence when its own loop reaches it on its clock; a trigger asks the handler to dispatch now
// and proves the handler, never the schedule. A design that moves no clock (no step whose effect is advance-clock) and
// waits for what a schedule decided of an occurrence rests on the clock already being there:
//
//   refused  where the clock's adapter declares it injected (`clockInjection` live or restart: it moves only when moved)
//            and no earlier version of the investigation that RAN moved it (NEVER_DECIDED) -- nothing does
//   said     otherwise -- an earlier test moved it, or the clock may be real time (UNCAUSED_DECISION)
//
// And a design that moves the clock only to where an earlier version that ran already moved it brings nothing due again:
// a wait after that move on an observer this design armed -- which sees only what comes after it was armed -- rests on
// the system sending again what it sent while the earlier test ran. Said, naming that version (CLOCK_PASSED); a read by a
// cursor may yet find what the earlier test left, and is said nothing.
const DECISION = "occurrence.decision";
const OCCURRENCE = "occurrence.id";
const CLOCK = "advance-clock";
const INJECTED = ["live", "restart"];

const injected = (cx) => capabilitiesDoing(CLOCK).some((c) => INJECTED.includes(cx.semanticsFor?.(c)?.clockInjection));
const movedBefore = (cx) => ranBefore(cx).flatMap((e) => clockMoves(causesOf(e.design, e.cx ?? {})).map((mv) => ({ ...mv, version: e.version })));
const neverMoved = (cx) => injected(cx) && movedBefore(cx).length === 0;

const uncausedDecision = (m, cx, refuses) => (doing(m, CLOCK).length > 0 || neverMoved(cx) !== refuses ? [] : waitingFor(m, DECISION).map((x) => decisionSay(x, x.s.pins.find((p) => p.means === OCCURRENCE)?.value ?? null, refuses)));

const decisionSay = (x, occurrence, refuses) => `step ${x.s.i} waits for ${occurrence ? cut(occurrence) : "an occurrence"} to be decided ${cut(x.e.value)} (${x.ref}) and no step here moves the clock: advance it to that occurrence first (${said(CLOCK)}), ${refuses ? "since its clock is injected and no earlier test of this investigation moved it" : "unless an earlier test of this investigation did"} — a schedule decides an occurrence when its own loop reaches it, and a trigger proves the handler, never the schedule`;

// The furthest this design moves the clock, beside the earlier move that already reached it -- or null.
const passedBy = (m, cx) => ((moves) => (moves.length ? movedBefore(cx).find((e) => moves.every((mv) => mv.at <= e.at)) ?? null : null))(clockMoves(m));

const armedAfter = (m, x) => x.s.reads !== null && armedFor(m, x.s) !== null && clockMoves(m).some((mv) => mv.s.i < x.s.i);

const clockPassed = (m, cx) => ((e) => (e ? waits(m).filter((x) => armedAfter(m, x)).map((x) => passedSay(x, clockMoves(m).at(-1), e)) : []))(passedBy(m, cx));

const passedSay = (x, mv, e) => `step ${x.s.i} waits for ${cut(x.e.value)} (${x.ref}) after step ${mv.s.i} moves the clock to ${cut(mv.value)}, where ${e.version} of this investigation already moved it (${cut(e.value)}): move it to a period no earlier test reached, or rule this by what that test left — nothing comes due again by a move to where the clock already was, and its tests share one sandbox`;

// ── the table ──────────────────────────────────────────────────────────────

// Each rule reads the model of what the design causes (`m`, causes.mjs) and the context it is read in.
export const CONTRADICTION_RULES = [
  { id: "MATCH_PINS", refuses: true, findings: (m) => matchPins(m) },
  { id: "SELF_SATISFIED", refuses: true, findings: (m) => selfSatisfied(m, true) },
  { id: "SELF_PUBLISHED", refuses: false, findings: (m) => selfSatisfied(m, false) },
  { id: "SECOND_SETTLED", refuses: true, findings: (m, cx) => [...secondsSettled(m, cx, true), ...redelivered(m, cx, true)] },
  { id: "SECOND_SETTLES", refuses: false, findings: (m, cx) => [...secondsSettled(m, cx, false), ...redelivered(m, cx, false)] },
  { id: "SETTLED_BEFORE", refuses: true, findings: (m, cx) => settledBefore(m, cx) },
  { id: "NEVER_REDELIVERED", refuses: true, findings: (m, cx) => uncausedRedelivery(m, cx, true) },
  { id: "UNCAUSED_REDELIVERY", refuses: false, findings: (m, cx) => uncausedRedelivery(m, cx, false) },
  { id: "NEVER_DECIDED", refuses: true, findings: (m, cx) => uncausedDecision(m, cx, true) },
  { id: "UNCAUSED_DECISION", refuses: false, findings: (m, cx) => uncausedDecision(m, cx, false) },
  { id: "CLOCK_PASSED", refuses: false, findings: (m, cx) => clockPassed(m, cx) },
];

// Each finding once, by the rule that says it: a message under two business keys is still one sentence.
const saidBy = (rules, design, cx) => ((m) => rules.flatMap((rule) => [...new Set(rule.findings(m, cx ?? {}))].map((say) => ({ rule: rule.id, say }))))(causesOf(design ?? {}, cx ?? {}));

// What refuses a design, and what is said beside one that was made -- each finding by the rule that says it.
export const contradictionFindings = (design, cx) => saidBy(CONTRADICTION_RULES.filter((r) => r.refuses), design, cx);
export const contradictionAdvice = (design, cx) => saidBy(CONTRADICTION_RULES.filter((r) => !r.refuses), design, cx);
