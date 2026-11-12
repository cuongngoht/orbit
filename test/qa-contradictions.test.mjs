// What a design can be shown to hold a correct application to (src/qa/backend/contradictions.mjs, 0.5.0): each rule on its
// own edges, read with the shipped adapters' declarations -- and every design the old benchmark's scripted controls sent
// (test/fixtures/qa-designs/sent.json, captured from the hosts themselves) and every worked design the playbook shows held
// to them: none of those may be refused, or a control would fail for the rule, not the product.
import assert from "node:assert/strict";
import { test } from "node:test";
import { declarationFindings, MATCH_SELECTS } from "../src/adapters/contract-v1.mjs";
import { CONTRADICTION_RULES, contradictionAdvice, contradictionFindings } from "../src/qa/backend/contradictions.mjs";
import { shapeOf } from "../src/qa/obligations/shapes.mjs";
import { meaningAt, meaningEntries } from "../src/topology/vocab.mjs";
import { ACCEPTED, ADAPTERS, contextOn, operationOn, proven, references, SENT, sentOf, WORKED } from "./qa-designs.mjs";

const call = (capability, input) => ({ do: "call", capability, input });
const KEY = "tenant-a|inv-a|billing-daily:2026-10-23T09:00:00+07:00";
const publish = (messageId, businessKey = KEY) => call("orbit.messaging.publish", { channelRef: "billing-reminder-requested", request: { messageId, correlationId: businessKey, payload: { messageId, businessKey } } });
const attempts = (request) => call("orbit.worker.observe", { workloadRef: "worker", request });
const awaited = (request) => call("orbit.observe.await", { observerRef: "requested", request });
const decisions = (request) => call("orbit.scheduler.observe", { scheduleRef: "billing-daily", request });
const design = (steps, assertions) => ({ skeleton: { steps }, assertions: assertions.map(([criterionRef, step]) => ({ criterionRef, template: ACCEPTED.get(criterionRef)?.op === "count-eq" ? "count-eq" : "complete", step })) });
const refused = (d, shape, stack = "invoice-a") => contradictionFindings(d, contextOn(stack, d, shape)).map((f) => f.rule);
const advised = (d, shape, stack = "invoice-a") => contradictionAdvice(d, contextOn(stack, d, shape)).map((f) => f.rule);

const PERIOD = "tenant-a|inv-a|billing-daily:2026-10-22T09:00:00+07:00";
const OTHER = "tenant-a|inv-a|billing-daily:2027-01-05T09:00:00+07:00";

test("a match pins a field only where its adapter says what the field is compared with, and what the match picks", () => {
  const pinned = (request, stack = "invoice-a") => refused(design([awaited(request)], [["FIX-ASYNC-1/E1", 1]]), "completes-by-deadline", stack);
  assert.deepEqual(pinned({ count: 1, match: { correlationId: OTHER } }), ["MATCH_PINS"], "a count of another correlation ends the wait");
  assert.deepEqual(pinned({ count: 1, match: { correlationId: OTHER } }, "invoice-b"), ["MATCH_PINS"], "on the other stack's broker as on this one's");
  assert.deepEqual(pinned({ match: { correlationId: OTHER } }), [], "with no count, the whole window is watched and every message read is answered");
  assert.deepEqual(pinned({ count: 1, match: { correlationId: PERIOD } }), [], "the value the criterion states");
  assert.deepEqual(pinned({ count: 1, match: { correlationId: "${DUE}" } }), [], "a value a binding fills is no literal");
  assert.deepEqual(pinned({ count: 1, match: { messageId: "msg-1" } }), [], "another field than the one the criterion rules on");
  const answered = (match) => refused(design([attempts({ match })], [["FIX-ASYNC-1/E3", 1]]), "completes-by-deadline");
  assert.deepEqual(answered({ outcome: "duplicate" }), ["MATCH_PINS"], "a match that picks the answer leaves only what it names there, with or without a count");
  assert.deepEqual(answered({ outcome: "processed" }), []);
  const blind = contradictionFindings(design([awaited({ count: 1, match: { correlationId: OTHER } })], [["FIX-ASYNC-1/E1", 1]]), { expectations: ACCEPTED, shape: shapeOf("completes-by-deadline"), requestTableOf: () => ({ match: { type: "object", fields: { correlationId: { type: "string", doc: "x" } }, doc: "x" } }) });
  assert.deepEqual(blind, [], "an adapter that does not say what a match field is compared with, or what its match picks, rules out nothing");
});

