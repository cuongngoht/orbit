// The ways INTO an investigation (a screen, a plan, a requirement snapshot, or
// both) and the ways it reads below the screen when there is no SQL: a
// registered, read-only capability. Driven through the entry points the CLI
// calls, on fake ports; the CLI itself is spawned where a flag is the contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, analyse, begin, cancel, checkData, inputModeOf, modelOf, pbiInput, planAsInput, screenInput, snapshotAsInput } from "../src/investigation/index.mjs";
import { createRequirements } from "../src/requirements/store.mjs";
import { rootId, sourceRecord, workitemText } from "../src/sources/model.mjs";
import { createSources } from "../src/sources/store.mjs";
import { draftPlans } from "../src/draft/plans.mjs";
import { findPlan } from "../src/qa/load.mjs";
import { PLAN_ID } from "../src/qa/fields.mjs";
import { ROOT_FIELDS } from "../src/dsl/fields.mjs";
import { realIo } from "../src/store/io.mjs";
import { aqaWorld, post, SAVE_CHAIN, started } from "./autonomous-qa.harness.mjs";
import { UI_TESTS, fixtureProject } from "./fakes/context.mjs";
import { loadProject } from "../src/project/index.mjs";
import { seedStore, storeRootIn } from "./fakes/store.mjs";
import { sealed } from "./home.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli");
const run = (w, chain = SAVE_CHAIN) => chain.map((s) => act(w, s).action);
const model = (t) => modelOf(t.w.store.read(t.id));
const persistence = (t) => { analyse(t.w); return model(t).findings.filter((f) => f.family === "persistence"); };

// A store nobody can read with SQL, asked through a capability instead.
const COUNTER = (answers) => ({ id: "orders.count", apiVersion: "orbit.capability/v1", doc: "count what a test created", page: false, inputSchema: { name: { type: "string", esc: "text", doc: "the synthetic name" } }, invoke: (ext, input) => answers(input) });
const withCapability = (cap, o = {}) => { const t = started({ requests: [post(1)], sql: false, ...o }); t.ctx.capabilities.register(cap, "inputs.test"); return t; };

// ------------------------------------------------------------------- inputs
test("the way in is derived from what was given, never declared", () => {
  const g = aqaWorld().ctx.graph;
  assert.equal(inputModeOf([]), "screen", "only an objective's words: the map's surfaces, as before");
  assert.equal(inputModeOf([screenInput(g, "home")]), "screen");
  assert.equal(inputModeOf([planAsInput({ id: "refunds", revision: "1" }, "refunds")]), "pbi", "a requirement and no screen");
  assert.equal(inputModeOf([pbiInput({ file: "p.md" }, "text", "now")]), "pbi");
  assert.equal(inputModeOf([planAsInput({ id: "things", screen: "home" }, "things")]), "hybrid", "a plan about a screen is both");
  assert.equal(inputModeOf([pbiInput({ file: "p.md" }, "text", "now"), screenInput(g, "home")]), "hybrid");
});

test("a requirement snapshot keeps its ref, revision, digest and authority — never its text", () => {
  const read = pbiInput({ file: "/in/pbi-7.json" }, JSON.stringify({ id: "PBI-7", revision: 7, body: "a customer may not refund more than they paid" }), "2026-09-29T10:00:00Z");
  assert.deepEqual([read.ref, read.revision, read.authority, read.state], ["PBI-7", "7", "draft", "read"]);
  assert.match(read.digest, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(read).includes("refund more"), "the requirement's text is never kept");
  assert.equal(pbiInput({ file: "p.md", accepted: true }, "x", "now").authority, "accepted", "only on a person's word");
  const gone = pbiInput({ file: "/in/gone.md" }, null, "now");
  assert.equal(gone.state, "unavailable");
  assert.match(gone.why, /carried on without it/);
});

test("an investigation records its inputs, the way in they make, and the journal schema", () => {
  const t = aqaWorld();
  const plan = findPlan(join(UI_TESTS, "screens"), "things");
  const { id } = begin(t.make(), { objective: "check the things plan", scope: "", inputs: [planAsInput(plan, "things"), screenInput(t.ctx.graph, "nowhere")] });
  const m = modelOf(t.make({ id }).store.read(id));
  assert.equal(m.meta.inputMode, "hybrid");
  assert.equal(m.meta.schema, 2);
  assert.deepEqual(m.inputs.map((i) => [i.id, i.type, i.ref, i.state]), [["inp-1", "plan", "things", "read"], ["inp-2", "screen", "nowhere", "unavailable"]]);
  assert.equal(m.inputs[0].authority, "accepted", "a committed plan is the team's contract");
});

