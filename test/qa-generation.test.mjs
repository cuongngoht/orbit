// A generated test, from a design proposal to the case that runs (doc §4.1 steps 3-4; PBI 11): the
// proposal is held whole -- its contract, the controls its shape needs, the asynchronous rules,
// the mapping of every assertion to an ACCEPTED criterion -- and the case the engine assembles is
// validated with the real grammar and every call's input against its capability. A repair may
// change how a test is written, never what it rules on.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { requestFindings } from "../src/adapters/contract-v1.mjs";
import { familyCapabilities } from "../src/adapters/core.mjs";
import { operationFor } from "../src/adapters/families.mjs";
import { opKeyOf } from "../src/adapters/select.mjs";
import { graphOf } from "../src/architecture/graph-view.mjs";
import { inputFindings } from "../src/capability/invoke.mjs";
import { CORE } from "../src/dsl/registry.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { compileDesign } from "../src/qa/generation/compile.mjs";
import { CONTROL_RULES, controlFindings } from "../src/qa/generation/controls.mjs";
import { generatedCase } from "../src/qa/generation/design.mjs";
import { repairFindings } from "../src/qa/generation/repair.mjs";
import { shapeOf } from "../src/qa/obligations/shapes.mjs";
import { VERIFICATION_OUTCOME_IDS } from "../src/investigation/verification.mjs";
import { bindableFrom } from "../src/runtime/sandbox/declarations.mjs";
import { realIo } from "../src/store/io.mjs";
import { catalogLayer, mergeVocabulary } from "../src/topology/vocabulary.mjs";
import { fakeContext } from "./fakes/context.mjs";

const caps = new Map(familyCapabilities().map((c) => [c.id, { ...c, from: "pack:orbit-backend-test" }]));
const AWAIT = { messages: { each: { id: "message.id", correlation: "message.correlation" } }, through: "cursor.through", completeness: "observation.completeness", gaps: "observation.gaps" };
const STATE = { count: "effect.count" };

const expectations = new Map([
  ["FIX-ASYNC-1/E1", { id: "E1", property: "message.id", op: "absent-within", value: "rem-tenant-b", within: 20 }],
  ["FIX-ASYNC-1/E2", { id: "E2", property: "effect.count", op: "count-eq", value: 1 }],
]);

const call = (capability, input) => ({ do: "call", capability, input });
const skeleton = (steps) => ({ steps });
const STEPS = [
  call("orbit.scheduler.trigger", { scheduleRef: "billing-daily", fixtureRef: "fx", request: { occurrenceId: "billing-daily:2026-10-22T09:00:00+07:00" } }),
  call("orbit.observe.await", { observerRef: "obs-1", request: { match: { correlationId: "inv-a-1" } } }),
  call("orbit.state.read", { stateRef: "reminders", fixtureRef: "fx", request: { businessKey: "inv-a-1" } }),
];
const TRIGGER = { executionRef: "execution.ref", occurrenceId: "occurrence.id", scheduledFor: "occurrence.scheduledFor", decision: "occurrence.decision" };

const proposal = (over = {}) => ({
  obligation: "tob-abc123",
  skeleton: skeleton(STEPS),
  assertions: [{ criterionRef: "FIX-ASYNC-1/E1", template: "absent-within", step: 2 }, { criterionRef: "FIX-ASYNC-1/E2", template: "count-eq", step: 3 }],
  controls: [{ role: "positive", why: "the due occurrence runs once" }, { role: "state", why: "one reminder, nothing else" }],
  fixtureRefs: ["fx"],
  trigger: { kind: "schedule", ref: "billing-daily", step: 1 },
  observationPlan: [{ observerRef: "obs-1", channelRef: "reminders", boundary: "publication", correlation: "the business key as correlation id" }],
  effectScope: "fixture",
  ...over,
});

