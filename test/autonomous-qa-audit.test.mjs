// The 1.7.0 baseline audit of autonomous QA's engine half, one test per row of
// docs/audit/1.7.0-baseline.md. Each was written first and run against the
// unmodified module (the failures are recorded in that document), so each one
// shows the defect before it holds the fix.
//
// Every expectation is the CONTRACT's -- what the brief, README §4.11 and the
// engine's own rules say must happen -- and never what deriveFindings happens to
// return: a test that mirrors the implementation proves only that it runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { short } from "../src/hash.mjs";
import { qcToolPaths } from "../src/extensions/index.mjs";
import { act, analyse, cancel, checkData, modelOf, planFor } from "../src/investigation/index.mjs";
import { GOALS } from "../src/investigation/plan.mjs";
import { INTENTS } from "../src/routing/intents.mjs";
import { runCase } from "../src/run/run-case.mjs";
import { aqaWorld, post, SAVE, SAVE_CHAIN, scriptedDb, started } from "./autonomous-qa.harness.mjs";
import { fakeBrowser } from "./fakes/browser.mjs";
import { UI_TESTS, fakeContext, fixtureProject } from "./fakes/context.mjs";
import { fakeMemory } from "./fakes/memory.mjs";
import { seedStore, storeRootIn } from "./fakes/store.mjs";
import { sealed } from "./home.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli");
const FROZEN = join(HERE, "fixtures", "extensions", "current-example");


const run = (w, chain = SAVE_CHAIN) => chain.map((s) => act(w, s).action);
const model = (t) => modelOf(t.w.store.read(t.id));
const family = (t, name) => { analyse(t.w); return model(t).findings.filter((f) => f.family === name); };
const COUNT = "SELECT COUNT(*) AS n FROM Things WHERE Name='${TC}'";
const gotos = (t) => t.browser.calls.filter((c) => c[0] === "goto").length;
const sessionLock = (t) => join(t.w.store.paths.sessions, short(t.browser.dir(), 16), ".lock");

// A second save of the same dialog, typing a second synthetic name.
const AGAIN = [SAVE_CHAIN[0], SAVE_CHAIN[1], { ...SAVE_CHAIN[2], value: "TC-1a2b-2" }, SAVE_CHAIN[3]];
// A dialog with a second text box, so one chain types two synthetic values.
const CODE = { from: "dlg-thing", via: "Code", kind: "textbox", selector: "getByRole('textbox',{name:'Code'})", opens: "none", to: null, seen: "live", fe_commit: "abc1234" };
const withCode = (g) => { g.edges.push(CODE); g.edgeOn.set("dlg-thing/Code", CODE); };
const TWO_FILLS = [SAVE_CHAIN[0], SAVE_CHAIN[1], SAVE_CHAIN[2], { kind: "fill", on: "dlg-thing/Code", value: "TC-1a2b-9" }, SAVE_CHAIN[3]];

// ---------------------------------------------------------------- A01 · A03
test("A01: a telemetry POST 200 is not the write the map records — a missing row proves nothing about persistence", () => {
  const telemetry = { n: 1, method: "POST", url: "https://app.test/api/telemetry", status: 200, afterCall: ["click", SAVE], body: "{}" };
  const t = started({ requests: [telemetry], db: scriptedDb([0]) });
  checkData(t.w, { action: run(t.w).at(-1).id, query: COUNT, expect: 1 });
  const [p] = family(t, "persistence");
  assert.equal(p.outcome, "INCONCLUSIVE", "the call dlg-thing/Save makes (POST api/things) was never seen, so nothing was persisted or failed to be");
});

test("A01: with telemetry beside it, the contradiction cites the call the map records, not the first 2xx", () => {
  const telemetry = { n: 1, method: "POST", url: "https://app.test/api/telemetry", status: 200, afterCall: ["click", SAVE], body: "{}" };
  const t = started({ requests: [telemetry, post(2)], db: scriptedDb([0]) });
  checkData(t.w, { action: run(t.w).at(-1).id, query: COUNT, expect: 1 });
  const [p] = family(t, "persistence");
  assert.equal(p.outcome, "CONFIRMED_DEFECT");
  assert.match(p.actual, /answered 201/, "the 201 of POST api/things is what the missing row contradicts");
});

test("A03: 202 Accepted is not completion — with no declared window a missing row asks for a requirement", () => {
  const t = started({ requests: [post(1, { status: 202 })], db: scriptedDb([0]) });
  checkData(t.w, { action: run(t.w).at(-1).id, query: COUNT, expect: 1 });
  const [p] = family(t, "persistence");
  assert.equal(p.outcome, "REQUIRES_REQUIREMENT");
});