// ------------------------------------------------------ data through a capability
test("a record the capability counts is the expected behaviour", () => {
  const seen = [];
  const t = withCapability(COUNTER((input) => { seen.push(input.name); return { count: 1 }; }));
  const c = checkData(t.w, { action: run(t.w).at(-1).id, via: "orders.count", input: { name: "${TC}" }, expect: 1 });
  assert.deepEqual([c.state, c.rows, c.via, c.tables], ["observed", 1, "orders.count", []]);
  assert.deepEqual(seen, ["TC-1a2b-1"], "${TC} filled with what the chain typed, in the key's own language");
  const [p] = persistence(t);
  assert.equal(p.outcome, "OBSERVED_EXPECTED_BEHAVIOR");
  assert.match(p.key, /via:orders\.count/);
});

test("a record the capability does not find is SUSPECTED, never confirmed — the map does not say it reads what the control writes", () => {
  const t = withCapability(COUNTER(() => []));
  checkData(t.w, { action: run(t.w).at(-1).id, via: "orders.count", input: { name: "${TC}" }, expect: 1 });
  const [p] = persistence(t);
  assert.equal(p.outcome, "SUSPECTED_DEFECT");
  assert.match(p.needs.join(" "), /the map to record which store this control writes/);
});

test("a capability that mutates, answers something that is not a count, or cannot be asked", () => {
  const writer = withCapability({ ...COUNTER(() => 1), id: "orders.purge", mutates: true });
  assert.throws(() => checkData(writer.w, { action: run(writer.w).at(-1).id, via: "orders.purge", expect: 0 }), /a data check only reads/);
  const chatty = withCapability(COUNTER(() => ({ hello: "world" })));
  assert.throws(() => checkData(chatty.w, { action: run(chatty.w).at(-1).id, via: "orders.count", expect: 1 }), /not a count/);
  const down = withCapability({ ...COUNTER(() => 1), tools: ["no-such-cli"] });
  down.ctx.tools = { present: () => ({ ok: false, why: "not on PATH" }) };
  const blocked = checkData(down.w, { action: run(down.w).at(-1).id, via: "orders.count", expect: 1 });
  assert.equal(blocked.state, "blocked", "a machine that cannot ask is BLOCKED, never a finding about the product");
});

test("a capability asked for a data check has no page to reach for", () => {
  const t = withCapability({ ...COUNTER(() => 1), invoke: (ext) => ext.browser.evaluate("document.title") });
  assert.throws(() => checkData(t.w, { action: run(t.w).at(-1).id, via: "orders.count", expect: 1 }), /no page/);
});

test("a data check passes the investigation's gates: a cancelled investigation reads nothing", () => {
  const t = started({ requests: [post(1)] });
  const id = run(t.w).at(-1).id;
  cancel(t.w, "a person stopped it");
  assert.throws(() => checkData(t.w, { action: id, query: "SELECT COUNT(*) AS n FROM Things WHERE Name='${TC}'", expect: 1 }), /cancelled/);
});

// -------------------------------------------------------------- draft plans
test("a plan id and a case id are the same shape, so the drafts room asks one constraint", () => {
  assert.equal(PLAN_ID.source, ROOT_FIELDS.id.pattern);
});

function project() {
  const data = join(mkdtempSync(join(tmpdir(), "orbit-inputs-")), "ui-tests");
  cpSync(UI_TESTS, data, { recursive: true });
  return { data, store: seedStore(null, fixtureProject()) };
}

const aqa = (p, argv, input) => spawnSync(process.execPath, [join(CLI, "autonomous-qa.mjs"), ...argv], { encoding: "utf8", input, env: sealed({ ORBIT_UI_TESTS: p.data, ORBIT_STORE_DIR: p.store }) });
const draftCli = (p, argv) => spawnSync(process.execPath, [join(CLI, "draft.mjs"), ...argv], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: p.data, ORBIT_STORE_DIR: p.store }) });

const REFUNDS = { schema: 1, id: "refunds", feature: "Refunds", title: "Refund rules", revision: "1", at: "2026-09-29", sources: [{ id: "PBI1", kind: "requirement", ref: "PBI-7", revision: "7", says: "a refund never exceeds what was paid" }], criteria: [{ id: "AC1", says: "a refund above the amount paid is refused", source: "PBI1" }], scenarios: [{ id: "S1", name: "an over-refund is refused", covers: ["AC1"], technique: "boundary", priority: "P1", expect: { api: { need: "required", says: "POST /refunds answers 422" }, sql: { need: "required", says: "no refund row" } }, cases: [], readiness: "draft" }] };