const graph = fakeContext().graph;
const context = (over = {}) => ({
  expectations,
  outputsOf: (step) => ({ 1: TRIGGER, 2: AWAIT, 3: STATE })[step],
  semanticsOf: () => ({ observation: ["shadow-subscription"] }),
  observerSemantics: () => ({ observation: ["shadow-subscription"] }),
  shape: { ...shapeOf("occurrence-one-execution"), controls: ["positive", "state"], templates: ["count-eq", "absent-within"] },
  caseId: "gen-billing-once",
  title: "a due occurrence produces one reminder, and none for another tenant",
  validate: (c) => validate(c, graph, CORE, undefined, (id) => caps.get(id) ?? null),
  inputFindings: (s) => inputFindings(caps.get(s.capability), s.input),
  dsl: CORE,
  pageOf: (id) => caps.get(id)?.page,
  ...over,
});

test("a design that holds becomes a pageless case: every verdict compiled from an accepted criterion, each window from its own within", () => {
  const out = generatedCase(proposal(), context());
  assert.equal(out.ok, true, JSON.stringify(out.findings));
  assert.equal(out.channel, "pageless");
  assert.deepEqual(out.case.steps.map((s) => s.proves), ["api", "api", "sql"], "each verdict proves the layer of what it reads");
  assert.match(out.case.steps[1].expect, /^compiled:/);
  assert.equal(out.case.steps[1].input.request.waitMs, 20_000);
  assert.match(out.case.steps[0].expect, /"template":"value-present"/, "the trigger is ruled on by what its own answer shows when it was taken");
  assert.equal(out.case.seen, "src", "a generated case was written from source and has never run");
  assert.match(out.design.id, /^tds-[0-9a-f]{16}$/);
  assert.deepEqual(out.design.mapping.assertions.map((m) => [m.verdict, m.structural ?? m.criterionRef]), [["mapped", "FIX-ASYNC-1/E1"], ["mapped", "FIX-ASYNC-1/E2"], ["mapped", "trigger-accepted"]]);
  assert.deepEqual(out.design.temporalContract, { windows: [{ step: 2, waitMs: 20_000 }] });
  assert.deepEqual(out.digests, compileDesign(proposal(), context()).digests);
});

test("each stage stops a design with its own word, before the next is asked", () => {
  const stop = (p, cx) => ((r) => [r.stage, r.outcome])(generatedCase(p, cx ?? context()));
  assert.deepEqual(stop(proposal({ mapping: { assertions: [] } })), ["contract", "GENERATION_FAILED"], "a stamped field is refused by name");
  assert.deepEqual(stop(proposal({ controls: [{ role: "positive" }] })), ["controls", "GENERATION_FAILED"]);
  assert.deepEqual(stop(proposal({ observationPlan: [] })), ["rules", "GENERATION_FAILED"], "an await of an observer nothing armed");
  assert.deepEqual(stop(proposal({ assertions: [{ criterionRef: "FIX-ASYNC-1/E1", template: "absent-within", step: 2 }, { criterionRef: "DRAFT-1/E1", template: "count-eq", step: 3 }] })), ["mapping", "REQUIRES_REQUIREMENT"]);
  assert.deepEqual(stop(proposal({ assertions: [{ criterionRef: "FIX-ASYNC-1/E1", template: "absent-within", step: 2 }] })), ["verdicts", "GENERATION_FAILED"], "a read-back nothing accepted rules on");
  assert.deepEqual(stop(proposal({ skeleton: skeleton([...STEPS.slice(0, 2), call("orbit.state.read", { stateRef: "reminders", url: "http://x" })]) })), ["validate", "INVALID_TEST"], "an input the capability does not accept");
  assert.deepEqual(stop(proposal({ assertions: [{ criterionRef: "FIX-ASYNC-1/E2", template: "count-eq", step: 3 }] }), context({ expected: ["FIX-ASYNC-1/E1", "FIX-ASYNC-1/E2"] })), ["coverage", "GENERATION_FAILED"], "a design that leaves a slot of its own criterion unruled tests something else");
  const pinned = context({ expected: ["FIX-ASYNC-1/E2"], expectations: new Map([...expectations, ["FIX-ASYNC-1/E3", { id: "E3", property: "message.correlation.correlationId", op: "complete-within", value: "inv-b-1", within: 20 }]]), requestTableOf: (i) => (i === 2 ? { match: { type: "object", selects: "answer", fields: { correlationId: { type: "string", means: "message.correlation.correlationId", doc: "x" } }, doc: "x" } } : null) });
  assert.deepEqual(stop(proposal({ assertions: [{ criterionRef: "FIX-ASYNC-1/E3", template: "complete", step: 2 }, { criterionRef: "FIX-ASYNC-1/E2", template: "count-eq", step: 3 }] }), pinned), ["contradiction", "GENERATION_FAILED"], "an assertion the step's own match rules out, once the design is otherwise whole");
  for (const word of ["GENERATION_FAILED", "REQUIRES_REQUIREMENT", "INVALID_TEST"]) assert.ok(VERIFICATION_OUTCOME_IDS.includes(word), word);
});

