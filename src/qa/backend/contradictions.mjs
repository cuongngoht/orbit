// What a correct application can never be held to (0.5.0): an assertion a design rules with that its OWN steps -- read
// with what their answering adapters declare and what its obligation's shape says -- rule out, or satisfy whatever the
// application does, or that rests on something the design never causes. Real coding hosts sent such designs on the 0.5.0
// release pre-check (the benchmark's QA rows): each was validated and frozen, ran, and contradicted the CLEAN application
// too -- a false alarm only the benchmark's confirmation on the clean application caught. So a design is held to them where it is made, by what can be shown:
//
//   refused  what follows from the design and the declarations alone -- or from them and the investigation's own record
//            of what an earlier test proved (SETTLED_BEFORE): the `contradiction` stage
//            (src/qa/generation/design.mjs) stops it as GENERATION_FAILED before a draft exists, naming the step, the
//            field, both values and what holds instead, in that order -- the start of a finding is what a host sees of it
//   advised  what holds only if the application does on its own what the design never causes -- a later delivery, a
//            schedule's loop reaching an occurrence, a second message settling some way: said beside the answer of a
//            design that was made (`advice`); it decides, records and refuses nothing
//
// What a request's match compares and what a match picks are the answering adapter's declaration (orbit.adapter/v1 request
// rows' `means` and `selects`, src/adapters/contract-v1.mjs), and so is which field of the message a publication's request
// sets (`means` on its rows): a field whose row says nothing is unknown, and unknown is never a refusal. Which business
// key a publication is under is the backend vocabulary's word for it (bindings.mjs MESSAGE_FIELDS businessKey), read the
// way a design's keys are read (shared.mjs keysOf) -- never guessed from a value.
import { EXPECT_OP } from "../vocab.mjs";
import { keysOf } from "./shared.mjs";
import { isOp, refOf, requestOf, stepsOf } from "./skeleton.mjs";

const literal = (v) => typeof v === "string" && v.length > 0 && !v.includes("${");
const isTable = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const cut = (v) => String(v).slice(0, 120);

// Each assertion beside the accepted expectation it names and the step it is on: every value is the criterion owner's.
const ruled = (d, cx) => ((steps) => (d.assertions ?? []).map((a) => ({ ref: a.criterionRef, e: cx.expectations?.get?.(a.criterionRef), s: steps.find((s) => s.i === a.step) })).filter((x) => x.e && x.s))(stepsOf(d));

// The ones that wait for a value to be seen (a complete-within slot, compiled `complete`), on one meaning or on any.
const waits = (d, cx) => ruled(d, cx).filter((x) => EXPECT_OP.get(x.e.op)?.template === "complete");
const waitingFor = (d, cx, means) => waits(d, cx).filter((x) => x.e.property === means);

// What a step's match PINS: each field holding a literal whose row says what it is compared with, and what the match
// picks -- off the request table of the adapter that answers the step.
function pinsOf(s, cx) {
  const row = cx.requestTableOf?.(s.i)?.match;
  const match = isTable(requestOf(s).match) ? requestOf(s).match : {};
  return Object.entries(match).filter(([k, v]) => literal(v) && typeof row?.fields?.[k]?.means === "string").map(([k, v]) => ({ key: k, value: v, means: row.fields[k].means, selects: row.selects ?? null }));
}

// Whether a pin is all the step can rule on: an answer of only what it names, or a wait its request ends on a count of it.
const PINNING = { answer: () => true, count: (s) => Number.isInteger(requestOf(s).count) };
const pinning = (s, p) => Object.hasOwn(PINNING, String(p.selects)) && PINNING[p.selects](s);

// ── a value the step's own match rules out ────────────────────────────────
//
// An assertion waits for one value of a field on a step whose own match names that very field with ANOTHER value. A match
// that picks the answer leaves only the other value there: the assertion never holds. A match whose count ends the wait
// ends it when the other value came, so the window the criterion gives its own value is cut short by what the step waited
// for -- and a window cut short is not the window a verdict rules on (skills/orbit-backend-test/window.mjs), while the
// observation says it saw everything it was asked: a correct application whose own value comes after the other one, or
// never in this test, is ruled against. Either way the verdict is not the criterion's. A match its request ends no wait
// on, or one whose adapter does not say what it picks, rules out nothing.
const matchPins = (d, cx) => waits(d, cx).filter((x) => literal(x.e.value)).flatMap((x) => pinsOf(x.s, cx).filter((p) => p.means === x.e.property && p.value !== x.e.value && pinning(x.s, p)).map((p) => pinSay(x, p)));

