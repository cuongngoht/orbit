// What the 0.5.0 release pre-check found (Sonnet 5.5 at medium effort, the real Claude Code host, the seven ORBIT-QA rows):
// six rows ended FALSE_ALARM -- each a generated test the engine validated and froze that contradicted the CLEAN
// application too, caught only when the benchmark ran it again where nothing was planted. The fixtures are those hosts'
// own designs, trimmed to what a host proposes (test/fixtures/qa-false-alarms/; from runs bnr-ea4f8e2162b6 (ORBIT-QA-001),
// bnr-16fbfee43e09 (-005), bnr-eccc7eb452d1 (-006) and bnr-51f89ab75808 (-007)). Each is made here through the QA
// generation port a host's design goes through (skills/orbit-qa/ports.mjs), with the shipped packs loaded, on a graph
// that binds the invoice application's aliases to the adapters its stack A selects, against its accepted plan:
//
//   refused  what the design and the declarations prove a correct application contradicts (src/qa/backend/contradictions.mjs):
//            an assertion on the very field its step's own match pins to another value (MATCH_PINS), and -- the
//            effect-once-per-key obligation's own subject -- a second message under a business key held to the settlement
//            the first one is held to (SECOND_SETTLED) -- and, in any design, one under a business key an earlier
//            SATISFIED test of the same investigation settled, held to that same settlement (SETTLED_BEFORE)
//   advised  what holds only if the application does on its own what the design never causes: a later delivery with
//            nothing that interrupts one (UNCAUSED_REDELIVERY), a schedule's decision with nothing that moves its clock
//            (UNCAUSED_DECISION) -- said beside the answer, the design still made
//
// and the reference designs for the same shapes (acceptance/designs/) are still made, with nothing said beside them.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { graphDigestOf } from "../src/architecture/graph-view.mjs";
import { loadExtensions } from "../src/extensions/index.mjs";
import { qcToolPaths } from "../src/extensions/store.mjs";
import { generated } from "../src/investigation/generate.mjs";
import { planDigestOf } from "../src/investigation/input.mjs";
import { resultView } from "../src/investigation/loop.mjs";
import { modelOf } from "../src/investigation/model.mjs";
import { createInvestigations, eventIdOf } from "../src/investigation/store.mjs";
import { generatedCase } from "../src/qa/generation/design.mjs";
import { derivedObligations } from "../src/qa/obligations/derive.mjs";
import { generationPort } from "../skills/orbit-qa/ports.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "test", "fixtures", "qa-false-alarms");
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));
const PLAN = JSON.parse(readFileSync(join(ROOT, "acceptance", "projects", "_shared", "ui-tests", "screens", "_no-screen", "invoice.plan.json"), "utf8"));
const ID = "inv-20261105-171858-0a41";

// The invoice application as its stack A runs it: a broker for the channel, the hooks of one component for its schedule,
// clock and worker, and a database for the reminders and the jobs.
const node = (key, of, attributes = {}) => ({ key, name: key.split(":")[1], role: key.split(":")[0], ...(of ? { of } : {}), attributes });
const BARE = { nodes: [
  node("component:invoice-a", null, { hooksPort: "9090" }),
  node("channel:billing-reminder-requested", "component:broker", { exchange: "billing", routingKey: "billing.reminder.requested" }),
  node("schedule:billing-daily", "component:invoice-a"),
  node("workload:worker", "component:invoice-a", { faultPoints: "before-effect after-commit-before-ack" }),
  node("data-resource:reminders", "server:db", { table: "billing.reminders", key: "business_key" }),
  node("data-resource:billing-jobs", "server:db", { table: "billing.jobs", key: "occurrence_id" }),
], relations: [] };
const GRAPH = { ...BARE, digest: graphDigestOf(BARE) };
const server = (name, service, port) => ({ key: `server:${name}`, role: "server", name, alias: name, service, ports: [port], argv: [], compose: { env: [] }, env: { names: [], values: {} } });
const TOPOLOGY = { mode: "network", fingerprint: "f".repeat(64), nodes: [server("broker", "rabbitmq", 5672), server("db", "postgres", 5432), { key: "npm:.", role: "component", name: "invoice-a", alias: "invoice-a", ports: [8080, 9090], argv: [], compose: { env: [] }, env: { names: [], values: {} } }] };
const SERVICES = { rabbitmq: { id: "rabbitmq", transports: [{ id: "amqp-0-9-1", port: 5672 }] }, postgres: { id: "postgres", transports: [{ id: "postgres-wire", port: 5432 }] } };