// What 0.4.0's diagnosis found (0.5.0 B7): a design whose scheduler or worker observation named an observer was made
// into a draft, and the sandbox's binder -- which binds an observer only to a channel it is armed on -- blocked the run.
// Those operations read by a cursor and bind no observer, so naming one is refused where the design is made.
test("a scheduler's or a worker's observation that names an observer is refused at generation, as preparation would have blocked it", () => {
  for (const [capability, input] of [["orbit.worker.observe", { workloadRef: "worker" }], ["orbit.scheduler.observe", { scheduleRef: "billing-daily" }]]) {
    assert.match(inputFindings(caps.get(capability), { ...input, observerRef: "obs-1", request: {} }).join(), /unknown key "observerRef"/, capability);
    const steps = STEPS.map((s, i) => (i === 1 ? call(capability, { ...input, observerRef: "obs-1", request: { match: { messageId: "rem-1" } } }) : s));
    const out = generatedCase(proposal({ skeleton: skeleton(steps), observationPlan: [] }), context());
    assert.deepEqual([out.ok, out.stage, out.outcome], [false, "validate", "INVALID_TEST"], `${capability}: ${JSON.stringify(out.findings)}`);
    assert.match(out.findings.join(), /step 2: .*unknown key "observerRef"/);
  }
});

test("a control is held to what the test can show of it: it acts in a step, a refusal is of somebody else, and only a fault names a witness", () => {
  const stopped = (controls, steps = STEPS) => ((r) => [r.stage, (r.findings ?? []).join(" | ")])(generatedCase(proposal({ controls, skeleton: skeleton(steps) }), context()));
  const as = (identityRef) => STEPS.map((s, i) => (i === 2 ? { ...s, input: { ...s.input, identityRef } } : s));
  const holds = ([stage, said], pattern, why) => assert.ok(stage === "controls" && pattern.test(said), `${why}: ${stage} — ${said}`);
  holds(stopped([{ role: "positive", identityRef: "tenant-a" }, { role: "state" }]), /no step of the test acts as it/, "a control no step runs as shows nothing");
  holds(stopped([{ role: "positive", identityRef: "tenant-a" }, { role: "negative", identityRef: "tenant-a" }, { role: "state" }], as("tenant-a")), /a refusal of the allowed actor/, "a refusal of the allowed actor proves nothing about anybody else");
  holds(stopped([{ role: "positive", step: 2 }, { role: "state" }]), /only a fault control names a point/, "a step a positive control names would escape the rules a step is held to");
  holds(stopped([{ role: "positive" }, { role: "state" }, { role: "fault", point: "p", step: 9 }]), /witness is a step of the test \(1–3\)/, "a witness past the last step");
  holds(stopped([{ role: "positive" }, { role: "state" }, { role: "fault", step: 2 }]), /and no point/, "a witness names the point it witnesses");
});