test("draft-plan keeps an agent's plan in the drafts room, records it as an input, and never writes the checkout", () => {
  const p = project();
  const started = JSON.parse(aqa(p, ["plan", "--objective=refunds", "--json"]).stdout);
  const r = aqa(p, ["draft-plan", `--investigation=${started.id}`, "--json"], JSON.stringify(REFUNDS));
  assert.equal(r.status, 0, r.stderr);
  const room = draftPlans(loadProject({ ORBIT_UI_TESTS: p.data, ORBIT_STORE_DIR: p.store }).storeRoot, realIo());
  assert.deepEqual(room.all().map((x) => [x.id, x._draft]), [["refunds", true]]);
  assert.ok(!existsSync(join(p.data, "screens", "_no-screen", "refunds.plan.json")), "nothing entered the checkout");
  assert.deepEqual(JSON.parse(r.stdout).authority, "draft");
  const bad = aqa(p, ["draft-plan", `--investigation=${started.id}`], JSON.stringify({ ...REFUNDS, id: "broken", criteria: [] }));
  assert.equal(bad.status, 2);
  const show = spawnSync(process.execPath, [join(CLI, "qa-plan.mjs"), "show", "refunds"], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: p.data, ORBIT_STORE_DIR: p.store }) });
  assert.equal(show.status, 0, show.stderr);
  assert.match(show.stdout, /a DRAFT in the machine store/);
});

test("promoting a draft plan places it by what it is about and marks every unqualified source a draft", () => {
  const p = project();
  const room = draftPlans(loadProject({ ORBIT_UI_TESTS: p.data, ORBIT_STORE_DIR: p.store }).storeRoot, realIo());
  room.save(REFUNDS);
  const r = draftCli(p, ["promote", "refunds"]);
  assert.equal(r.status, 0, r.stderr);
  const promoted = JSON.parse(readFileSync(join(p.data, "screens", "_no-screen", "refunds.plan.json"), "utf8"));
  assert.deepEqual(promoted.sources.map((s) => s.authority), ["draft"], "promoting an agent's plan is not accepting it");
  assert.equal(room.all().length, 0);
  room.save({ ...REFUNDS, id: "refunds" });
  assert.match(draftCli(p, ["promote", "refunds"]).stderr, /already/);
});

// ------------------------------------------------------------ a frozen requirement snapshot

const SNAP = { id: "rs-aaaaaaaaaaaa", digest: "d".repeat(64), authority: "draft", clarity: "complete" };
const NOW9 = "2026-09-30T10:00:00.000Z";

test("a requirement snapshot is a requirement input: its own id, a short digest as the revision, its own authority, and no text", () => {
  const draft = snapshotAsInput(SNAP, NOW9);
  assert.deepEqual([draft.type, draft.ref, draft.revision, draft.digest, draft.authority, draft.state, draft.read], ["pbi", "rs-aaaaaaaaaaaa", "d".repeat(16), "d".repeat(64), "draft", "read", NOW9]);
  assert.equal(snapshotAsInput({ ...SNAP, authority: "accepted" }, NOW9).authority, "accepted", "a person's recorded acceptance of the source is enough; nobody is asked again");
  assert.equal(snapshotAsInput(SNAP, NOW9, { accepted: true }).authority, "accepted", "and a person's --authority=accepted --human is the same door as for a file");
  assert.deepEqual(Object.keys(draft).sort(), ["authority", "digest", "read", "ref", "revision", "state", "type"], "nothing else about the requirement is kept");
  const gone = snapshotAsInput(null, NOW9, { ref: "rs-bbbbbbbbbbbb" });
  assert.deepEqual([gone.state, gone.ref, gone.authority], ["unavailable", "rs-bbbbbbbbbbbb", undefined]);
  assert.match(gone.why, /no snapshot rs-bbbbbbbbbbbb is kept here — carried on without it/);
});

test("a snapshot makes an investigation pbi, or hybrid with a screen, exactly as a requirement file does", () => {
  const g = aqaWorld().ctx.graph;
  assert.equal(inputModeOf([snapshotAsInput(SNAP, NOW9)]), "pbi");
  assert.equal(inputModeOf([snapshotAsInput(SNAP, NOW9), screenInput(g, "home")]), "hybrid");
  assert.equal(inputModeOf([snapshotAsInput(null, NOW9, { ref: "rs-bbbbbbbbbbbb" })]), "pbi", "an unreadable one is still a requirement that was asked about");
});