const PINNED = { answer: "its answer holds only what its match names", count: "its wait ends once its match is met, so the window the slot is judged in is cut short of its own" };

const pinSay = (x, p) => `step ${x.s.i} waits for ${cut(p.value)} (request.match.${p.key}) and ${x.ref} needs ${cut(x.e.value)} there: match on that and bring it about first — ${p.means} is the field both name, and ${PINNED[p.selects]}`;

// ── a wait the design's own publication satisfies ─────────────────────────
//
// A criterion that waits for a message to be seen (complete-within on a field of a message, e.g. its correlation) is about
// a message the SYSTEM sends: the period's request its schedule publishes, the event its write emits. A design that
// publishes one itself, on the very channel an observer it armed BEFORE that publication watches, carrying the very value
// the slot waits for, is seen by that observer -- so the wait holds (or stays undecided) whatever the application does,
// and its verdict is the design's, never the criterion's. And the message it published is a second one under the
// system's own key, whose settlement a later slot then reads (ORBIT-QA-007 and ORBIT-TOOL-001 on the 0.5.0 pre-check: the
// clean worker settled it as the duplicate it was). Refused (SELF_SATISFIED) only where every link is declared or shown:
//
//   the field     the publishing adapter's request row says which field of the published message it sets (`means`,
//                 orbit.adapter/v1), and that is the slot's property, with the slot's value as a literal
//   the channel   the observer was armed on the publication's own channel, with nothing in its request that narrows what
//                 it sees, and the publication names no field that routes it elsewhere (a `message.key`)
//   the delivery  the publishing adapter declares the channel drops nothing as a duplicate (`publishDedupe: none`), and no
//                 other await on that observer, between the publication and the wait, read it first
//   the answer    the wait's match answers every message it reads (`selects: count`), names nothing, or names only what
//                 the publication carries
//
// What only looks like it -- an observer armed after the publication, a channel that may drop it, a route it may take
// elsewhere -- is said beside the answer (SELF_PUBLISHED), never refused: the system may yet send a message of its own
// under that value.
const OBSERVE = "orbit.messaging.observe";
const AWAIT = "orbit.observe.await";
const ROUTE = "message.key";

// What a publication SETS of the message it sends: each field holding a literal whose row says which field it is.
const tableOf = (s, cx) => ((t) => (isTable(t) ? t : {}))(cx.requestTableOf?.(s.i));
const setsOf = (s, cx) => Object.entries(tableOf(s, cx)).filter(([k, row]) => typeof row?.means === "string" && literal(requestOf(s)[k])).map(([k, row]) => ({ key: k, value: requestOf(s)[k], means: row.means }));

// The step that armed the observer a wait reads: the last arming of its observerRef before the wait, on a named channel.
const armedFor = (d, x) => stepsOf(d).filter((s) => isOp(s, OBSERVE) && literal(refOf(s, "channel")) && refOf(s, "observer") === refOf(x.s, "observer") && s.i < x.s.i).at(-1) ?? null;

// Each wait for a value one of the design's own publications on the observer's channel put under the slot's very field,
// before the wait: { x, arm, p, f }.
const selfWaits = (d, cx) => waits(d, cx).filter((x) => isOp(x.s, AWAIT) && literal(x.e.value)).flatMap((x) => ((arm) => (arm ? publishedFor(d, cx, x, arm) : []))(armedFor(d, x)));

const publishedFor = (d, cx, x, arm) => stepsOf(d).filter((p) => isOp(p, PUBLISH) && p.i < x.s.i && refOf(p, "channel") === refOf(arm, "channel")).flatMap((p) => setsOf(p, cx).filter((f) => f.means === x.e.property && f.value === x.e.value).map((f) => ({ x, arm, p, f })));

// Whether the wait's match answers the publication: every message read, nothing named, or only what it carries.
function answers(w, cx) {
  const match = requestOf(w.x.s).match;
  const row = tableOf(w.x.s, cx).match;
  if (!isTable(match) || Object.keys(match).length === 0 || row?.selects === "count") return true;
  return Object.entries(match).every(([k, v]) => setsOf(w.p, cx).some((f) => f.means === row?.fields?.[k]?.means && f.value === v));
}

const routes = (p, cx) => Object.entries(tableOf(p, cx)).some(([k, row]) => row?.means === ROUTE && Object.hasOwn(requestOf(p), k));
const readBetween = (d, w) => stepsOf(d).some((s) => isOp(s, AWAIT) && refOf(s, "observer") === refOf(w.x.s, "observer") && s.i > w.p.i && s.i < w.x.s.i);

