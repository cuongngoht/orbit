// The rules a backend test's design is held to before it may run (doc §5.9, §5.3; PBI 10): an
// observer armed before the trigger and never taking the application's messages, every await of
// an armed observer and by identity, a window only from an accepted criterion, a clock moved only
// where an adapter can inject one, and no verdict text in a skeleton.
import assert from "node:assert/strict";
import { test } from "node:test";
import { correlationFindings } from "../src/qa/backend/correlation.mjs";
import { NON_STEALING, observationFindings } from "../src/qa/backend/observations.mjs";
import { temporalFindings } from "../src/qa/backend/temporal.mjs";

const call = (capability, input) => ({ do: "call", capability, input });
const arm = call("orbit.messaging.observe", { channelRef: "invoice-events", observerRef: "obs-1", fixtureRef: "fx" });
const trigger = call("orbit.scheduler.trigger", { scheduleRef: "billing-daily" });
const publish = call("orbit.messaging.publish", { channelRef: "invoice-commands", request: { messageId: "m-1" } });
const awaitIt = (request = { match: { messageId: "m-1" }, count: 1 }) => call("orbit.observe.await", { observerRef: "obs-1", request });

const design = (steps, triggerAt = 2) => ({ skeleton: { steps }, trigger: { kind: "schedule", ref: "billing-daily", step: triggerAt } });
const SHADOW = { semanticsOf: () => ({ observation: ["shadow-subscription"] }) };
const rules = (out) => out.map((f) => f.rule);

test("a well-formed plan -- armed, then triggered, then awaited by identity through a non-stealing adapter -- has no finding", () => {
  const d = design([arm, trigger, awaitIt()]);
  assert.deepEqual([...observationFindings(d, SHADOW), ...correlationFindings(d), ...temporalFindings(d, SHADOW)], []);
  assert.ok(NON_STEALING.includes("independent-cursor"));
});

test("an observer armed at or after the trigger saw nothing that came before it", () => {
  assert.deepEqual(rules(observationFindings(design([trigger, arm, awaitIt()], 1), SHADOW)), ["ARMED_BEFORE_TRIGGER"]);
  assert.deepEqual(rules(observationFindings({ skeleton: { steps: [arm, trigger, awaitIt()] } }, SHADOW)), ["ARMED_BEFORE_TRIGGER"], "no trigger step named");
});

test("an await of an observer nobody armed earlier is refused", () => {
  assert.deepEqual(rules(observationFindings(design([trigger, awaitIt()], 1), SHADOW)), ["AWAIT_ARMED"]);
  const planned = { ...design([trigger, awaitIt()], 1), observationPlan: [{ observerRef: "obs-1", channelRef: "invoice-events" }] };
  assert.deepEqual(observationFindings(planned, { observerSemantics: () => ({ observation: ["independent-cursor"] }) }), [], "an observer the plan arms at prepare is armed before any step");
  assert.deepEqual(rules(observationFindings(planned, { observerSemantics: () => ({}) })), ["NON_STEALING"]);
});

test("an adapter that takes messages, or does not say how it observes, never arms an observer", () => {
  assert.deepEqual(rules(observationFindings(design([arm, trigger, awaitIt()]), { semanticsOf: () => ({ observation: "unknown" }) })), ["NON_STEALING"]);
  assert.deepEqual(rules(observationFindings(design([arm, trigger, awaitIt()]), { semanticsOf: () => ({}) })), ["NON_STEALING"]);
});

test("a publication carries its logical id, and an await matches by identity -- never by a payload that looks the same", () => {
  const d = design([arm, call("orbit.messaging.publish", { channelRef: "c", request: { payload: {} } }), awaitIt({ match: { routingKey: "invoice.created" } })]);
  assert.deepEqual(rules(correlationFindings(d)), ["PUBLISH_IDENTIFIED", "AWAIT_BY_IDENTITY"]);
  assert.deepEqual(correlationFindings(design([arm, publish, awaitIt({ match: { correlationId: "c-1" } })])), []);
});

test("a window is never proposed, a clock moves only where it can be injected, and a skeleton holds no verdict", () => {
  const d = design([arm, trigger, awaitIt({ match: { messageId: "m-1" }, waitMs: 500 }), call("orbit.clock.advance", { clockRef: "clock", request: { to: "2026-10-22T09:00:00+07:00" } }), { do: "call", capability: "orbit.state.read", input: { stateRef: "invoices" }, expect: "it.count === 1" }]);
  assert.deepEqual(rules(temporalFindings(d, { semanticsOf: (i) => (i === 4 ? { clockInjection: "none" } : {}) })), ["WINDOW_FROM_SOURCE", "CLOCK_INJECTABLE", "NO_VERDICT_TEXT"]);
  assert.deepEqual(rules(temporalFindings(design([call("orbit.clock.advance", { clockRef: "clock", request: {} })], 1), { semanticsOf: () => ({ clockInjection: "live" }) })), []);
});

test("only a control's witness may wait within its own bound -- any other window is compiled from an accepted criterion", () => {
  const witness = { do: "call", capability: "orbit.worker.observe", input: { workloadRef: "w", request: { count: 1, waitMs: 30_000 } } };
  const design = (controls) => ({ skeleton: { steps: [witness] }, controls });
  assert.deepEqual(temporalFindings(design([{ role: "fault", point: "p", step: 1 }])), [], "a fault's witness waits for what the control injects; failing there is never a contradiction");
  assert.match(temporalFindings(design([{ role: "fault", point: "p" }])).map((f) => f.say).join(), /sets its own window/);
  assert.match(temporalFindings(design([{ role: "positive", point: "p", step: 1 }])).map((f) => f.say).join(), /sets its own window/, "only a FAULT control's witness waits within its own bound");
  assert.match(temporalFindings({ ...design([{ role: "fault", point: "p", step: 1 }]), assertions: [{ criterionRef: "X/E1", template: "complete", step: 1 }] }).map((f) => f.say).join(), /sets its own window/, "a step a criterion rules on waits within that criterion's window, whoever names it");
});