test("a second message under a business key is held apart from the first only in an effect-once-per-key design, and only by the settlement the first is held to", () => {
  const ONCE = "effect-once-per-key";
  const steps = [publish("msg-1"), publish("msg-2"), attempts({ count: 1, match: { messageId: "msg-1" } }), attempts({ count: 1, match: { messageId: "msg-2" } })];
  assert.deepEqual(refused(design(steps, [["FIX-ASYNC-1/E3", 3], ["FIX-ASYNC-1/E3", 4]]), ONCE), ["SECOND_SETTLED"]);
  assert.deepEqual(refused(design(steps, [["FIX-ASYNC-1/E3", 3], ["FIX-ASYNC-1/E3", 4]]), "completes-by-deadline"), [], "another obligation's subject is not this rule's");
  assert.deepEqual(refused(design([publish("msg-1"), publish("msg-1"), attempts({ count: 2, match: { messageId: "msg-1" } })], [["FIX-ASYNC-1/E3", 3]]), ONCE), [], "the same message published twice is no second message");
  assert.deepEqual(refused(design([publish("msg-1"), publish("msg-2", OTHER), ...steps.slice(2)], [["FIX-ASYNC-1/E3", 3], ["FIX-ASYNC-1/E3", 4]]), ONCE), [], "two business keys are two effects");
  assert.deepEqual(refused(design(steps, [["FIX-ASYNC-1/E3", 3], ["FIX-ASYNC-1/E4", 4]]), ONCE), ["NEVER_REDELIVERED"], "the second ruled by its delivery, not by how it settled -- yet waiting for its SECOND delivery, which nothing here causes, is refused by its own rule");
  assert.deepEqual(advised(design(steps, [["FIX-ASYNC-1/E3", 4]]), ONCE), ["SECOND_SETTLES"], "the second alone held to a settlement may be what a criterion states of it: said");
  const unnamed = [publish("msg-1"), publish("msg-2"), attempts({ count: 1 }), attempts({ count: 1, match: { messageId: "msg-2" } })];
  assert.deepEqual(refused(design(unnamed, [["FIX-ASYNC-1/E3", 3], ["FIX-ASYNC-1/E3", 4]]), ONCE), [], "an observation not narrowed to the first message holds nothing to it");
  const keyless = (id) => call("orbit.messaging.publish", { channelRef: "billing-reminder-requested", request: { messageId: id, correlationId: KEY, payload: { messageId: id } } });
  assert.deepEqual(refused(design([keyless("msg-1"), keyless("msg-2"), ...steps.slice(2)], [["FIX-ASYNC-1/E3", 3], ["FIX-ASYNC-1/E3", 4]]), ONCE), [], "a correlation is not a business key: a design that names none is held to nothing here");
});

// A wait for the period's request on the channel the design publishes it on itself (ORBIT-QA-007, ORBIT-TOOL-001).
const armed = (observerRef = "requested") => call("orbit.messaging.observe", { channelRef: "billing-reminder-requested", observerRef, request: {} });
const SELF = [armed(), publish("msg-1", PERIOD), awaited({ count: 1, match: { correlationId: PERIOD } }), attempts({ count: 1, match: { messageId: "msg-1" } })];
const selfOf = (steps, stack = "invoice-a") => [refused(design(steps, [["FIX-ASYNC-1/E1", 3], ["FIX-ASYNC-1/E3", 4]]), "completes-by-deadline", stack), advised(design(steps, [["FIX-ASYNC-1/E1", 3], ["FIX-ASYNC-1/E3", 4]]), "completes-by-deadline", stack)];
const at = (steps, i, over) => steps.map((s, n) => (n === i ? over(s) : s));
const asking = (s, request) => ({ ...s, input: { ...s.input, request } });