test("A03 control: a 202 whose declared window passed with still no row is a contradiction", () => {
  const t = started({ requests: [post(1, { status: 202 })], db: scriptedDb([0, 0, 0]) });
  checkData(t.w, { action: run(t.w).at(-1).id, query: COUNT, expect: 1, within: 2 });
  assert.equal(family(t, "persistence")[0].outcome, "CONFIRMED_DEFECT");
});

// ---------------------------------------------------------------------- A02
test("A02: a later MISSING on the same control is not hidden by an earlier PRESENT — both occurrences are kept", () => {
  const t = started({ requests: [post(1), post(2, { afterCall: ["click", SAVE, 2] })], db: scriptedDb([1, 0]) });
  checkData(t.w, { action: run(t.w).at(-1).id, query: COUNT, expect: 1 });
  const second = run(t.w, AGAIN).at(-1);
  checkData(t.w, { action: second.id, query: COUNT, expect: 1 });
  const found = family(t, "persistence");
  assert.equal(found.length, 1, "one finding per control and table");
  assert.equal(found[0].outcome, "CONFIRMED_DEFECT", "a good occurrence before does not erase a bad one after");
  assert.equal(found[0].pattern, "intermittent");
  assert.equal(found[0].occurrences.length, 2);
  assert.equal(found[0].action, second.id, "the finding names the action that showed the defect, so a reproduction replays that chain");
});

test("A02: a later PRESENT does not close an earlier MISSING", () => {
  const t = started({ requests: [post(1), post(2, { afterCall: ["click", SAVE, 2] })], db: scriptedDb([0, 1]) });
  const first = run(t.w).at(-1);
  checkData(t.w, { action: first.id, query: COUNT, expect: 1 });
  checkData(t.w, { action: run(t.w, AGAIN).at(-1).id, query: COUNT, expect: 1 });
  const [p] = family(t, "persistence");
  assert.equal(p.outcome, "CONFIRMED_DEFECT");
  assert.equal(p.action, first.id);
});

// ---------------------------------------------------------------------- C07
test("C07: a map that records a schema-qualified table is readable by that same name", () => {
  const t = started({ requests: [post(1)], db: scriptedDb([1]), graph: (g) => { g.effectOn.get("dlg-thing/Save").layers.sql[0].table = "dbo.Things"; } });
  const c = checkData(t.w, { action: run(t.w).at(-1).id, query: "SELECT COUNT(*) AS n FROM dbo.Things WHERE Name='${TC}'", expect: 1 });
  assert.equal(c.state, "observed");
});

test("C07: a CTE's own name is not a table the map must record", () => {
  const t = started({ requests: [post(1)], db: scriptedDb([1]) });
  const c = checkData(t.w, { action: run(t.w).at(-1).id, query: "WITH mine AS (SELECT Name FROM Things WHERE Name='${TC}') SELECT COUNT(*) AS n FROM mine", expect: 1 });
  assert.equal(c.state, "observed");
});

test("C07 control: two schemas are two tables — audit.Things is not the mapped dbo.Things", () => {
  const t = started({ requests: [post(1)], db: scriptedDb([1]), graph: (g) => { g.effectOn.get("dlg-thing/Save").layers.sql[0].table = "dbo.Things"; } });
  assert.throws(() => checkData(t.w, { action: run(t.w).at(-1).id, query: "SELECT COUNT(*) AS n FROM audit.Things", expect: 1 }), /never guessed/);
});

// ---------------------------------------------------------------------- C08
test("C08: a bare ${TC} over a chain that typed two values is refused, never bound to the last one", () => {
  const db = scriptedDb([1]);
  const t = started({ requests: [post(1)], db, graph: withCode });
  const id = run(t.w, TWO_FILLS).at(-1).id;
  assert.throws(() => checkData(t.w, { action: id, query: COUNT, expect: 1 }), /typed 2 synthetic values/);
  assert.equal(db.seen.queries.length, 0, "nothing was asked of the database");
});

test("C08: ${TC:<control>} names which typed value the query means", () => {
  const db = scriptedDb([1]);
  const t = started({ requests: [post(1)], db, graph: withCode });
  const id = run(t.w, TWO_FILLS).at(-1).id;
  checkData(t.w, { action: id, query: "SELECT COUNT(*) AS n FROM Things WHERE Name='${TC:dlg-thing/Name}'", expect: 1 });
  assert.match(db.seen.queries.at(-1), /Name='TC-1a2b-1'/);
});