// Each link of the proof, in the order the comment above gives them.
const SEEN = [
  (w) => w.arm.i < w.p.i,
  (w) => Object.keys(requestOf(w.arm)).length === 0,
  (w, d, cx) => !routes(w.p, cx),
  (w, d, cx) => cx.semanticsOf?.(w.p.i)?.publishDedupe === "none",
  (w, d) => !readBetween(d, w),
  (w, d, cx) => answers(w, cx),
];

const seen = (w, d, cx) => SEEN.every((holds) => holds(w, d, cx));

function selfSatisfied(d, cx, refuses) {
  const all = selfWaits(d, cx);
  const proven = all.filter((w) => seen(w, d, cx));
  return refuses ? proven.map(selfSay) : all.filter((w) => !proven.some((v) => v.x === w.x)).map(publishedSay);
}

const INSTEAD = "publish none; move the clock to its occurrence (or trigger its schedule where the clock cannot move, or send the request its interface takes) and await the system's own";

const selfSay = (w) => `step ${w.x.s.i} waits for ${w.f.key} ${cut(w.x.e.value)} (${w.x.ref}), which step ${w.p.i} publishes itself: ${INSTEAD} — observer ${cut(refOf(w.arm, "observer"))} was armed on ${cut(refOf(w.p, "channel"))} before step ${w.p.i}, which sets ${w.x.e.property} there (request.${w.f.key}), so this wait holds whatever the application does and rules nothing of the criterion`;

const publishedSay = (w) => `step ${w.x.s.i} waits for ${w.f.key} ${cut(w.x.e.value)} (${w.x.ref}), which step ${w.p.i} publishes on its channel itself: ${INSTEAD}, unless the system sends one of its own too — whether the observer sees step ${w.p.i}'s own message on ${cut(refOf(w.p, "channel"))} is not shown here, so it is said, never refused`;

// ── a second message under a business key ─────────────────────────────────
//
// The effect-once-per-key obligation's own subject (src/qa/obligations/shapes.mjs ONCE_PER_KEY): a second message a
// design publishes under a business key it already published one under is not a second effect, and how it settles is the
// system's own word -- never a second success to wait for. A step whose answer is narrowed to that second message (its
// match names the message's id, on a match that picks the answer) and that waits for it to settle exactly as the step on
// the FIRST message waits for that one, holds the second to the first one's success: refused, whatever the word is. One
// that waits for the second alone to settle some way may be ruling it by what an accepted criterion states a second one
// comes to: said, never refused.
const SUBJECT = "effect-once-per-key";
const SETTLES = "settlement.outcome";
const MESSAGE = "message.id";
const BUSINESS_KEY = "businessKey";
const PUBLISH = "orbit.messaging.publish";

// Every publication the design makes, in order, with its message id and the business keys its request names.
const publications = (d) => stepsOf(d).filter((s) => isOp(s, PUBLISH) && literal(requestOf(s).messageId)).map((s) => ({ i: s.i, id: requestOf(s).messageId, keys: businessKeysOf(s) }));

const businessKeysOf = (s) => [...keysOf({ skeleton: { steps: [s.step] } })].filter(([, as]) => as.includes(BUSINESS_KEY)).map(([value]) => value);

// Each message published under a business key the design's first publication under it named with another id: { id, key,
// first }. The same id published again is that same message, never a second one.
const seconds = (d) => ((pubs) => pubs.flatMap((p) => p.keys.flatMap((key) => secondOf(pubs.find((q) => q.keys.includes(key)), p, key))))(publications(d));

const secondOf = (first, p, key) => (first.i < p.i && first.id !== p.id ? [{ id: p.id, key, first: first.id }] : []);

// The message a step's answer is narrowed to, by a match field its adapter says is compared with the message's id.
const narrowedTo = (s, cx) => pinsOf(s, cx).find((p) => p.means === MESSAGE && p.selects === "answer")?.value ?? null;

function secondsSettled(d, cx, refuses) {
  if (cx.shape?.id !== SUBJECT) return [];
  const settled = waitingFor(d, cx, SETTLES).map((x) => ({ ...x, on: narrowedTo(x.s, cx) }));
  return seconds(d).flatMap((m) => settled.filter((x) => x.on === m.id && Boolean(asFirst(settled, m, x)) === refuses).map((x) => settledSay(x, m, asFirst(settled, m, x))));
}

