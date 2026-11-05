// What a design can be shown to hold a correct application to (src/qa/backend/contradictions.mjs, 0.5.0): each rule on its
// own edges, read with the shipped adapters' declarations -- and every design the benchmark's scripted controls send
// (benchmark/lib/qa/hosts.mjs, captured from the hosts themselves) and every worked design the playbook shows held to
// them: none of those may be refused, or a control would fail for the rule, not the product.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { declarationFindings, MATCH_SELECTS } from "../src/adapters/contract-v1.mjs";
import { operationFor } from "../src/adapters/families.mjs";
import { opKeyOf } from "../src/adapters/select.mjs";
import { CONTRADICTION_RULES, contradictionAdvice, contradictionFindings } from "../src/qa/backend/contradictions.mjs";
import { shapeOf } from "../src/qa/obligations/shapes.mjs";
import { meaningAt, meaningEntries } from "../src/topology/vocab.mjs";
import { HOSTS } from "../benchmark/lib/qa/hosts.mjs";
import { INVOICE } from "../benchmark/lib/qa/invoice.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADAPTERS = JSON.parse(readFileSync(join(ROOT, "skills", "orbit-backend-test", "adapters.json"), "utf8")).adapters;
const PLAN = JSON.parse(readFileSync(join(ROOT, "acceptance", "projects", "_shared", "ui-tests", "screens", "_no-screen", "invoice.plan.json"), "utf8"));
const ACCEPTED = new Map(PLAN.criteria.flatMap((c) => (c.expects ?? []).map((e) => [`${c.id}/${e.id}`, e])));

// The adapter each family is answered by on a stack: its broker's for the channels, the hooks' for the rest, a database's
// for state -- and the request table that adapter declares for the operation a step asks.
const BY_STACK = { "invoice-a": "amqp.reference", "invoice-b": "jetstream.reference" };
const answering = (stack, family) => ({ messaging: BY_STACK[stack], observe: BY_STACK[stack], worker: "worker.hooks", scheduler: "scheduler.hooks", clock: "clock.hooks", workload: "workload.hooks", identity: "identity.hooks", state: "postgres.reference" })[family];
const operationOn = (stack, capability) => ((row) => ((a) => (a ? a.operations[opKeyOf(a, row)] ?? null : null))(row ? ADAPTERS.find((x) => x.id === answering(stack, row.family)) : null))(operationFor(capability));
const contextOn = (stack, design, shape, expectations = ACCEPTED) => ({ expectations, shape: shapeOf(shape), requestTableOf: (i) => operationOn(stack, design.skeleton?.steps?.[i - 1]?.capability)?.request ?? null });

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
  assert.deepEqual(refused(design(steps, [["FIX-ASYNC-1/E3", 3], ["FIX-ASYNC-1/E4", 4]]), ONCE), [], "the second ruled by its delivery, not by how it settled");
  assert.deepEqual(advised(design(steps, [["FIX-ASYNC-1/E3", 4]]), ONCE), ["SECOND_SETTLES"], "the second alone held to a settlement may be what a criterion states of it: said");
  const unnamed = [publish("msg-1"), publish("msg-2"), attempts({ count: 1 }), attempts({ count: 1, match: { messageId: "msg-2" } })];
  assert.deepEqual(refused(design(unnamed, [["FIX-ASYNC-1/E3", 3], ["FIX-ASYNC-1/E3", 4]]), ONCE), [], "an observation not narrowed to the first message holds nothing to it");
  const keyless = (id) => call("orbit.messaging.publish", { channelRef: "billing-reminder-requested", request: { messageId: id, correlationId: KEY, payload: { messageId: id } } });
  assert.deepEqual(refused(design([keyless("msg-1"), keyless("msg-2"), ...steps.slice(2)], [["FIX-ASYNC-1/E3", 3], ["FIX-ASYNC-1/E3", 4]]), ONCE), [], "a correlation is not a business key: a design that names none is held to nothing here");
});