async function packed() {
  const store = mkdtempSync(join(tmpdir(), "orbit-false-alarms-"));
  mkdirSync(qcToolPaths(store).root, { recursive: true });
  const base = fakeContext();
  const ctx = { ...base, store: () => store, config: { ...base.config, packs: ["orbit-api-test", "orbit-backend-test"] } };
  await loadExtensions(ctx, { pluginRoot: ROOT });
  return { ctx, store };
}

// The obligations the engine derives from the accepted plan, as the investigation's journal keeps them.
const OBLIGATIONS = derivedObligations({ plan: PLAN, binding: { id: "bnd-p", authority: "accepted" }, graph: GRAPH }).obligations;
const obligationOf = (shape) => OBLIGATIONS.find((o) => o.shape === shape);

function investigation(ctx) {
  const io = fakeIo();
  const store = createInvestigations("/store/repo-1", io);
  store.create({ id: ID, objective: "find the defects of the invoice application" });
  store.appendOnce(ID, "binding", { id: "bnd-1", eventId: eventIdOf("binding", "bnd-p", 0, "d"), binding: "bnd-p", type: "plan", ref: PLAN.id, revision: PLAN.revision, digest: planDigestOf(PLAN), authority: "accepted", state: "fresh" });
  OBLIGATIONS.forEach((o, n) => store.appendOnce(ID, "obligation", { id: `obr-${n + 1}`, eventId: eventIdOf("obligation", o.obligation, 0, o.digest), ...o }));
  const generation = generationPort({ ctx, model: () => modelOf(store.read(ID)), planOf: () => PLAN, graph: () => GRAPH, topology: () => TOPOLOGY, services: SERVICES, drafts: { save: () => {} } });
  return { w: { id: ID, store, io, generation }, generation };
}

// A design as the engine judges it for its obligation: what the stages came to, and what a host reads back of it.
const judged = (generation, shape, design) => ((obligation) => generatedCase({ ...design, obligation: obligation.obligation }, generation.contextFor(obligation, { design })))(obligationOf(shape));

const ONCE = "effect-once-per-key";
const DEADLINE = "completes-by-deadline";
const OCCURRENCE = "occurrence-one-execution";

// ── pattern 2: an assertion on a field its own step's match pins to another value ───────────────────────────────────
//
// ORBIT-QA-001's completes-by-deadline design published the request itself under one period's correlation, awaited it by
// that very correlation, and ruled the await with FIX-ASYNC-1/E1 -- a criterion that states ANOTHER period's correlation
// on that same field. The await's adapter (amqp.reference observe.await) declares its match field `correlationId` is
// compared with message.correlation.correlationId and that a count of what it matches ends the wait: so the wait ended
// on the host's own message, and the clean application was ruled to have published nothing for the criterion's period.
test("an assertion on the very field its step's own match pins to another value is refused before a draft exists, naming the step, the field, both values and what holds instead", async () => {
  const { ctx, store } = await packed();
  const { generation } = investigation(ctx);
  const out = judged(generation, DEADLINE, fixture("deadline-match-pins"));
  assert.deepEqual([out.ok, out.stage, out.outcome], [false, "contradiction", "GENERATION_FAILED"], JSON.stringify(out.findings ?? out.advice));
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].slice(0, 240), "MATCH_PINS: step 3 waits for tenant-a|inv-a|billing-daily:2027-01-05T09:00:00+07:00 (request.match.correlationId) and FIX-ASYNC-1/E1 needs tenant-a|inv-a|billing-daily:2026-10-22T09:00:00+07:00 there: match on that and bring it about first ", "what a host sees of a refusal says the step, both values and the fix");
  assert.match(out.findings[0], /message\.correlation\.correlationId is the field both name, and its wait ends once its match is met, so the window the slot is judged in is cut short of its own$/);
  rmSync(store, { recursive: true, force: true });
});