const IDENTITY = { provider: "azure-devops", organization: "acme", project: "web", id: "4312" };
const req = (p, argv, input) => spawnSync(process.execPath, [join(CLI, "requirements.mjs"), ...argv], { encoding: "utf8", input, env: sealed({ ORBIT_UI_TESTS: p.data, ORBIT_STORE_DIR: p.store }) });

// A requirement, as an acquisition would have left it, frozen into a snapshot.
function frozen(p) {
  const store = JSON.parse(req(p, ["where", "--json"]).stdout).store;
  const rec = sourceRecord({ identity: IDENTITY, kind: "workitem", ref: "4312", revision: "7", text: workitemText({ title: "t", body: "SENTINEL-BODY" }), now: NOW9 });
  createSources(store, realIo()).saveRecord(rec);
  const root = rootId(IDENTITY);
  const port = createRequirements(store, realIo()).open(root);
  port.transact(() => port.setState({ sources: {}, position: 0, lastSnapshot: null, identity: IDENTITY }));
  const said = JSON.stringify({ subject: "refund", aspect: "limit", says: "A refund above 500 needs a manager", sources: [`source:${rec.id}@7#ac-1`] });
  assert.equal(req(p, ["record", root], `${said}\n`).status, 0);
  return { root, source: rec.id, freeze: () => JSON.parse(req(p, ["snapshot", root, "--json"]).stdout) };
}

const inputsOfPlan = (p, args) => {
  const r = aqa(p, ["plan", "--objective=verify the refund rule", "--dry", "--json", ...args]);
  return { r, plan: r.status === 0 ? JSON.parse(r.stdout) : null };
};

test("plan --snapshot records the snapshot as a requirement input, draft until a person makes it accepted", () => {
  const p = project();
  const f = frozen(p);
  const snap = f.freeze();
  const { r, plan } = inputsOfPlan(p, [`--snapshot=${snap.snapshot}`]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(plan.inputMode, "pbi");
  const [input] = plan.inputs;
  assert.deepEqual([input.type, input.ref, input.authority, input.state], ["pbi", snap.snapshot, "draft", "read"]);
  assert.equal(input.revision.length, 16);
  assert.ok(!r.stdout.includes("SENTINEL-BODY") && !r.stdout.includes("refund above 500"), "no word of the requirement reaches the plan");
  assert.equal(aqa(p, ["plan", "--objective=x", "--dry", `--snapshot=${snap.snapshot}`, "--authority=accepted"]).status, 2, "accepted takes a person's word");
  assert.equal(inputsOfPlan(p, [`--snapshot=${snap.snapshot}`, "--authority=accepted", "--human"]).plan.inputs[0].authority, "accepted");
});

test("a snapshot whose source a person accepted is accepted without --human, and the older draft one stays what it was", () => {
  const p = project();
  const f = frozen(p);
  const draft = f.freeze();
  assert.equal(JSON.parse(req(p, ["accept", f.source, "--human", "--json"]).stdout).authority, "accepted");
  const stronger = f.freeze();
  assert.notEqual(stronger.snapshot, draft.snapshot);
  assert.equal(inputsOfPlan(p, [`--snapshot=${stronger.snapshot}`]).plan.inputs[0].authority, "accepted");
  assert.equal(inputsOfPlan(p, [`--snapshot=${draft.snapshot}`]).plan.inputs[0].authority, "draft");
});

test("a snapshot that is not there is recorded unavailable and the investigation carries on with the rest", () => {
  const p = project();
  const { r, plan } = inputsOfPlan(p, ["--snapshot=rs-ffffffffffff", "--screen=home"]);
  assert.equal(r.status, 0, r.stderr);
  const gone = plan.inputs.find((i) => i.type === "pbi");
  assert.deepEqual([gone.state, gone.ref], ["unavailable", "rs-ffffffffffff"]);
  assert.equal(plan.inputMode, "hybrid");
  assert.match(gone.why, /carried on without it/);
});

test("a snapshot that no longer holds is not trusted: unavailable, with the reason", () => {
  const p = project();
  const f = frozen(p);
  const snap = f.freeze();
  const store = JSON.parse(req(p, ["where", "--json"]).stdout).store;
  const file = join(store, "requirements", f.root, "snapshots", `${snap.snapshot}.json`);
  const doc = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...doc, clarity: "blocked" }));
  const { plan } = inputsOfPlan(p, [`--snapshot=${snap.snapshot}`]);
  assert.equal(plan.inputs[0].state, "unavailable");
  assert.match(plan.inputs[0].why, /does not hold/);
});