test("a later delivery is said only where nothing in the design interrupts one, and a decision only where nothing moves the clock", () => {
  const second = [publish("msg-1"), attempts({ count: 1, match: { messageId: "msg-1" } })];
  assert.deepEqual(advised(design(second, [["FIX-ASYNC-1/E4", 2]]), "effect-once-per-key"), ["UNCAUSED_REDELIVERY"]);
  const faulted = [call("orbit.workload.control", { workloadRef: "worker", request: { action: "fault", point: "before-effect" } }), ...second];
  assert.deepEqual(advised(design(faulted, [["FIX-ASYNC-1/E4", 3]]), "crash-before-effect"), [], "a fault interrupts the first delivery");
  assert.deepEqual(advised({ ...design(second, []), assertions: [{ criterionRef: "X/E1", template: "complete", step: 2 }] }, "effect-once-per-key"), [], "a slot no accepted criterion states says nothing here");
  const once = new Map([...ACCEPTED, ["X/E1", { id: "E1", property: "delivery.attempt", op: "complete-within", value: 1, within: 60, for: [] }]]);
  assert.deepEqual(contradictionAdvice(design(second, [["X/E1", 2]]), contextOn("invoice-a", design(second, []), "effect-once-per-key", once)), [], "its first delivery needs no cause");
  const occurrence = "billing-daily:2026-10-22T09:00:00+07:00";
  const watched = [decisions({ count: 1, match: { occurrenceId: occurrence } })];
  assert.deepEqual(advised(design(watched, [["SCHED-1/E1", 1]]), "occurrence-one-execution"), ["UNCAUSED_DECISION"]);
  assert.deepEqual(advised(design([call("orbit.scheduler.trigger", { scheduleRef: "billing-daily", request: { occurrenceId: occurrence } }), ...watched], [["SCHED-1/E1", 2]]), "occurrence-one-execution"), ["UNCAUSED_DECISION"], "a trigger proves the handler, never the schedule");
  assert.deepEqual(advised(design([call("orbit.clock.advance", { clockRef: "invoice-a", request: { to: "2026-10-22T09:00:00+07:00" } }), ...watched], [["SCHED-1/E1", 2]]), "occurrence-one-execution"), [], "the clock moved to it");
  assert.ok(CONTRADICTION_RULES.filter((r) => !r.refuses).every((r) => !contradictionFindings(design(watched, [["SCHED-1/E1", 1]]), contextOn("invoice-a", design(watched, []), "occurrence-one-execution")).some((f) => f.rule === r.id)), "advice never refuses");
});

// ── what the benchmark's controls send ──────────────────────────────────────────────────────────────────────────────

// A relay that owes every shape the application's designs cover and keeps every design a host proposes, answering no
// version -- so a host runs nothing, and what it would have sent is all that is read.
async function sentBy(host, stack, memory) {
  const designs = INVOICE.designs(ROOT);
  const owed = designs.map((d, n) => ({ id: `obl-${n + 1}`, kind: "test-obligation", template: { obligation: `tob-${String(n + 1).padStart(12, "0")}`, shape: d.shape } }));
  const sent = [];
  const ask = async (argv, stdin) => ({ exit: 0, stderr: "", stdout: argv[0] === "context" ? JSON.stringify({ position: 1, frontier: owed, versions: [] }) : JSON.stringify(kept(sent, owed, argv, stdin)) });
  await HOSTS[host]({ ask, journal: () => [], designs, stack, clock: INVOICE.clock(ROOT, stack), falseAlarm: INVOICE.falseAlarm.shape, earlier: () => ({ investigation: "inv-earlier", versions: [] }), memory: () => memory });
  return sent;
}

function kept(sent, owed, argv, stdin) {
  const decision = argv[0] === "step" ? JSON.parse(stdin) : null;
  if (decision?.action?.kind === "generate") sent.push({ shape: owed.find((o) => o.id === decision.target)?.template.shape, design: decision.action.design });
  return {};
}