// What a real Claude Code QA row taught (0.4.0): a fault point the workload's own test hooks do not declare is refused
// only when the run asks for it -- a design, a version and a dispatch spent on a guessed name. Where the system graph
// declares a workload's points, a fault control that names another is refused before a draft exists, naming them.
test("a fault control's point is one the workload it faults declares -- refused at the controls stage, naming them; unknown never refuses", () => {
  const fault = (alias, point) => call("orbit.workload.control", { workloadRef: alias, request: { action: "fault", point } });
  const watch = (alias) => call("orbit.worker.observe", { workloadRef: alias, request: { count: 1 } });
  const back = (alias) => call("orbit.workload.control", { workloadRef: alias, request: { action: "restart" } });
  const DECLARED = { worker: ["before-effect", "after-commit-before-ack"], relay: ["after-confirm-before-mark"] };
  const stopped = (point, steps, declared = DECLARED) => ((r) => [r.stage, r.outcome, (r.findings ?? []).join(" | ")])(generatedCase(proposal({ skeleton: skeleton([...STEPS, ...steps]), controls: [{ role: "positive" }, { role: "state" }, { role: "fault", point, why: "the worker stops after its effect" }] }), context(declared ? { faultPointsOf: (alias) => declared[alias] ?? null } : {})));
  const [stage, outcome, said] = stopped("after-effect-before-ack", [fault("worker", "after-effect-before-ack"), watch("worker"), back("worker")]);
  assert.deepEqual([stage, outcome], ["controls", "GENERATION_FAILED"], said);
  assert.match(said, /^DECLARED_POINT: the fault control names point "after-effect-before-ack", which no workload this design binds declares — worker declares before-effect, after-commit-before-ack$/);
  assert.notEqual(stopped("after-commit-before-ack", [fault("worker", "after-commit-before-ack"), watch("worker"), back("worker")])[0], "controls", "a declared point holds");
  assert.match(stopped("x", [fault("worker", "x"), watch("relay"), back("worker")])[2], /worker declares before-effect, after-commit-before-ack; relay declares after-confirm-before-mark/, "every workload it binds, each with what it declares");
  assert.notEqual(stopped("after-confirm-before-mark", [fault("worker", "y"), watch("relay"), back("worker")])[0], "controls", "a point one of them declares");
  assert.notEqual(stopped("x", [fault("worker", "x"), watch("api"), back("worker")])[0], "controls", "a workload that declares no points is unknown -- and unknown is never a refusal");
  assert.notEqual(stopped("x", [fault("worker", "x"), back("worker")], null)[0], "controls", "where nothing answers what a workload declares, today's behaviour");
  assert.notEqual(stopped("x", [])[0], "controls", "a design that binds no workload has none to hold its point to");
});