test("a wait for a value the design's own publication put where its observer looks is refused only where every link is declared or shown -- said where one is not", () => {
  assert.deepEqual(selfOf(SELF), [["SELF_SATISFIED"], []], "armed before, on its channel, set by a field its adapter says it sets, dropped by nothing, read by nothing else first, answered");
  assert.deepEqual(selfOf(SELF, "invoice-b"), [[], ["SELF_PUBLISHED"]], "a channel that drops a message id it saw in its window may never carry this one: said");
  assert.deepEqual(selfOf([SELF[1], SELF[0], ...SELF.slice(2)]), [[], ["SELF_PUBLISHED"]], "an observer armed after the publication need not see it");
  assert.deepEqual(selfOf(at(SELF, 1, (s) => asking(s, { ...s.input.request, routingKey: "billing.reminder.other" }))), [[], ["SELF_PUBLISHED"]], "a publication that names its own route need not reach the observer");
  assert.deepEqual(selfOf(at(SELF, 0, (s) => asking(s, { prefetch: 1 }))), [[], ["SELF_PUBLISHED"]], "an observer whose request narrows what it sees");
  const readFirst = design([...SELF.slice(0, 2), awaited({ count: 1 }), ...SELF.slice(2)], [["FIX-ASYNC-1/E1", 4], ["FIX-ASYNC-1/E3", 5]]);
  assert.deepEqual([refused(readFirst, "completes-by-deadline"), advised(readFirst, "completes-by-deadline")], [[], ["SELF_PUBLISHED"]], "an earlier await on that observer may have read it first");
  assert.deepEqual(selfOf(at(SELF, 2, (s) => asking(s, { count: 1, match: { messageId: "msg-2" } }))), [["SELF_SATISFIED"], []], "a match whose count ends the wait answers every message it reads");
  assert.deepEqual(selfOf(at(SELF, 1, (s) => asking(s, { ...s.input.request, correlationId: OTHER }))), [[], []], "another value is no value of its own");
  assert.deepEqual(selfOf(at(SELF, 0, (s) => ({ ...s, input: { ...s.input, channelRef: "billing-reminder-sent" } }))), [[], []], "an observer of another channel waits for what the system sends there");
  assert.deepEqual(selfOf(at(SELF, 1, (s) => asking(s, { ...s.input.request, correlationId: "${PERIOD}" }))), [[], []], "a value a binding fills is no literal");
  const triggered = [armed(), call("orbit.clock.advance", { clockRef: "invoice-a", request: { to: "2026-10-22T09:00:00+07:00" } }), ...SELF.slice(2)];
  assert.deepEqual(selfOf(triggered), [[], []], "the clock brought the period about: the message awaited is the system's");
  const settles = [armed(), publish("msg-1", PERIOD), attempts({ count: 1, match: { messageId: "msg-1" } })];
  assert.deepEqual([refused(design(settles, [["FIX-ASYNC-1/E3", 3]]), "completes-by-deadline"), advised(design(settles, [["FIX-ASYNC-1/E3", 3]]), "completes-by-deadline")], [[], []], "its own trigger published and ITS processing awaited: how it settles is the system's word");
  const blind = contradictionFindings(design(SELF, [["FIX-ASYNC-1/E1", 3]]), { ...contextOn("invoice-a", design(SELF, []), "completes-by-deadline"), requestTableOf: (i) => (i === 2 ? { messageId: { type: "string" }, correlationId: { type: "string" } } : operationOn("invoice-a", SELF[i - 1].capability)?.request) });
  assert.deepEqual(blind, [], "an adapter that does not say which field of the message its publication sets shows nothing");
});

const recorded = (d, shape, investigation, stack = "invoice-a") => contradictionFindings(d, { ...contextOn(stack, d, shape), investigation }).map((f) => f.rule);

