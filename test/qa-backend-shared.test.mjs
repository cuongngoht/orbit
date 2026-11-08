// What the tests of ONE investigation share (0.4.0): the sandbox they all run in, and so its state. What a real Claude
// Code QA row taught (ORBIT-QA-006 on Opus): its effect-once test published two messages under the business key of a
// period the schedule would reach, and its deadline test, later in the same investigation, made the schedule reach that
// period and waited for the period's message to be processed -- which the clean application settled as the duplicate it
// was, a false alarm. A host is told before it designs; a design that names a key, a message or an occurrence an earlier
// version of the investigation named is told so after -- and nothing is refused, because a test may observe on purpose
// what an earlier one left.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MESSAGE_FIELDS, SCHEDULE_FIELDS } from "../src/qa/backend/bindings.mjs";
import { KEY_WORDS, ONE_SANDBOX, keysOf, sharedWith, statedFor } from "../src/qa/backend/shared.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const call = (capability, input) => ({ do: "call", capability, input });
const skeleton = (steps) => ({ skeleton: { steps } });

const KEY = "tenant-a|inv-a|billing-daily:2026-10-22T09:00:00+07:00";
const PERIOD = "billing-daily:2026-10-22T09:00:00+07:00";
const publish = (messageId) => call("orbit.messaging.publish", { channelRef: "billing-reminder-requested", request: { messageId, correlationId: KEY, payload: { messageId, invoiceId: "inv-a", tenantId: "tenant-a", occurrenceId: PERIOD, businessKey: KEY } } });

// The two designs the host proposed, as far as this is about: the effect-once test's two messages under one business key,
// and the deadline test that made the schedule reach that very period and awaited its message.
const HOST_ONCE = skeleton([publish("msg-host-0007b"), publish("msg-host-0007c"), call("orbit.worker.observe", { workloadRef: "worker", request: { match: { messageId: "msg-host-0007c" } } }), call("orbit.state.read", { stateRef: "reminders", request: { key: KEY } })]);
const HOST_DEADLINE = skeleton([
  call("orbit.messaging.observe", { channelRef: "billing-reminder-requested", observerRef: "due", request: {} }),
  call("orbit.clock.advance", { clockRef: "invoice-a", request: { to: "2026-10-22T09:00:00+07:00" } }),
  call("orbit.observe.await", { observerRef: "due", request: { count: 1, match: { correlationId: KEY } } }),
  call("orbit.worker.observe", { workloadRef: "worker", request: { match: { messageId: "${DUE}", outcome: "processed" } } }),
]);

test("the words a key is named by are the backend vocabulary's own -- the business operation, the message, the period -- and never a routing key", () => {
  assert.deepEqual(KEY_WORDS.filter((k) => !(k in MESSAGE_FIELDS) && !(k in SCHEDULE_FIELDS)), [], "every one a field of the message or the schedule a binding records");
  assert.equal(KEY_WORDS.includes("key"), false, "a routing or partition key many messages share is no collision");
  assert.equal(KEY_WORDS.includes("causationId"), false, "nor is what caused a message");
});

test("a design's keys are the literals its requests name under those words, at any depth -- never a value a binding fills, and never another word", () => {
  assert.deepEqual([...keysOf(HOST_ONCE)], [["msg-host-0007b", ["messageId"]], [KEY, ["correlationId", "businessKey"]], [PERIOD, ["occurrenceId"]], ["msg-host-0007c", ["messageId"]]], "the publication's own, its payload's and an observation's match alike");
  assert.deepEqual([...keysOf(HOST_DEADLINE)], [[KEY, ["correlationId"]]], "a clock's instant, an outcome and a ${…} binding are none");
  assert.deepEqual([...keysOf(skeleton([call("orbit.state.read", { stateRef: "s", request: { key: KEY, match: { routingKey: "r", causationId: "c", outcome: "processed" } } })]))], [], "a state's key column, a routing key, a cause and a settlement name no business operation here");
  const deep = (n) => (n === 0 ? { messageId: "msg-deep" } : { nested: deep(n - 1) });
  assert.deepEqual([...keysOf(skeleton([call("orbit.messaging.publish", { request: deep(6) })]))].map(([v]) => v), ["msg-deep"]);
  assert.deepEqual([...keysOf(skeleton([call("orbit.messaging.publish", { request: deep(9) })]))], [], "the walk is bounded");
  assert.deepEqual([...keysOf(skeleton([{ do: "goto", path: "/" }, call("orbit.messaging.publish", { request: { messageId: "" } })]))], [], "a step that requests nothing, and an empty value, name none");
  assert.deepEqual([...keysOf({})], [], "a design with no skeleton names none");
});

test("a design that names a key an earlier version of its investigation named is told which version, which obligation and shape, and under which words", () => {
  const earlier = [{ version: "gen-once@0123456789abcdef", obligation: "tob-once", shape: "effect-once-per-key", design: HOST_ONCE }];
  const [shared, ...more] = sharedWith(HOST_DEADLINE, earlier);
  assert.equal(more.length, 0);
  assert.deepEqual([shared.version, shared.obligation, shared.shape, shared.keys], ["gen-once@0123456789abcdef", "tob-once", "effect-once-per-key", [{ value: KEY, as: ["correlationId"] }]]);
  assert.equal(shared.say, `correlationId ${KEY} — named by gen-once@0123456789abcdef (effect-once-per-key) of this investigation too: both run in its one sandbox, and whichever runs later finds what the other left there — use one no earlier test used, unless what is already there is what this test observes`);
  assert.equal("design" in shared, false, "the earlier design is never echoed");
  assert.deepEqual(sharedWith(HOST_ONCE, []), [], "nothing earlier, nothing shared");
  const apart = skeleton([publish("msg-host-0009a")].map((s) => JSON.parse(JSON.stringify(s).replaceAll("2026-10-22", "2026-10-29"))));
  assert.deepEqual(sharedWith(apart, earlier), [], "keys no earlier test used share nothing");
  assert.match(sharedWith(HOST_DEADLINE, [{ ...earlier[0], shape: null }])[0].say, /named by gen-once@0123456789abcdef \(tob-once\)/, "an obligation whose shape is unknown is named by its id");
});

