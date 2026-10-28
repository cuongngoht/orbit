// Autonomous QA end to end on fake ports: plan, gates, the observation
// boundary, data checks, the duplicate and persistence verdicts, reproduction,
// drafts, redaction and the store's containment. The mandatory matrix rows are
// named in each test title.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDrafts } from "../src/draft/index.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { act, analyse, begin, cancel, checkData, draftFor, explore, modelOf, planFor, reproduce, readSettings, writeSettings } from "../src/investigation/index.mjs";
import { investigationHtml, investigationJson } from "../src/report/investigation.mjs";
import { Blocked } from "../src/errors.mjs";
import { aqaWorld, post, SAVE_CHAIN, scriptedDb, started } from "./autonomous-qa.harness.mjs";

const run = (w, chain = SAVE_CHAIN) => chain.map((s) => act(w, s).action);
const model = (t) => modelOf(t.w.store.read(t.id));
const findingsOf = (t) => { analyse(t.w); return model(t).findings; };
const family = (t, name) => findingsOf(t).filter((f) => f.family === name);
const beganOn = (t) => begin(t.make(), { objective: "check why Save sends two API requests", scope: "thing" });
const COUNT = "SELECT COUNT(*) AS n FROM Things WHERE Name='${TC}'";

// ------------------------------------------------------------------- phase 1
test("plan: a bounded plan from the map, no browser touched, every blocker named", () => {
  const t = aqaWorld({ settings: { enabled: false }, mode: "observe" });
  const plan = planFor(t.make(), { objective: "why does Save send two requests", scope: "thing" });
  assert.equal(t.browser.calls.length, 0);
  assert.deepEqual(plan.goals.slice(0, 1), ["duplicates"]);
  assert.ok(plan.blockers.some((b) => b.id === "DISABLED"));
  assert.ok(plan.actions.skipped.some((s) => s.on === "dlg-thing/Save" && /explore-write/.test(s.why)));
  assert.deepEqual(plan.layers.network.neverObserved.includes("initiator"), true);
});

test("plan: a destructive control is always skipped, and a surface no case covers comes first", () => {
  const t = aqaWorld({ mode: "explore-write" });
  const plan = planFor(t.make(), { objective: "explore", scope: "" });
  assert.ok(plan.actions.skipped.some((s) => s.on === "home/Delete" && /destructive/.test(s.why)));
  assert.ok(plan.actions.planned.some((a) => a.on === "dlg-thing/Save"));
  assert.equal(plan.actions.planned.find((a) => a.on === "dlg-thing/Save").reach.url, "/home");
});

test("gates: switched off, disabled, an unapproved mode, production and a wrong host all refuse before the browser", () => {
  const off = started({ on: false });
  assert.throws(() => act(off.w, SAVE_CHAIN[0]), /switched off/);
  const disabled = started({ settings: { enabled: false } });
  assert.throws(() => act(disabled.w, SAVE_CHAIN[0]), /a person switched autonomous QA off/);
  const unapproved = started({ settings: { environments: [{ id: "test", origin: "https://app.test", kind: "test", modes: ["observe"] }] } });
  assert.throws(() => act(unapproved.w, SAVE_CHAIN[0]), /explore-write is not approved/);
  assert.throws(() => writeSettings(unapproved.w.store.paths, unapproved.w.io, { next: { ...unapproved.w.settings, environments: [{ id: "prod", origin: "https://app.test", kind: "production", modes: ["explore-write"] }] }, revision: readSettings(unapproved.w.store.paths, unapproved.w.io).revision, by: "person", now: "x" }), /production/);
  const elsewhere = started({ host: "other.example" });
  assert.throws(() => act(elsewhere.w, SAVE_CHAIN[0]), /not on the approved environment/);
  assert.equal(elsewhere.browser.calls.filter((c) => c[0] === "goto").length, 0);
});

// What this checkout's own runtime says about the approved environment, handed in by the composition
// root and only when the environment is on this machine (src/runtime/origin.mjs).
const UNSERVED = { component: "dotnet:api", port: 5000, served: false, next: "start it with `runtime start --component=dotnet:api`, or start it yourself, then act again" };