// The step on the first message under that key that waits for the very settlement this one waits for -- or null.
const asFirst = (settled, m, x) => settled.find((y) => y.on === m.first && y.e.value === x.e.value) ?? null;

const settledSay = (x, m, first) => (first ? asFirstSay(x, m, first) : aloneSay(x, m));

const asFirstSay = (x, m, first) => `step ${x.s.i} waits for ${cut(m.id)} to settle as ${cut(x.e.value)} (${x.ref}) like ${cut(m.first)} at step ${first.s.i}, the first under that businessKey: rule step ${x.s.i} by its first delivery, or publish ${cut(m.first)} twice and count both in one observation — a second message under a business key is not a second effect, and how it settles is the system's own word`;

const aloneSay = (x, m) => `step ${x.s.i} waits for ${cut(m.id)} to settle as ${cut(x.e.value)} (${x.ref}), the second message here under ${cut(m.first)}'s businessKey: unless a criterion states how a second one settles, rule it by its first delivery — how it settles is the system's own word (businessKey ${cut(m.key)})`;

// ── a business key an earlier test of the investigation already settled ───
//
// The tests of one investigation run in its one sandbox and share its state (shared.mjs ONE_SANDBOX), and what an earlier
// test PROVED of that state is in its own record: a version that ran and was SATISFIED held every assertion it made, so a
// message it published under a business key and waited for, on an observation narrowed to that message, settled as it
// waited -- in this sandbox, before this design runs. A design that publishes ANOTHER message under that business key and
// waits, narrowed to it, for the very settlement the earlier test's message met holds a second message under a business
// key to the first one's success -- SECOND_SETTLED across two tests instead of inside one: refused, naming the earlier
// version, the key and what holds instead. It is said where the investigation's accepted plan holds the system to one
// effect per business key (an accepted effect-once-per-key obligation of the same investigation), whatever this design's
// own obligation is. `cx.investigation` is that record (src/investigation/generate.mjs): `{ shapes, earlier: [{ version,
// shape, design, cx }] }`, each earlier entry a SATISFIED version with its design read back and the context it is read in.
//
// What a value only suggests the record does not prove, and stays advice (shared.mjs sharedWith): an occurrence an earlier
// test brought about publishes under business keys the APPLICATION composes from it, for whatever its job selects -- no
// declaration says which key, so a message published by hand for that occurrence may as well be the first under its own.
const proven = (cx) => ((cx.investigation?.shapes ?? []).includes(SUBJECT) ? cx.investigation.earlier ?? [] : []);

// Every wait on how a message settles, beside the message its observation is narrowed to.
const settledOn = (d, cx) => waitingFor(d, cx, SETTLES).map((x) => ({ ...x, on: narrowedTo(x.s, cx) })).filter((x) => x.on !== null);

// What an earlier proven version's own messages settled as under each business key: [{ version, shape, key, id, value }].
const metBy = (e) => ((settled) => publications(e.design).flatMap((q) => q.keys.flatMap((key) => settled.filter((y) => y.on === q.id).map((y) => ({ version: e.version, shape: e.shape, key, id: q.id, value: y.e.value })))))(settledOn(e.design, e.cx ?? {}));

function settledBefore(d, cx) {
  const met = proven(cx).flatMap(metBy);
  const settled = settledOn(d, cx);
  return publications(d).flatMap((p) => p.keys.flatMap((key) => met.filter((m) => m.key === key && m.id !== p.id).flatMap((m) => settled.filter((x) => x.on === p.id && x.e.value === m.value).map((x) => beforeSay(x, p, m)))));
}

const beforeSay = (x, p, m) => `step ${x.s.i} waits for ${cut(p.id)} to settle as ${cut(x.e.value)} (${x.ref}) under businessKey ${cut(m.key)}, which ${m.version} (${m.shape ?? "an earlier test"}) of this investigation already published ${cut(m.id)} under and saw settle as ${cut(m.value)}: use a business key no earlier test of this investigation used, or rule this one by what that test left — its tests share one sandbox, and a second message under a business key is not a second effect`;

// ── a later delivery nothing in the design causes ─────────────────────────
//
// A delivery after the first comes when one before it failed or was interrupted before it settled -- what an adapter's
// `redeliveryTriggers` name: a crash or a lost connection, which a design causes by faulting, stopping or restarting the
// workload that consumes it, or the application's own rejection or lease. A design with no step that controls a workload
// causes none of it, so waiting for a later delivery (a delivery attempt above the first) rests on the application
// failing on its own -- which a correct one need never do. Where the obligation's own shape declares how a delivery comes
// back without a fault (`semantics.redeliveryTriggers`: a lock that expires, a visibility timeout, an ack wait), a
// correct application may yet do it, and that is said, never refused. Where its shape declares no way at all, nothing
// in the design or the declarations brings a second delivery, and a correct application that settles the first is ruled
// against: refused (NEVER_REDELIVERED) -- Sonnet 5.5 sent exactly that on ORBIT-QA-002 after the advice alone was said
// (0.5.0 re-verify), and it was the run's one false alarm.
const ATTEMPT = "delivery.attempt";
const WORKLOAD_CONTROL = "orbit.workload.control";