// ── pattern 1: a second message under a business key, held to the first one's settlement ─────────────────────────────
//
// ORBIT-QA-001, -002 and -003's effect-once-per-key designs (three runs of three) published two messages with DIFFERENT
// ids under one business key, then waited for each to settle as processed (FIX-ASYNC-1/E3), each on an observation the
// worker's adapter narrows to that one message. A second message under a business key is not a second effect: the clean
// worker settled it as the duplicate it was.
test("a second message under a business key held to the settlement the first is held to is refused -- the effect-once-per-key obligation's own subject", async () => {
  const { ctx, store } = await packed();
  const { generation } = investigation(ctx);
  const out = judged(generation, ONCE, fixture("once-second-settled"));
  assert.deepEqual([out.ok, out.stage, out.outcome], [false, "contradiction", "GENERATION_FAILED"], JSON.stringify(out.findings ?? out.advice));
  assert.equal(out.findings.length, 1);
  assert.ok(out.findings[0].slice(0, 240).startsWith("SECOND_SETTLED: step 4 waits for msg-a1b2c3d4e5f60003 to settle as processed (FIX-ASYNC-1/E3) like msg-a1b2c3d4e5f60002 at step 3, the first under that businessKey: rule step 4 by its first delivery, or publish msg-a1b2c3d4e5f60002 twice"), out.findings[0]);
  assert.match(out.findings[0], / — a second message under a business key is not a second effect, and how it settles is the system's own word$/);
  const first = fixture("once-second-settled");
  const alone = { ...first, skeleton: { steps: first.skeleton.steps.filter((s, i) => i !== 2) }, assertions: first.assertions.filter((a) => a.step !== 3).map((a) => ({ ...a, step: a.step - 1 })) };
  const advised = judged(generation, ONCE, alone);
  assert.equal(advised.ok, true, `held to a settlement on the second message alone, it may be what a criterion states a second one comes to: ${advised.stage} ${JSON.stringify(advised.findings)}`);
  assert.match(advised.advice.join("\n"), /^SECOND_SETTLES: step 3 waits for msg-a1b2c3d4e5f60003 to settle as processed \(FIX-ASYNC-1\/E3\), the second message here under msg-a1b2c3d4e5f60002's businessKey: unless a criterion states how a second one settles/);
  assert.equal(judged(generation, DEADLINE, first).stage === "contradiction" && judged(generation, DEADLINE, first).findings.some((f) => f.startsWith("SECOND_SETTLED")), false, "the rule names its own subject: another obligation's design is not held to it");
  rmSync(store, { recursive: true, force: true });
});

// ── patterns 3 and 4 (and 5): what the design never causes ──────────────────────────────────────────────────────────
//
// ORBIT-QA-005, -006 and -007's effect-once-per-key designs waited for a SECOND delivery (FIX-ASYNC-1/E4, delivery.attempt
// 2) of a message nothing interrupted: no step faults, stops or restarts a workload. ORBIT-QA-005's occurrence design
// waited for the schedule to decide its occurrence due with no step that moves the clock, and ORBIT-QA-007's triggered
// it by hand first -- a trigger proves the handler, never the schedule. A correct application need do neither, and may
// yet (a consumer that rejects a delivery, a clock an earlier test moved): said beside the answer, never refused.
test("a later delivery nothing in the design or its obligation's shape brings is refused, naming the step; a schedule's decision nothing in it brings about is said beside the draft -- never refused", async () => {
  const { ctx, store } = await packed();
  const { w } = investigation(ctx);
  const sent = (shape, name) => generated(w, { obligation: obligationOf(shape).obligation, design: { ...fixture(name), obligation: obligationOf(shape).obligation } });
  const second = sent(ONCE, "once-second-redelivered");
  assert.equal(second.outcome, "GENERATION_FAILED");
  assert.ok(second.findings.some((f) => f.startsWith("NEVER_REDELIVERED: step 4 waits for delivery 2 of msg-a1b2c3d4e5f60002 (FIX-ASYNC-1/E4) and no step here faults, stops or restarts a workload: arm a fault before it settles (orbit.workload.control), or rule the step by its first delivery")), second.findings.join("\n"));
  for (const name of ["once-first-redelivered", "once-both-redelivered"]) {
    const both = sent(ONCE, name);
    assert.deepEqual([both.outcome, both.findings.filter((f) => f.startsWith("NEVER_REDELIVERED: step 3 waits for delivery 2") || f.startsWith("NEVER_REDELIVERED: step 4 waits for delivery 2")).length], ["GENERATION_FAILED", 2], `${name}: the first message's later delivery as much as the second's`);
  }
  for (const name of ["occurrence-no-clock", "occurrence-triggered"]) {
    const out = sent(OCCURRENCE, name);
    assert.equal(out.outcome, "DRAFT_CREATED", name);
    assert.match((resultView(out).advice ?? []).join("\n"), /^UNCAUSED_DECISION: step \d waits for billing-daily:2026-10-22T09:00:00\+07:00 to be decided due \(SCHED-1\/E1\) and no step here moves the clock: advance it to that occurrence first \(orbit\.clock\.advance\), unless an earlier test/, name);
  }
  rmSync(store, { recursive: true, force: true });
});

// ── pattern 6: a business key an earlier test of the same investigation already settled ─────────────────────────────
//
// The tests of one investigation run one after another in one sandbox, and twice a host's later test was ruled against
// on the clean application by what an earlier one left. ORBIT-QA-006 (an Opus host, 0.4.0): an earlier test published by
// hand under a period's business key, and its completes-by-deadline test then made the schedule reach that period and
// waited for the period's message to be processed -- the clean worker settled it as the duplicate it was. ORBIT-TOOL-001
// (the 0.5.0 pre-check's Sonnet host, bnr-eab84e468c77), the other way round: its earlier test moved the clock and saw the
// schedule decide the occurrence (occurrence-decided-first, SATISFIED), and its completes-by-deadline design
// (deadline-after-occurrence) then published by hand a message for that occurrence under tenant-a|inv-a|… and waited for
// it to be processed. Neither is shown by the record: which business key a schedule's job publishes under is the
// application's to compose, for the invoices it selects, and nothing declared says it is the one the hand-published
// message names. Both stay `shared` advice -- the run's own pair is still made, the shared occurrence said beside it.
//
// What the record DOES prove is refused (SETTLED_BEFORE): both messages published by hand under one business key, the
// earlier one by a version that ran SATISFIED and so saw it settle. Here the earlier test is ORBIT-TOOL-001's own
// completes-by-deadline design, run SATISFIED, and the later one the same design under a fresh message id.
function ranAs(w, shape, name, design, outcome = "SATISFIED") {
  const out = generated(w, { obligation: obligationOf(shape).obligation, design: { ...design, obligation: obligationOf(shape).obligation } });
  assert.equal(out.outcome, "DRAFT_CREATED", `${name}: ${JSON.stringify(out.findings)}`);
  const execution = `exe-${name}-1`;
  w.store.appendOnce(ID, "started", { id: `str-${name}`, eventId: eventIdOf("started", out.version, 1, execution), attempt: 1, version: out.version, execution });
  w.store.appendOnce(ID, "evaluated", { id: `evl-${name}`, eventId: eventIdOf("evaluated", execution, 1, outcome), attempt: 1, execution, obligation: obligationOf(shape).obligation, outcome });
  return out.version;
}

const reused = (design, id) => JSON.parse(JSON.stringify(design).replaceAll("msg-a1b2c3d4e5f60001", id));
const madeFor = (w, shape, design) => generated(w, { obligation: obligationOf(shape).obligation, design: { ...design, obligation: obligationOf(shape).obligation } });

test("a message published under a business key an earlier SATISFIED test of the same investigation published under and saw settle, held to that same settlement, is refused naming the earlier version and the key", async () => {
  const { ctx, store } = await packed();
  const { w } = investigation(ctx);
  const first = fixture("deadline-after-occurrence");
  const version = ranAs(w, DEADLINE, "first", first);
  const second = madeFor(w, DEADLINE, reused(first, "msg-a1b2c3d4e5f60002"));
  assert.deepEqual([second.outcome, second.stage], ["GENERATION_FAILED", "contradiction"], JSON.stringify(second));
  assert.deepEqual(second.findings, [`SETTLED_BEFORE: step 4 waits for msg-a1b2c3d4e5f60002 to settle as processed (FIX-ASYNC-1/E3) under businessKey tenant-a|inv-a|billing-daily:2026-10-22T09:00:00+07:00, which ${version} (completes-by-deadline) of this investigation already published msg-a1b2c3d4e5f60001 under and saw settle as processed: use a business key no earlier test of this investigation used, or rule this one by what that test left — its tests share one sandbox, and a second message under a business key is not a second effect`]);
  const fresh = JSON.parse(JSON.stringify(reused(first, "msg-a1b2c3d4e5f60003")).replaceAll("2026-10-22T09:00:00+07:00", "2026-10-29T09:00:00+07:00"));
  assert.deepEqual((madeFor(w, DEADLINE, fresh).findings ?? []).filter((f) => f.startsWith("SETTLED_BEFORE")), [], "a business key no earlier test used is no second message");
  assert.equal(madeFor(w, DEADLINE, first).outcome, "DRAFT_CREATED", "the earlier test's own message sent again is that same message, never a second one");
  rmSync(store, { recursive: true, force: true });
});

test("only what the record proves is refused: an earlier version that never ran, or ran to any other word, leaves the design made -- and so does ORBIT-TOOL-001's own pair, whose earlier test only decided the occurrence", async () => {
  const { ctx, store } = await packed();
  for (const outcome of [null, "CONTRADICTED", "INCONCLUSIVE"]) {
    const { w } = investigation(ctx);
    const first = fixture("deadline-after-occurrence");
    if (outcome) ranAs(w, DEADLINE, "first", first, outcome);
    if (!outcome) madeFor(w, DEADLINE, first);
    const second = madeFor(w, DEADLINE, reused(first, "msg-a1b2c3d4e5f60002"));
    assert.equal(second.outcome, "DRAFT_CREATED", `${outcome ?? "never ran"}: ${JSON.stringify(second.findings)}`);
  }
  const { w } = investigation(ctx);
  const decided = ranAs(w, OCCURRENCE, "decided", fixture("occurrence-decided-first"));
  const after = madeFor(w, DEADLINE, fixture("deadline-after-occurrence"));
  assert.equal(after.outcome, "DRAFT_CREATED", JSON.stringify(after.findings));
  assert.deepEqual(resultView(after).shared?.map((s) => [s.version, s.keys]), [[decided, [{ value: "billing-daily:2026-10-22T09:00:00+07:00", as: ["occurrenceId"] }]]], "what only a value suggests is said beside the draft");
  rmSync(store, { recursive: true, force: true });
});

// ── what a correct design for the same obligations looks like ────────────────────────────────────────────────────────
//
// The reference designs the benchmark's reference and false-alarm controls send for these shapes (acceptance/designs/, on
// stack A's live clock): an await by the criterion's own correlation once the clock brought its period, the same message
// published twice and both deliveries counted in one observation, the clock moved to the occurrence before its decision
// is read. Each is still made, and nothing is said beside it.
const REFERENCE = (shape) => ((r) => JSON.parse(JSON.stringify({ ...r.design, ...(r["by-clock"]?.live ?? {}) }).replaceAll("{{component}}", "invoice-a")))(JSON.parse(readFileSync(join(ROOT, "acceptance", "designs", `${shape}.json`), "utf8")));

test("the reference designs for the same obligations are made, and nothing is said beside them", async () => {
  const { ctx, store } = await packed();
  const { generation } = investigation(ctx);
  for (const shape of [DEADLINE, ONCE, OCCURRENCE]) {
    const out = judged(generation, shape, REFERENCE(shape));
    assert.equal(out.ok, true, `${shape}: ${out.stage} ${JSON.stringify(out.findings)}`);
    assert.equal(out.advice, undefined, `${shape}: ${JSON.stringify(out.advice)}`);
  }
  const repaired = fixture("deadline-match-pins");
  const steps = repaired.skeleton.steps.map((s, i) => (i === 2 ? { ...s, input: { ...s.input, request: { ...s.input.request, match: { correlationId: "tenant-a|inv-a|billing-daily:2026-10-22T09:00:00+07:00" } } } } : s));
  assert.equal(judged(generation, DEADLINE, { ...repaired, skeleton: { steps } }).stage === "contradiction", false, "the host's own design, matched on the value its criterion states, is no contradiction");
  rmSync(store, { recursive: true, force: true });
});