test("gates: the runtime declares the environment's application and nothing answers — BLOCKED, the machine's news and never a finding", () => {
  const t = aqaWorld({});
  const { id } = beganOn(t);
  const w = t.make({ id, runtime: UNSERVED });
  assert.throws(() => act(w, SAVE_CHAIN[0]), (e) => e instanceof Blocked && /dotnet:api at https:\/\/app\.test, and nothing answers there — start it with `runtime start --component=dotnet:api`/.test(e.message));
  assert.equal(modelOf(w.store.read(id)).actions.length, 0);
  assert.equal(t.browser.calls.filter((c) => c[0] === "goto").length, 0, "refused before the browser");
});

test("gates: a runtime that answers, or none handed in at all, is silent", () => {
  const served = aqaWorld({});
  assert.doesNotThrow(() => act(served.make({ id: beganOn(served).id, runtime: { ...UNSERVED, served: true } }), SAVE_CHAIN[0]));
  const none = started({});
  assert.equal(none.w.runtime, null);
  assert.doesNotThrow(() => act(none.w, SAVE_CHAIN[0]));
});

test("plan: the runtime's news is a blocker the plan prints, with the stop it earns, before any action", () => {
  const t = aqaWorld({ mode: "observe" });
  const plan = planFor(t.make({ runtime: UNSERVED }), { objective: "explore", scope: "" });
  assert.deepEqual(plan.blockers.filter((b) => b.id === "RUNTIME_BLOCKED").map((b) => b.stop), ["blocked"]);
  assert.equal(planFor(t.make(), { objective: "explore", scope: "" }).blockers.some((b) => b.id === "RUNTIME_BLOCKED"), false);
  assert.equal(t.browser.calls.length, 0);
});

test("gates: the browser session is signed out — the existing authentication refusal, never a finding", () => {
  const t = started({ host: "SIGNIN" });
  assert.throws(() => act(t.w, SAVE_CHAIN[0]), /sign-in page/);
  assert.equal(model(t).actions.length, 0);
});

test("gates: observe mode never clicks a control that may write, and no mode touches a destructive one", () => {
  const t = started({ mode: "observe" });
  act(t.w, SAVE_CHAIN[0]);
  assert.throws(() => act(t.w, { kind: "click", on: "dlg-thing/Save" }), /may change data/);
  assert.throws(() => act(started().w, { kind: "click", on: "detail/Archive" }), /DESTRUCTIVE/);
  assert.throws(() => act(t.w, { kind: "fill", on: "dlg-thing/Name", value: "real customer" }), /synthetic TC-/);
});