// What a real Claude Code QA row taught (0.4.0, ORBIT-QA-001 on Opus, three runs of three): its crash test faulted the
// worker, saw the fault, then waited for the redelivery -- and nothing brought the worker back. The acceptance
// application keeps a workload that stopped at a fault point down until a test starts it, so the CLEAN application
// contradicted the test too, a false alarm; and the next crash test found the worker still down and never saw its own
// fault. Nothing a host could read said it. The acceptance designs restart the worker between the witness and the
// observation after it; a design is now held to that before a draft exists.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACCEPTANCE = join(ROOT, "acceptance");
const ADAPTERS = JSON.parse(readFileSync(join(ROOT, "skills", "orbit-backend-test", "adapters.json"), "utf8")).adapters;
const answerOf = (adapter, op) => ADAPTERS.find((a) => a.id === adapter).operations[op].outputs;
// What each step's answer carries, as the adapters the acceptance stack binds declare it.
const ANSWERS = { "orbit.workload.control": answerOf("workload.hooks", "control"), "orbit.worker.observe": answerOf("worker.hooks", "observe"), "orbit.messaging.publish": answerOf("amqp.reference", "publish"), "orbit.state.read": answerOf("postgres.reference", "read") };
// The accepted criterion the crash obligations rest on, as the acceptance plan states it.
const PLAN = JSON.parse(readFileSync(join(ACCEPTANCE, "projects", "_shared", "ui-tests", "screens", "_no-screen", "invoice.plan.json"), "utf8"));
const ACCEPTED = new Map(PLAN.criteria.flatMap((c) => (c.expects ?? []).map((e) => [`${c.id}/${e.id}`, e])));
// The fault points each acceptance stack's system graph declares, read off it the way the binder reads them.
const STACKS = ["invoice-a", "invoice-b"];
const factsOf = (stack) => readFileSync(join(ACCEPTANCE, "graph", `${stack}.jsonl`), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const pointsOf = (stack) => Object.fromEntries(bindableFrom({ graph: graphOf(factsOf(stack), mergeVocabulary([catalogLayer(ROOT, realIo())])) }).workload.map((w) => [w.alias, w.points ?? null]));
const POINTS = Object.fromEntries(STACKS.map((stack) => [stack, pointsOf(stack)]));
const crashContext = (design, shape) => context({ expectations: ACCEPTED, expected: ["FIX-ASYNC-1/E2"], outputsOf: (i) => ANSWERS[design.skeleton.steps[i - 1]?.capability], shape: shapeOf(shape), faultPointsOf: (alias) => POINTS["invoice-a"][alias] ?? null });

const KEY = "tenant-a|inv-a|billing-daily:2026-10-24T09:00:00+07:00";
const workload = (request, alias = "worker") => call("orbit.workload.control", { workloadRef: alias, request });
const attempts = (request, alias = "worker") => call("orbit.worker.observe", { workloadRef: alias, request });
// The crash-before-effect design the host proposed, as the run's own journal kept it: the fault armed, the message
// published, the fault's witness, the redelivery awaited and the effect read -- with no step that brings the worker back.
const HOST_CRASH = {
  obligation: "tob-crash00000001",
  skeleton: skeleton([
    workload({ action: "fault", point: "before-effect" }),
    call("orbit.messaging.publish", { channelRef: "billing-reminder-requested", request: { messageId: "msg-host-0001", correlationId: KEY, payload: { messageId: "msg-host-0001", businessKey: KEY } } }),
    attempts({ match: { messageId: "msg-host-0001" }, count: 1, waitMs: 60_000 }),
    attempts({ match: { messageId: "msg-host-0001" }, count: 2 }),
    call("orbit.state.read", { stateRef: "reminders", request: { key: KEY } }),
  ]),
  assertions: [{ criterionRef: "FIX-ASYNC-1/E3", template: "complete", step: 4 }, { criterionRef: "FIX-ASYNC-1/E2", template: "count-eq", step: 5 }],
  controls: [{ role: "fault", point: "before-effect", step: 3, why: "the worker stops before its effect" }, { role: "state", why: "the effect happens once" }],
  trigger: { kind: "message", ref: "billing-reminder-requested", step: 2 },
  effectScope: "fixture",
};

// Each acceptance design, as the reference host sends it on a stack: for its shape, with the skeleton each clock allows.
const designsOn = (stack) => readdirSync(join(ACCEPTANCE, "designs")).filter((f) => f.endsWith(".json")).flatMap((f) => ((d) => Object.entries(d["by-clock"] ?? { none: {} }).map(([clock, over]) => ({ stack, shape: f.slice(0, -5), clock, design: JSON.parse(JSON.stringify({ ...d.design, obligation: "tob-acceptance01", ...over }).replaceAll("{{component}}", stack)) })))(JSON.parse(readFileSync(join(ACCEPTANCE, "designs", f), "utf8"))));
const ACCEPTANCE_DESIGNS = designsOn("invoice-a");

test("a workload stopped at its fault point is brought back before a step asks it for more -- the design a real host proposed is refused, naming the step to add and where; the acceptance design is made", () => {
  const out = generatedCase(HOST_CRASH, crashContext(HOST_CRASH, "crash-before-effect"));
  assert.deepEqual([out.ok, out.stage, out.outcome], [false, "controls", "GENERATION_FAILED"], `the design that ran to a false alarm never becomes a draft: ${JSON.stringify(out.findings)}`);
  assert.deepEqual(out.findings, ["RESTORED_AFTER_FAULT: add orbit.workload.control (request.action start or restart) on worker after step 3 and before step 4: step 4 asks it for more after its fault (witnessed at step 3), and nothing brought it back"]);
  assert.ok(out.findings[0].length <= 240, "said whole within what a host sees of a refusal");
  for (const shape of ["crash-before-effect", "crash-after-effect-before-ack"]) {
    const { design } = ACCEPTANCE_DESIGNS.find((d) => d.shape === shape);
    const made = generatedCase(design, crashContext(design, shape));
    assert.equal(made.ok, true, `${shape}: ${JSON.stringify(made.findings)}`);
  }
  const repaired = { ...HOST_CRASH, skeleton: skeleton([...HOST_CRASH.skeleton.steps.slice(0, 3), workload({ action: "start" }), ...HOST_CRASH.skeleton.steps.slice(3)]), assertions: HOST_CRASH.assertions.map((a) => ({ ...a, step: a.step + 1 })) };
  assert.equal(generatedCase(repaired, crashContext(repaired, "crash-before-effect")).ok, true, "the host's own design, with the step the refusal named, is made -- a start brings it back as a restart does");
});

test("a fault's workload is brought back after its witness, before any later step asks it for more, and before the test ends -- held from the design alone, and never by another workload or a stop", () => {
  const said = (steps, controls = HOST_CRASH.controls) => controlFindings({ ...HOST_CRASH, skeleton: skeleton(steps), controls }, shapeOf("crash-before-effect"), {}).filter((f) => f.rule === "RESTORED_AFTER_FAULT").map((f) => f.say);
  const [arm, publish, witness, again, read] = HOST_CRASH.skeleton.steps;
  assert.deepEqual(said([arm, publish, witness, workload({ action: "restart" }), again, read]), [], "brought back between the witness and the step that asks again");
  assert.deepEqual(said([arm, publish, witness, read, workload({ action: "restart" }), again]), [], "what the fault left may be read first, while the workload is down");
  assert.match(said([arm, publish, witness, again, workload({ action: "restart" }), read])[0] ?? "", /after step 3 and before step 4: step 4 asks it for more/, "a restart after the step that waited for it is too late");
  assert.match(said([arm, publish, witness, workload({ action: "restart" }, "relay"), again, read])[0] ?? "", /on worker after step 3 and before step 5/, "another workload's restart brings back nothing of this one");
  assert.match(said([arm, publish, witness, workload({ action: "stop" }), again, read])[0] ?? "", /before step 5/, "a stop brings nothing back");
  assert.deepEqual(said([arm, publish, witness, read]), ["add orbit.workload.control (request.action start or restart) on worker after step 3 and before reading its effect: its fault (witnessed at step 3) leaves it stopped for the next test"], "nothing asks it again here, and the next test in this sandbox would");
  const unwitnessed = [{ role: "fault", point: "before-effect" }, { role: "state" }];
  assert.deepEqual(said([arm, publish, read], unwitnessed), ["add orbit.workload.control (request.action start or restart) on worker after the step that sees its fault and before reading its effect: its fault (armed at step 1) leaves it stopped for the next test"], "with no witness, at least one brings it back after the step that armed it");
  assert.deepEqual(said([arm, publish, again, workload({ action: "restart" }), read], unwitnessed), [], "and with no witness, the design never says when the fault happened -- nothing more is demonstrable");
  assert.deepEqual(said([workload({ action: "fault", point: "after-commit-before-ack" }), publish, witness, again, read]), [], "a point no step arms leaves no workload stopped for this rule to hold");
});

// The reference host's designs (acceptance/designs/) are what the benchmark's controls and the native acceptance send:
// every rule a design's controls are held to must make them, or the controls would fail for the rule, not the product.
test("every acceptance design holds every rule a design's controls are held to, on each stack, with the fault points its graph declares", () => {
  assert.ok(ACCEPTANCE_DESIGNS.some((d) => d.design.controls.some((c) => c.role === "fault")), "the crash designs are among them");
  for (const stack of STACKS) assert.deepEqual(POINTS[stack].worker, ["before-effect", "after-commit-before-ack", "after-sink-before-ack", "after-ack-before-effect"], `${stack}: read off the graph the way the binder reads it`);
  const findings = STACKS.flatMap((stack) => designsOn(stack).flatMap(({ shape, clock, design }) => controlFindings(design, shapeOf(shape), { faultPointsOf: (alias) => POINTS[stack][alias] ?? null }).map((f) => `${stack} ${shape} (${clock}) ${f.rule}: ${f.say}`)));
  assert.deepEqual(findings, [], `held to ${CONTROL_RULES.map((r) => r.id).join(", ")}`);
});

// The same holds for the request tables (0.5.0, ADR 0052). A design is held to the table of the adapter that answers each
// of its steps, at the validate stage, before a draft exists. The reference host sends the acceptance designs on every
// stack: the AMQP one and the JetStream one. So every request a design sends must fit the table of every shipped adapter
// that answers its step, with the window the engine adds to a step a slot's `within` rules (`waitMs`,
// src/qa/generation/design.mjs placed). Otherwise the benchmark's reference controls would fail for a table, not for the
// product, and only in Docker.
const answeredBy = (capability) => ((row) => (row ? ADAPTERS.filter((a) => a.operations[opKeyOf(a, row)]).map((a) => [a.id, a.operations[opKeyOf(a, row)]]) : []))(operationFor(capability));

const windowed = (design) => design.skeleton.steps.map((s, n) => ((within) => (within ? { ...s, input: { ...s.input, request: { ...(s.input?.request ?? {}), waitMs: within * 1000 } } } : s))(design.assertions.map((a) => (a.step === n + 1 ? ACCEPTED.get(a.criterionRef)?.within : undefined)).find(Number.isInteger)));

test("every request an acceptance design sends fits the request table of every shipped adapter that answers its step, on each stack", () => {
  const held = STACKS.flatMap((stack) => designsOn(stack).flatMap(({ shape, clock, design }) => windowed(design).filter((s) => s.do === "call").flatMap((s) => answeredBy(s.capability).map(([id, op]) => ({ capability: s.capability, at: `${stack} ${shape} (${clock}) ${s.capability} (${id})`, table: op.request, request: s.input?.request })))));
  assert.deepEqual([...new Set(held.map((h) => h.capability))].sort(), ["orbit.clock.advance", "orbit.messaging.observe", "orbit.messaging.publish", "orbit.observe.await", "orbit.scheduler.observe", "orbit.scheduler.trigger", "orbit.state.read", "orbit.worker.observe", "orbit.workload.control"], "every operation an adapter answers in them is held");
  assert.ok(held.every((h) => h.table && typeof h.table === "object"), "each answering adapter declares what its request carries");
  assert.deepEqual(held.flatMap((h) => requestFindings(h.table, h.request, h.at)), []);
});

test("a repair may change how a step is written, never what the test rules on", () => {
  const before = proposal();
  const relocated = proposal({ skeleton: skeleton(STEPS.map((s, i) => (i === 1 ? call("orbit.observe.await", { observerRef: "obs-1", request: { match: { messageId: "rem-1" } } }) : s))) });
  const digests = (p) => compileDesign(p, context()).digests;
  assert.deepEqual(repairFindings(before, relocated, { before: digests(before), after: digests(relocated) }), []);
  const weakened = proposal({ assertions: [{ criterionRef: "FIX-ASYNC-1/E2", template: "count-eq", step: 3 }] });
  assert.deepEqual(repairFindings(before, weakened, { before: digests(before), after: digests(weakened) }).map((f) => f.rule), ["ASSERTIONS", "PREDICATES"]);
  assert.deepEqual(repairFindings(before, proposal({ controls: [{ role: "positive" }] })).map((f) => f.rule), ["CONTROLS"]);
});