test("a message under a business key an earlier SATISFIED test of the investigation settled is refused only where that test's own record shows it, and its plan holds the system to one effect per key", () => {
  const settled = (id, key = KEY, ref = "FIX-ASYNC-1/E3") => design([publish(id, key), attempts({ count: 1, match: { messageId: id } })], [[ref, 2]]);
  const earlier = [{ shape: "completes-by-deadline", design: settled("msg-1") }];
  assert.deepEqual(recorded(settled("msg-2"), "completes-by-deadline", proven("invoice-a", earlier)), ["SETTLED_BEFORE"]);
  assert.deepEqual(recorded(settled("msg-2"), "completes-by-deadline", proven("invoice-b", earlier), "invoice-b"), ["SETTLED_BEFORE"], "on the other stack's broker as on this one's");
  assert.deepEqual(recorded(settled("msg-2"), "effect-once-per-key", proven("invoice-a", earlier)), ["SETTLED_BEFORE"], "whatever this design's own obligation is");
  assert.deepEqual(recorded(settled("msg-2"), "completes-by-deadline", proven("invoice-a", earlier, ["completes-by-deadline"])), [], "a plan that holds the system to no one effect per key proves no duplicate");
  assert.deepEqual(recorded(settled("msg-2"), "completes-by-deadline", proven("invoice-a", [])), [], "nothing earlier ran SATISFIED");
  assert.deepEqual(recorded(settled("msg-2", OTHER), "completes-by-deadline", proven("invoice-a", earlier)), [], "another business key is another effect");
  assert.deepEqual(recorded(settled("msg-1"), "completes-by-deadline", proven("invoice-a", earlier)), [], "the same message is never a second one");
  const otherwise = new Map([...ACCEPTED, ["X/E1", { id: "E1", property: "settlement.outcome", op: "complete-within", value: "duplicate", within: 60, for: [] }]]);
  const asDuplicate = settled("msg-2", KEY, "X/E1");
  assert.deepEqual(contradictionFindings(asDuplicate, { ...contextOn("invoice-a", asDuplicate, "completes-by-deadline", otherwise), investigation: proven("invoice-a", earlier) }), [], "held to another settlement than the one the earlier message met");
  const unnarrowed = [{ shape: "completes-by-deadline", design: design([publish("msg-1"), attempts({ count: 1, match: { outcome: "processed" } })], [["FIX-ASYNC-1/E3", 2]]) }];
  assert.deepEqual(recorded(settled("msg-2"), "completes-by-deadline", proven("invoice-a", unnarrowed)), [], "an earlier observation not narrowed to its own message shows nothing of that message");
  assert.deepEqual(contradictionAdvice(settled("msg-2"), { ...contextOn("invoice-a", settled("msg-2"), "completes-by-deadline"), investigation: proven("invoice-a", earlier) }).map((f) => f.rule), [], "a refusal, never advice");
});