// ---------------------------------------------------------------------- C09
test("C09: a cancel that lands while an action waits for the browser is honoured — the action does not run", () => {
  const t = started({});
  const lock = sessionLock(t);
  mkdirSync(lock, { recursive: true });
  const once = { fired: false };
  const io = { ...t.w.io, sleep: () => { if (once.fired || !existsSync(lock)) return; once.fired = true; cancel(t.w, "a person stopped it"); rmSync(lock, { recursive: true, force: true }); } };
  assert.throws(() => act({ ...t.w, io }, SAVE_CHAIN[0]), /cancelled/);
  assert.equal(gotos(t), 0);
});

// ---------------------------------------------------------------------- C10
test("C10: two data checks racing on one investigation get two different ids", () => {
  const t = started({ requests: [post(1)] });
  const id = run(t.w).at(-1).id;
  const raced = { done: false };
  t.ctx.db = { query: () => { if (!raced.done) { raced.done = true; checkData(t.w, { action: id, query: COUNT, expect: 1 }); } return { ok: true, rows: [{ n: "1" }] }; } };
  checkData(t.w, { action: id, query: COUNT, expect: 1 });
  const ids = model(t).checks.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, `check ids: ${ids.join(", ")}`);
});

// ---------------------------------------------------------------------- C20
test("C20: a live action holding the browser longer than a minute is not broken as stale", () => {
  const t = started({ settings: { limits: { actions: 25, requestsPerAction: 40, minutes: 20, pollSeconds: 120 } } });
  const lock = sessionLock(t);
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, "owner.json"), JSON.stringify({ host: "another-laptop", pid: 1, at: "2026-09-29T00:00:00Z", token: "held" }));
  const old = new Date(Date.now() - 90_000);
  utimesSync(lock, old, old);
  assert.throws(() => act(t.w, SAVE_CHAIN[0]), /driving this browser session/);
  assert.equal(gotos(t), 0, "nobody broke a lock whose holder may still be settling");
});

// ---------------------------------------------------------------------- C16
test("C16: a record appended after a torn line survives it", () => {
  const t = started({});
  appendFileSync(join(t.w.store.dirOf(t.id), "journal.jsonl"), '{"kind":"action","id":"act-9"');
  t.w.store.append(t.id, "cancelled", { why: "after a crash", by: "person" });
  assert.equal(model(t).cancelled?.why, "after a crash");
});

// ---------------------------------------------------------------------- C15
test("C15: a surface's score says it was touched, not verified — a visit verifies nothing", () => {
  const plan = planFor(aqaWorld({}).make(), { objective: "explore", scope: "" });
  assert.ok(plan.surfaces.length > 0);
  assert.ok(plan.surfaces.every((s) => "touched" in s && !("verified" in s)));
});

// ---------------------------------------------------------------------- C12
test("C12: a case with no start screen recalls the notes about the case, not every note", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-nostart-"));
  const file = join(dir, "no-start.json");
  writeFileSync(file, JSON.stringify({ id: "no-start", name: "a case that begins on no screen", seen: "src", steps: [{ do: "goto", url: "/home", wait: "document.body.innerText.length>0" }, { do: "report", js: "JSON.stringify({path: location.pathname})", expect: "typeof it.path === 'string'" }] }));
  const memory = fakeMemory({ notes: [{ about: "case:no-start", title: "about this case", host: "a", at: "2026-09-01T00:00:00Z" }, { about: "case:something-else", title: "not this one", host: "a", at: "2026-09-01T00:00:00Z" }] });
  const browser = fakeBrowser({ answers: [[/^!!\(/, true], ["location.pathname", "/home"], [/^JSON\.stringify/, JSON.stringify({ path: "/home" })]] });
  const o = runCase(fakeContext({ memory, browser }), [file]);
  const recall = o.run.log.records.find((r) => r.kind === "recall");
  assert.deepEqual(recall.notes.map((n) => n.about), ["case:no-start"]);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------- C13
test("C13: the routing and planning cues are English", () => {
  const cues = [...INTENTS.flatMap((i) => i.cues ?? []), ...GOALS.flatMap((g) => g.cues)];
  assert.ok(!cues.includes("hai request"));
});

// ---------------------------------------------------------------------- C18
test("C18: the autonomous-qa entry point loads the project's extensions — its plan sees their capabilities", () => {
  const project = fixtureProject();
  const base = seedStore(null, project);
  const room = qcToolPaths(storeRootIn(base, project));
  mkdirSync(room.root, { recursive: true });
  cpSync(FROZEN, join(room.root, "current-example"), { recursive: true });
  const r = spawnSync(process.execPath, [join(CLI, "autonomous-qa.mjs"), "plan", "--objective=explore", "--dry", "--json"], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: UI_TESTS, ORBIT_STORE_DIR: base }) });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).layers.data.capabilities, ["example.rows"]);
  rmSync(base, { recursive: true, force: true });
});