test("settings are a person's: a session cannot write them, and a stale revision is refused", () => {
  const t = aqaWorld();
  const { paths } = t.make().store;
  assert.throws(() => writeSettings(paths, t.machine.io, { next: {}, revision: null, by: "session", now: "x" }), /person's approval/);
  assert.throws(() => writeSettings(paths, t.machine.io, { next: readSettings(paths, t.machine.io).settings, revision: "stale", by: "person", now: "x" }), /changed since they were read/);
  assert.throws(() => writeSettings(paths, t.machine.io, { next: { ...readSettings(paths, t.machine.io).settings, identities: [], token: "x" }, revision: readSettings(paths, t.machine.io).revision, by: "person", now: "x" }), /credential is never a setting/);
});

test("cancellation and the deadline stop further actions", () => {
  const t = started();
  act(t.w, SAVE_CHAIN[0]);
  cancel(t.w, "a person stopped it");
  assert.throws(() => act(t.w, SAVE_CHAIN[0]), /cancelled/);
  const late = started({ settings: { limits: { actions: 25, requestsPerAction: 40, minutes: 1, pollSeconds: 30 } } });
  late.browser.clock.tick(61 * 60000 + Date.parse(model(late).meta.at) - late.browser.clock.now());
  assert.throws(() => act(late.w, SAVE_CHAIN[0]), /minute budget is spent/);
});

test("the action budget stops an exploration and says which gate did", () => {
  const t = started({ settings: { limits: { actions: 2, requestsPerAction: 40, minutes: 20, pollSeconds: 30 } } });
  const out = explore(t.w, model(t).plan);
  assert.equal(out.actions.length, 2);
  assert.match(out.stopped.why, /action budget is spent/);
});

// ------------------------------------------------------------------- phase 2
test("one click producing one valid request: no duplicate finding", () => {
  const t = started({ requests: [post(1)], db: scriptedDb([1]) });
  const actions = run(t.w);
  checkData(t.w, { action: actions.at(-1).id, query: COUNT, expect: 1 });
  assert.deepEqual(family(t, "duplicate"), []);
  assert.equal(family(t, "persistence")[0].outcome, "OBSERVED_EXPECTED_BEHAVIOR");
});

test("one click producing two equivalent writes and two records: CONFIRMED_DEFECT with the exact action and observations", () => {
  const t = started({ requests: [post(1), post(2)], db: scriptedDb([2]) });
  const actions = run(t.w);
  const check = checkData(t.w, { action: actions.at(-1).id, query: COUNT, expect: 1 });
  const [dup] = family(t, "duplicate");
  assert.equal(dup.outcome, "CONFIRMED_DEFECT");
  assert.equal(dup.oracle, "contradiction");
  assert.equal(dup.action, actions.at(-1).id);
  assert.ok(dup.evidence.includes(check.id));
  assert.ok(dup.evidence.some((e) => e.startsWith("obs-")));
  assert.match(dup.source.src, /x\.ts:1/);
  assert.equal(family(t, "persistence").length, 0);
});

test("two equivalent writes the server absorbed into one record: suspected, not confirmed", () => {
  const t = started({ requests: [post(1), post(2)], db: scriptedDb([1]) });
  checkData(t.w, { action: run(t.w).at(-1).id, query: COUNT, expect: 1 });
  const [dup] = family(t, "duplicate");
  assert.equal(dup.outcome, "SUSPECTED_DEFECT");
  assert.match(dup.actual, /absorbed/);
});

test("a legitimate, declared HTTP retry is never a confirmed defect", () => {
  const t = started({ requests: [post(1, { status: 503 }), post(2)], db: scriptedDb([1]), settings: { duplicates: { polling: [], retries: [{ match: "/api/things", method: "POST", attempts: 3 }], idempotent: [], intentional: [], contracts: [] } } });
  checkData(t.w, { action: run(t.w).at(-1).id, query: COUNT, expect: 1 });
  const fs = findingsOf(t);
  assert.equal(fs.find((f) => f.family === "duplicate").outcome, "OBSERVED_EXPECTED_BEHAVIOR");
  assert.ok(!fs.some((f) => f.outcome === "CONFIRMED_DEFECT"));
  assert.ok(!fs.some((f) => f.family === "failed-call"), "a 503 the retry recovered is not a failed call");
});

test("a CORS preflight and the real request are not duplicates", () => {
  const t = started({ requests: [post(1, { method: "OPTIONS", status: 204, body: undefined }), post(2)], db: scriptedDb([1]) });
  run(t.w);
  assert.deepEqual(family(t, "duplicate"), []);
});

test("framework development-only duplicates: environment-aware, never confirmed on a development build", () => {
  const dev = { id: "dev", origin: "https://app.test", kind: "development", modes: ["explore-write"] };
  const t = started({ env: "dev", requests: [post(1), post(2)], db: scriptedDb([2]), settings: { environments: [dev] } });
  checkData(t.w, { action: run(t.w).at(-1).id, query: COUNT, expect: 1 });
  const [dup] = family(t, "duplicate");
  assert.equal(dup.outcome, "SUSPECTED_DEFECT");
  assert.match(dup.needs.join(" "), /non-development build/);
});

test("missing request detail: the evidence says it is incomplete instead of inventing it", () => {
  const t = started({ details: false, requests: [post(1), post(2)], db: scriptedDb([null]) });
  const last = run(t.w).at(-1);
  const net = model(t).observations.find((o) => o.action === last.id && o.layer === "network");
  assert.equal(net.data.detail, "unavailable");
  checkData(t.w, { action: last.id, query: COUNT, expect: 1 });
  const [dup] = family(t, "duplicate");
  assert.equal(dup.outcome, "INCONCLUSIVE");
  assert.ok(dup.missing.includes("payload"));
  assert.ok(dup.missing.some((m) => /request detail: unavailable/.test(m)));
});

test("the API answers success and no record is persisted: a contract-dependent CONFIRMED data finding", () => {
  const t = started({ requests: [post(1)], db: scriptedDb([0]) });
  checkData(t.w, { action: run(t.w).at(-1).id, query: COUNT, expect: 1 });
  const [p] = family(t, "persistence");
  assert.equal(p.outcome, "CONFIRMED_DEFECT");
  assert.equal(p.oracle, "contradiction");
  assert.match(p.actual, /answered 201/);
});

test("documented asynchronous persistence: a bounded consistency window, polled, and nothing accused inside it", () => {
  const t = started({ requests: [post(1)], db: scriptedDb([0, 0, 1]), graph: (g) => { g.effectOn.get("dlg-thing/Save").timing = "deferred"; }, settings: { consistency: { deferred: 30 } } });
  const c = checkData(t.w, { action: run(t.w).at(-1).id, query: COUNT, expect: 1 });
  assert.equal(c.attempts, 3);
  assert.equal(c.within, 30);
  assert.equal(family(t, "persistence")[0].outcome, "OBSERVED_EXPECTED_BEHAVIOR");
});

test("asynchronous persistence nobody put a window on asks for a requirement, not a defect", () => {
  const t = started({ requests: [post(1)], db: scriptedDb([0]), graph: (g) => { g.effectOn.get("dlg-thing/Save").timing = "deferred"; } });
  checkData(t.w, { action: run(t.w).at(-1).id, query: COUNT, expect: 1 });
  assert.equal(family(t, "persistence")[0].outcome, "REQUIRES_REQUIREMENT");
});

test("missing database credentials: the data check is BLOCKED, never a defect", () => {
  const t = started({ requests: [post(1)], sql: false });
  const c = checkData(t.w, { action: run(t.w).at(-1).id, query: COUNT, expect: 1 });
  assert.equal(c.state, "blocked");
  assert.equal(family(t, "persistence")[0].outcome, "BLOCKED");
  const refused = started({ requests: [post(1)], db: scriptedDb([null]) });
  assert.equal(checkData(refused.w, { action: run(refused.w).at(-1).id, query: COUNT, expect: 1 }).state, "blocked");
});

test("a data check is read-only and names only tables the map records", () => {
  const t = started({ requests: [post(1)], db: scriptedDb([1]) });
  const id = run(t.w).at(-1).id;
  assert.throws(() => checkData(t.w, { action: id, query: "DELETE FROM Things", expect: 0 }), /read-only/);
  assert.throws(() => checkData(t.w, { action: id, query: "SELECT * FROM Invoices", expect: 0 }), /never guessed/);
});

test("the observation boundary: only requests after the mark, a quiet log waited for, a console error seen", () => {
  const early = { n: 1, method: "POST", url: "https://app.test/api/things", status: 201, at: 0, body: "{}" };
  const t = started({ requests: [early, post(2, { respondsAfterMs: 1500 })], db: scriptedDb([1]), consoleLog: [{ level: "error", text: "boom Bearer abc.def.ghi", afterCall: ["click", "getByRole('button',{name:'Save'})"] }] });
  const last = run(t.w).at(-1);
  const obs = model(t).observations.filter((o) => o.action === last.id);
  const net = obs.find((o) => o.layer === "network");
  assert.deepEqual(net.data.requests.map((r) => r.n), [2]);
  assert.equal(net.data.settled, true);
  assert.equal(net.data.requests[0].status, 201, "waited for the answer rather than reading it in flight");
  assert.equal(obs.find((o) => o.layer === "console").data.errors, 1);
  assert.equal(family(t, "console")[0].outcome, "SUSPECTED_DEFECT");
});

test("explore: the plan's controls, reached through the map, synthetic values typed, one boundary each", () => {
  const t = started({ requests: [post(1)], db: scriptedDb([1]) });
  const out = explore(t.w, model(t).plan);
  const m = model(t);
  assert.equal(out.stopped, null);
  assert.ok(m.actions.some((a) => a.on === "dlg-thing/Save" && a.state === "done"));
  assert.ok(m.actions.some((a) => a.do === "fill" && /^TC-/.test(Object.values(a.synthetic)[0])));
  assert.ok(!t.browser.calls.some((c) => c[0] === "click" && /Archive|Delete/.test(c[1])));
});

// ------------------------------------------------------------------- phase 3
test("a reproduction that passes after the original failure keeps BOTH observations and downgrades the confirmation", () => {
  const db = scriptedDb([2, 1]);
  const t = started({ requests: [post(1), post(2), post(3, { afterCall: ["click", "getByRole('button',{name:'Save'})"], at: undefined })], db });
  checkData(t.w, { action: run(t.w).at(-1).id, query: COUNT, expect: 1 });
  const [original] = family(t, "duplicate");
  assert.equal(original.outcome, "CONFIRMED_DEFECT");
  const rep = reproduce(t.w, original.id);
  assert.equal(rep.reproduced, false);
  const now = family(t, "duplicate")[0];
  assert.equal(now.outcome, "SUSPECTED_DEFECT");
  assert.equal(now.reproduced, "0 of 1");
  const history = model(t).history.filter((f) => f.key === original.key);
  assert.ok(history.some((f) => f.outcome === "CONFIRMED_DEFECT"), "the original record is still in the journal");
  assert.ok(model(t).actions.some((a) => a.reproduces));
});

test("a draft only for an accepted oracle: an observation stays one, a contradiction becomes a validated DRAFT", () => {
  const t = started({ requests: [post(1)], db: scriptedDb([1]), consoleLog: [{ level: "error", text: "boom", afterCall: ["click", "getByRole('button',{name:'Save'})"] }] });
  const last = run(t.w).at(-1);
  checkData(t.w, { action: last.id, query: COUNT, expect: 1 });
  const drafts = createDrafts(t.machine.store.root, t.machine.io);
  const consoleFinding = family(t, "console")[0];
  const none = draftFor(t.w, consoleFinding.id, drafts);
  assert.equal(none.case, null);
  assert.match(none.why, /stays an observation/);
  const missing = started({ requests: [post(1)], db: scriptedDb([0]) });
  checkData(missing.w, { action: run(missing.w).at(-1).id, query: COUNT, expect: 1 });
  const d = draftFor(missing.w, family(missing, "persistence")[0].id, createDrafts(missing.machine.store.root, missing.machine.io));
  assert.ok(d.case, d.why);
  const saved = createDrafts(missing.machine.store.root, missing.machine.io).find(d.case);
  assert.deepEqual(validate(saved, missing.ctx.graph), []);
  assert.match(saved.note, /machine-derived/);
});

test("a finding is never an exit code: outcomes are investigation words, never PASS or FAIL", () => {
  const t = started({ requests: [post(1), post(2)], db: scriptedDb([2]) });
  checkData(t.w, { action: run(t.w).at(-1).id, query: COUNT, expect: 1 });
  assert.ok(findingsOf(t).every((f) => !["PASS", "FAIL"].includes(f.outcome)));
});

// ----------------------------------------------------- redaction · containment
test("nothing secret reaches the journal: no bearer token, no raw body, no header value outside the allow-list", () => {
  const t = started({ requests: [post(1), post(2)], db: scriptedDb([2]) });
  checkData(t.w, { action: run(t.w).at(-1).id, query: COUNT, expect: 1 });
  analyse(t.w);
  const journal = readFileSync(join(t.w.store.dirOf(t.id), "journal.jsonl"), "utf8");
  assert.equal(journal.includes("SECRET-TOKEN"), false);
  assert.equal(journal.includes('{"name":"TC-x"}'), false);
  assert.equal(journal.includes("Bearer"), false);
});

test("the report masks SQL literals and synthetic values by default, embeds its pictures, and says what it did not inspect", () => {
  const t = started({ requests: [post(1), post(2)], db: scriptedDb([2]), mode: "explore-write" });
  checkData(t.w, { action: run(t.w).at(-1).id, query: "SELECT COUNT(*) AS n FROM Things WHERE Name='TC-1a2b-1'", expect: 1 });
  analyse(t.w);
  const opts = { evidenceDir: t.w.store.evidenceDir(t.id), bytes: (p) => t.machine.io.bytes(p) };
  const html = investigationHtml(model(t), opts);
  assert.equal(html.includes("TC-1a2b-1"), false);
  assert.ok(html.includes("Name='…'"));
  assert.ok(html.includes("data:image/png;base64,"));
  assert.ok(html.includes("Not inspected"));
  assert.ok(html.includes("CONFIRMED_DEFECT"));
  const internal = investigationJson(model(t), { internal: true });
  assert.ok(internal.checks[0].query.includes("TC-1a2b-1"));
  assert.equal(internal.redacted, false);
});

test("the store keeps its room: a traversal id is refused, and an undeclared field never reaches the disk", () => {
  const t = started();
  assert.throws(() => t.w.store.read("../../etc"), /id/);
  t.w.store.append(t.id, "observation", { id: "obs-x", action: "act-1", layer: "ui", state: "observed", password: "hunter2" });
  assert.equal(readFileSync(join(t.w.store.dirOf(t.id), "journal.jsonl"), "utf8").includes("hunter2"), false);
  assert.throws(() => t.w.store.append(t.id, "verdict", { status: "PASS" }), /keeps no "verdict" record/);
});