test("a later delivery is refused where nothing in the design or its shape brings one, said where only its shape may, and a decision said only where nothing moves the clock, and a decision only where nothing moves the clock", () => {
  const second = [publish("msg-1"), attempts({ count: 1, match: { messageId: "msg-1" } })];
  assert.deepEqual([refused(design(second, [["FIX-ASYNC-1/E4", 2]]), "effect-once-per-key"), advised(design(second, [["FIX-ASYNC-1/E4", 2]]), "effect-once-per-key")], [["NEVER_REDELIVERED"], []], "a shape that declares no way a delivery comes back: refused");
  assert.deepEqual([refused(design(second, [["FIX-ASYNC-1/E4", 2]]), "lease-expiry-fencing"), advised(design(second, [["FIX-ASYNC-1/E4", 2]]), "lease-expiry-fencing")], [[], ["UNCAUSED_REDELIVERY"]], "one whose shape declares a lease or an ack wait may yet see one come back: said, never refused");
  const faulted = [call("orbit.workload.control", { workloadRef: "worker", request: { action: "fault", point: "before-effect" } }), ...second];
  assert.deepEqual(advised(design(faulted, [["FIX-ASYNC-1/E4", 3]]), "crash-before-effect"), [], "a fault interrupts the first delivery");
  assert.deepEqual(advised({ ...design(second, []), assertions: [{ criterionRef: "X/E1", template: "complete", step: 2 }] }, "effect-once-per-key"), [], "a slot no accepted criterion states says nothing here");
  const once = new Map([...ACCEPTED, ["X/E1", { id: "E1", property: "delivery.attempt", op: "complete-within", value: 1, within: 60, for: [] }]]);
  assert.deepEqual(contradictionAdvice(design(second, [["X/E1", 2]]), contextOn("invoice-a", design(second, []), "effect-once-per-key", once)), [], "its first delivery needs no cause");
  const occurrence = "billing-daily:2026-10-22T09:00:00+07:00";
  const watched = [decisions({ count: 1, match: { occurrenceId: occurrence } })];
  assert.deepEqual([refused(design(watched, [["SCHED-1/E1", 1]]), "occurrence-one-execution"), advised(design(watched, [["SCHED-1/E1", 1]]), "occurrence-one-execution")], [["NEVER_DECIDED"], []], "an injected clock nothing here or earlier moved: refused");
  const triggered = design([call("orbit.scheduler.trigger", { scheduleRef: "billing-daily", request: { occurrenceId: occurrence } }), ...watched], [["SCHED-1/E1", 2]]);
  assert.deepEqual(refused(triggered, "occurrence-one-execution"), ["NEVER_DECIDED"], "a trigger proves the handler, never the schedule");
  const moved = proven("invoice-a", [{ shape: "occurrence-one-execution", design: design([call("orbit.clock.advance", { clockRef: "invoice-a", request: { to: "2026-10-22T09:00:00+07:00" } })], []), outcome: "CONTRADICTED" }]);
  assert.deepEqual([recorded(design(watched, [["SCHED-1/E1", 1]]), "occurrence-one-execution", moved), contradictionAdvice(design(watched, [["SCHED-1/E1", 1]]), { ...contextOn("invoice-a", design(watched, []), "occurrence-one-execution"), investigation: moved }).map((f) => f.rule)], [[], ["UNCAUSED_DECISION"]], "an earlier version that ran -- to any word -- moved the clock: said, never refused");
  const blind = { ...contextOn("invoice-a", design(watched, []), "occurrence-one-execution"), semanticsFor: () => null };
  assert.deepEqual([contradictionFindings(design(watched, [["SCHED-1/E1", 1]]), blind).map((f) => f.rule), contradictionAdvice(design(watched, [["SCHED-1/E1", 1]]), blind).map((f) => f.rule)], [[], ["UNCAUSED_DECISION"]], "a clock no adapter declares injected may be real time: said");
  assert.deepEqual(advised(design([call("orbit.clock.advance", { clockRef: "invoice-a", request: { to: "2026-10-22T09:00:00+07:00" } }), ...watched], [["SCHED-1/E1", 2]]), "occurrence-one-execution"), [], "the clock moved to it");
  assert.ok(CONTRADICTION_RULES.filter((r) => !r.refuses).every((r) => !contradictionFindings(design(watched, [["SCHED-1/E1", 1]]), contextOn("invoice-a", design(watched, []), "occurrence-one-execution")).some((f) => f.rule === r.id)), "advice never refuses");
});

// ── what the old benchmark's controls sent ──────────────────────────────────────────────────────────────────────────

// Every design the 0.5.0 benchmark's scripted QA and sessions hosts sent, per case and control, as they were captured
// before the benchmark's removal (test/fixtures/qa-designs/sent.json).
test("no design a benchmark control sent is refused or advised by these rules, each held to every one it sent before as run SATISFIED -- the false alarm the false-alarm control planted is not one a design shows", () => {
  assert.ok(SENT.cases.length >= 10, "every QA and sessions case");
  const said = SENT.cases.flatMap((c) => c.controls.flatMap((k) => sentOf(k).flatMap(({ shape, design: d }, n, all) => [...recorded(d, shape, proven(c.stack, all.slice(0, n)), c.stack), ...advised(d, shape, c.stack)].map((rule) => `${c.id} ${k.host} ${shape}: ${rule}`))));
  assert.deepEqual(said, []);
  const sentBy = Object.fromEntries([...new Set(SENT.cases.flatMap((c) => c.controls.map((k) => k.host)))].sort().map((host) => [host, Math.max(...SENT.cases.flatMap((c) => c.controls.filter((k) => k.host === host).map((k) => k.sent.length)))]));
  assert.deepEqual(sentBy, { cheat: 0, "false-alarm": 9, half: 9, idle: 0, recovers: 9, reference: 9, repeats: 9, "trusts-poison": 6, "trusts-stale": 9, uncorrected: 9 }, "each host's designs, one per shape it tests");
  const broken = sentOf(SENT.cases.find((c) => c.id === "ORBIT-QA-001").controls.find((k) => k.host === "false-alarm")).filter((s) => s.shape === "effect-once-per-key");
  assert.equal(broken.length, 1, "the false-alarm control sent its broken design, made like any other");
  assert.match(JSON.stringify(broken[0].design), /never written/, "a read-back of a record no step writes: a contradiction the clean application shows, and no design can");
});