// What 0.4.0's last fixes left open (0.5.0 B7): a key an accepted criterion states FOR another shape -- the deadline
// test's own correlation, say -- was said only when the second design named it again, after the first had used it. A
// criterion that states a value for a shape gives that value to that shape's test: it is said at the FIRST design that
// names it, before any version of the other test exists. Advice, never a refusal.
const STATED = new Map([
  ["SLA-1/E1", { id: "E1", property: "message.correlation.correlationId", op: "complete-within", value: KEY, for: ["completes-by-deadline"], within: 120 }],
  ["SLA-1/E2", { id: "E2", property: "effect.count", op: "count-eq", value: 1 }],
  ["SLA-1/E3", { id: "E3", property: "settlement.outcome", op: "complete-within", value: "processed", for: ["completes-by-deadline"], within: 120 }],
]);

test("a key an accepted criterion states for another shape is said at the first design that names it, under the words it was named by", () => {
  const [stated, ...more] = statedFor(HOST_ONCE, "effect-once-per-key", STATED);
  assert.equal(more.length, 0, "a value no key word names -- an outcome -- is no key");
  assert.deepEqual([stated.criterion, stated.shape, stated.keys], ["SLA-1/E1", "completes-by-deadline", [{ value: KEY, as: ["correlationId", "businessKey"] }]]);
  assert.equal(stated.say, `correlationId/businessKey ${KEY} — an accepted criterion (SLA-1/E1) states it for completes-by-deadline: that test observes it, and every test of this investigation runs in its one sandbox — use one no accepted criterion states for another test, unless what that test leaves is what this one observes`);
  assert.deepEqual(statedFor(HOST_DEADLINE, "completes-by-deadline", STATED), [], "the test it is stated for is the one that uses it");
  assert.deepEqual(statedFor(HOST_ONCE, "effect-once-per-key", new Map([["X/E1", { ...STATED.get("SLA-1/E1"), for: [] }]])), [], "stated for no obligation, it is given to none");
  assert.deepEqual(statedFor(HOST_ONCE, "effect-once-per-key", new Map([["X/E1", { ...STATED.get("SLA-1/E1"), for: undefined }]])), [], "stated for every shape its op rules with, it is no one test's");
  assert.deepEqual(statedFor(HOST_ONCE, "effect-once-per-key", new Map([["X/E1", { ...STATED.get("SLA-1/E1"), for: ["effect-once-per-key", "completes-by-deadline"] }]])), [], "stated for this shape too, it is this test's to use");
  assert.deepEqual(statedFor(skeleton([publish("msg-host-0009a")].map((s) => JSON.parse(JSON.stringify(s).replaceAll("2026-10-22", "2026-10-29")))), "effect-once-per-key", STATED), [], "a key the criterion does not state is nobody else's");
});

// The reference designs (acceptance/designs/) are what the benchmark's scripted controls send, in their order, in ONE
// investigation: each stack's own clock, each design as the reference host makes it.
const truth = JSON.parse(readFileSync(join(ROOT, "acceptance", "truth.json"), "utf8"));
const DESIGNS = join(ROOT, "acceptance", "designs");
const referenceOn = (stack) => readdirSync(DESIGNS).filter((f) => f.endsWith(".json")).map((f) => ({ shape: f.slice(0, -5), ...JSON.parse(readFileSync(join(DESIGNS, f), "utf8")) })).sort((a, b) => a.order - b.order).map((d) => ({ shape: d.shape, design: JSON.parse(JSON.stringify({ ...d.design, ...(d["by-clock"]?.[truth.stacks[stack].clock] ?? {}) }).replaceAll("{{component}}", stack)) }));
const inOrder = (designs) => designs.flatMap((d, i) => sharedWith(d.design, designs.slice(0, i).map((e) => ({ version: e.shape, obligation: e.shape, shape: e.shape, design: e.design }))).map((s) => [d.shape, s.shape, s.keys.map((k) => k.value)]));

test("the reference designs, sent in order in one investigation, use their own keys -- and only the occurrence test reads the period the deadline test made due by hand, which is what it observes", () => {
  for (const stack of ["invoice-a", "invoice-b"]) assert.deepEqual(referenceOn(stack).map((d) => d.shape), truth.shapes, `${stack}: a design for every shape the ground truth holds, in its order`);
  assert.deepEqual(inOrder(referenceOn("invoice-a")), [], "the stack whose clock moves: every test its own keys");
  assert.deepEqual(inOrder(referenceOn("invoice-b")), [["occurrence-one-execution", "completes-by-deadline", [PERIOD]]], "the stack whose clock cannot move triggers that period by hand first");
});

test("what a host reads before it designs says that the tests of one investigation share the sandbox's state", () => {
  assert.match(ONE_SANDBOX, /^the tests of one investigation run one after another in the same sandbox and share its state: an effect, a key or a scheduled occurrence a test used stays there for the next test\./);
  assert.match(ONE_SANDBOX, /a design uses business keys, message ids and occurrences no earlier test of this investigation used, none an accepted criterion states for another test, and none a schedule will produce on its own once its clock reaches them, unless that is what the test observes$/);
});