const CASES = readdirSync(join(ROOT, "benchmark", "suites")).flatMap((suite) => readdirSync(join(ROOT, "benchmark", "suites", suite)).filter((c) => c !== "suite.json").map((c) => JSON.parse(readFileSync(join(ROOT, "benchmark", "suites", suite, c, "case.json"), "utf8")))).filter((c) => ["qa", "sessions"].includes(c.kind));

test("no design a benchmark control sends is refused or advised by these rules -- the false alarm the false-alarm control plants is not one a design shows", async () => {
  assert.ok(CASES.length >= 10, "every QA and sessions case");
  const said = [];
  const sentOf = new Map();
  for (const c of CASES) {
    for (const { host } of c.controls) {
      const sent = await sentBy(host, c.target.stack, c.poison ? { skip: c.poison.skip, stale: c.poison.stale } : null);
      sentOf.set(host, Math.max(sentOf.get(host) ?? 0, sent.length));
      for (const { shape, design: d } of sent) said.push(...[...refused(d, shape, c.target.stack), ...advised(d, shape, c.target.stack)].map((rule) => `${c.id} ${host} ${shape}: ${rule}`));
    }
  }
  assert.deepEqual(said, []);
  assert.deepEqual(Object.fromEntries([...sentOf].sort()), { cheat: 0, "false-alarm": 9, half: 9, idle: 0, reference: 9, "trusts-poison": 6, "trusts-stale": 9 }, "each host's designs, one per shape it tests -- read off the host itself");
  const broken = (await sentBy("false-alarm", "invoice-a", null)).filter((s) => s.shape === INVOICE.falseAlarm.shape);
  assert.equal(broken.length, 1, "the false-alarm control still sends its broken design, made like any other");
  assert.match(JSON.stringify(broken[0].design), /never written/, "a read-back of a record no step writes: a contradiction the clean application shows, and no design can");
});

test("every reference design, on each stack and with each clock its stack allows, is held to none of these rules", () => {
  const designs = INVOICE.designs(ROOT).flatMap((d) => Object.entries(d["by-clock"] ?? { none: {} }).flatMap(([clock, over]) => Object.keys(BY_STACK).map((stack) => ({ stack, clock, shape: d.shape, design: JSON.parse(JSON.stringify({ ...d.design, ...over }).replaceAll("{{component}}", stack)) }))));
  assert.ok(designs.length >= 20);
  assert.deepEqual(designs.flatMap((x) => [...refused(x.design, x.shape, x.stack), ...advised(x.design, x.shape, x.stack)].map((rule) => `${x.stack} ${x.shape} (${x.clock}): ${rule}`)), []);
});

// The playbook's worked designs (skills/orbit-qa/references/designs.md) are what a host starts from: none may be held to
// any of these rules, refused or said, on the slots each says it assumes.
const DOC = readFileSync(join(ROOT, "skills", "orbit-qa", "references", "designs.md"), "utf8");
const WORKED = [...DOC.matchAll(/^### ([a-z-]+)\n[\s\S]*?```json\n([\s\S]*?)```/gm)].map(([, , json]) => JSON.parse(json));

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

test("every match field a shipped adapter compares says what it is compared with -- a meaning its own answer's items carry -- and every match says what it picks", () => {
  const matched = ADAPTERS.flatMap((a) => Object.entries(a.operations).filter(([, o]) => o.request?.match?.fields).map(([op, o]) => ({ at: `${a.id} ${op}`, match: o.request.match, items: meaningEntries(o.outputs).filter(([path]) => path.includes("[].")).map(([, means]) => means) })));
  assert.deepEqual(matched.map((m) => m.at).sort(), ["amqp.reference observe.await", "jetstream.reference observe.await", "scheduler.hooks observe", "worker.hooks observe"]);
  for (const m of matched) {
    assert.ok(MATCH_SELECTS.includes(m.match.selects), m.at);
    for (const [k, row] of Object.entries(m.match.fields)) assert.ok(m.items.some((means) => row.means === means || row.means.startsWith(`${means}.`)) && meaningAt(row.means), `${m.at} match.${k} means ${row.means}, which its answer's items carry`);
  }
});