test("every reference design, on each stack and with each clock its stack allows, is held to none of these rules", () => {
  const designs = references();
  assert.ok(designs.length >= 20);
  assert.deepEqual(designs.flatMap((x) => [...refused(x.design, x.shape, x.stack), ...advised(x.design, x.shape, x.stack)].map((rule) => `${x.label}: ${rule}`)), []);
});

// The playbook's worked designs (skills/orbit-qa/references/designs.md) are what a host starts from: none may be held to
// any of these rules, refused or said, on the slots each says it assumes.
test("no worked design the playbook shows is held to any of these rules", () => {
  assert.ok(WORKED.length >= 20);
  const held = (w) => ((cx) => [...contradictionFindings(w.design, cx), ...contradictionAdvice(w.design, cx)].map((f) => `${w.shape}: ${f.rule}`))(contextOn("invoice-a", w.design, w.shape, new Map(Object.entries(w.accepted))));
  assert.deepEqual(WORKED.flatMap(held), []);
});

// ── what the declarations say ───────────────────────────────────────────────────────────────────────────────────────

const vocab = { fields: new Map(), notes: [], problems: [] };
const declaring = (match) => ({ id: "queue.reference", apiVersion: "orbit.adapter/v1", version: "1.0.0", doc: "x", family: "messaging", transports: ["amqp-0-9-1"], helper: { argv: ["helper.mjs"] }, operations: { "observe.await": { effects: ["read"], outputs: { messages: { each: { id: "message.id" } } }, request: { match } } } });

test("a match row may say what it picks and each of its fields what it is compared with -- a meaning, and one of the two ways a match picks", () => {
  const problems = (match) => declarationFindings(declaring(match), vocab).problems.join("\n");
  assert.equal(problems({ type: "object", selects: "count", fields: { messageId: { type: "string", means: "message.id", doc: "x" } }, doc: "x" }), "");
  assert.match(problems({ type: "object", fields: { messageId: { type: "string", means: "broker.messageId", doc: "x" } }, doc: "x" }), /match\.messageId means "broker\.messageId", which is not a meaning/);
  assert.match(problems({ type: "object", selects: "all", fields: {}, doc: "x" }), /selects must be answer or count/);
  assert.deepEqual(MATCH_SELECTS, ["answer", "count"]);
});

test("every field a shipped messaging adapter's publication sends as the message's own says which field it sets -- a meaning its observers' answers carry", () => {
  for (const a of ADAPTERS.filter((x) => x.family === "messaging")) {
    const items = meaningEntries(a.operations["observe.await"].outputs).filter(([path]) => path.includes("[].")).map(([, means]) => means);
    const sets = Object.entries(a.operations.publish.request).filter(([, row]) => row.means);
    assert.deepEqual(sets.map(([k]) => k).sort(), ["correlationId", "messageId", a.id === "amqp.reference" ? "routingKey" : "subject"].sort(), a.id);
    for (const [k, row] of sets) assert.ok(items.some((means) => row.means === means || row.means.startsWith(`${means}.`)) && meaningAt(row.means), `${a.id} publish ${k} means ${row.means}`);
    assert.ok(["none", "id-window"].includes(a.semantics.publishDedupe), `${a.id} says whether its channel drops a message id it saw`);
  }
});

test("every match field a shipped adapter compares says what it is compared with -- a meaning its own answer's items carry -- and every match says what it picks", () => {
  const matched = ADAPTERS.flatMap((a) => Object.entries(a.operations).filter(([, o]) => o.request?.match?.fields).map(([op, o]) => ({ at: `${a.id} ${op}`, match: o.request.match, items: meaningEntries(o.outputs).filter(([path]) => path.includes("[].")).map(([, means]) => means) })));
  assert.deepEqual(matched.map((m) => m.at).sort(), ["amqp.reference observe.await", "jetstream.reference observe.await", "scheduler.hooks observe", "worker.hooks observe"]);
  for (const m of matched) {
    assert.ok(MATCH_SELECTS.includes(m.match.selects), m.at);
    for (const [k, row] of Object.entries(m.match.fields)) assert.ok(m.items.some((means) => row.means === means || row.means.startsWith(`${means}.`)) && meaningAt(row.means), `${m.at} match.${k} means ${row.means}, which its answer's items carry`);
  }
});