const declaresRedelivery = (cx) => (cx.shape?.semantics?.redeliveryTriggers ?? []).length > 0;

const uncausedRedelivery = (d, cx, refuses) => (stepsOf(d).some((s) => isOp(s, WORKLOAD_CONTROL)) || declaresRedelivery(cx) === refuses ? [] : waitingFor(d, cx, ATTEMPT).filter((x) => Number.isInteger(x.e.value) && x.e.value > 1).map((x) => redeliverySay(x, narrowedTo(x.s, cx))));

const redeliverySay = (x, id) => `step ${x.s.i} waits for delivery ${x.e.value} of ${id ? cut(id) : "a message"} (${x.ref}) and no step here faults, stops or restarts a workload: arm a fault before it settles (orbit.workload.control), or rule the step by its first delivery — a correct application need deliver a message it settles only once`;

// ── a schedule's decision nothing in the design brings about ──────────────
//
// A schedule decides an occurrence when its own loop reaches it on its clock; a trigger asks the handler to dispatch now
// and proves the handler, never the schedule. A design that moves no clock (orbit.clock.advance) and waits for what a
// schedule decided of an occurrence rests on the clock already being there -- moved by an earlier test of the same
// investigation, or a clock that is real time. Neither can be told from the design: said, never refused.
const DECISION = "occurrence.decision";
const OCCURRENCE = "occurrence.id";
const CLOCK = "orbit.clock.advance";

const uncausedDecision = (d, cx) => (stepsOf(d).some((s) => isOp(s, CLOCK)) ? [] : waitingFor(d, cx, DECISION).map((x) => decisionSay(x, pinsOf(x.s, cx).find((p) => p.means === OCCURRENCE)?.value ?? null)));

const decisionSay = (x, occurrence) => `step ${x.s.i} waits for ${occurrence ? cut(occurrence) : "an occurrence"} to be decided ${cut(x.e.value)} (${x.ref}) and no step here moves the clock: advance it to that occurrence first (orbit.clock.advance), unless an earlier test of this investigation did — a schedule decides an occurrence when its own loop reaches it, and a trigger proves the handler, never the schedule`;

// ── the table ──────────────────────────────────────────────────────────────

export const CONTRADICTION_RULES = [
  { id: "MATCH_PINS", refuses: true, findings: (d, cx) => matchPins(d, cx) },
  { id: "SELF_SATISFIED", refuses: true, findings: (d, cx) => selfSatisfied(d, cx, true) },
  { id: "SELF_PUBLISHED", refuses: false, findings: (d, cx) => selfSatisfied(d, cx, false) },
  { id: "SECOND_SETTLED", refuses: true, findings: (d, cx) => secondsSettled(d, cx, true) },
  { id: "SECOND_SETTLES", refuses: false, findings: (d, cx) => secondsSettled(d, cx, false) },
  { id: "SETTLED_BEFORE", refuses: true, findings: (d, cx) => settledBefore(d, cx) },
  { id: "NEVER_REDELIVERED", refuses: true, findings: (d, cx) => uncausedRedelivery(d, cx, true) },
  { id: "UNCAUSED_REDELIVERY", refuses: false, findings: (d, cx) => uncausedRedelivery(d, cx, false) },
  { id: "UNCAUSED_DECISION", refuses: false, findings: (d, cx) => uncausedDecision(d, cx) },
];

// Each finding once, by the rule that says it: a message under two business keys is still one sentence.
const saidBy = (rules, design, cx) => rules.flatMap((rule) => [...new Set(rule.findings(design ?? {}, cx ?? {}))].map((say) => ({ rule: rule.id, say })));

// What refuses a design, and what is said beside one that was made -- each finding by the rule that says it.
export const contradictionFindings = (design, cx) => saidBy(CONTRADICTION_RULES.filter((r) => r.refuses), design, cx);
export const contradictionAdvice = (design, cx) => saidBy(CONTRADICTION_RULES.filter((r) => !r.refuses), design, cx);
