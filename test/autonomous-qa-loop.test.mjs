// The loop: context → decision → step → … → finish, driven the way a host's
// model drives it, on fake ports. What is under test is the ENGINE's half: that
// every decision is judged before anything runs, that evidence moves the
// frontier, that a step is written down before it runs and settled after, and
// that the loop stops for a reason it can justify.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { findCase } from "../src/dsl/load.mjs";
import { act, analyse, answer, begin, contextFor, finish, linkRun, loopWorld, modelOf, planAsInput, protocolOf, release, resume, step } from "../src/investigation/index.mjs";
import { findPlan } from "../src/qa/load.mjs";
import { aqaWorld, post, SAVE_CHAIN, scriptedDb, started } from "./autonomous-qa.harness.mjs";
import { UI_TESTS } from "./fakes/context.mjs";

const COUNT = "SELECT COUNT(*) AS n FROM Things WHERE Name='${TC}'";
const model = (t) => modelOf(t.w.store.read(t.id));
const journalLength = (t) => t.w.store.read(t.id).length;
const obligation = (ctx, kind, subject) => ctx.frontier.find((o) => o.kind === kind && (!subject || o.subject === subject));

// One decision as a host would write it, against the context it just read.
const decide = (ctx, id, target, action, more = {}) => ({ schemaVersion: 1, decisionId: id, expectedRevision: ctx.position, target, action, reason: "the next thing the frontier owes", ...more });

// The Save chain (its first `n` steps), each a decision aimed at exercising dlg-thing/Save.
function savedThrough(t, n = SAVE_CHAIN.length) {
  const ids = [];
  for (const [i, s] of SAVE_CHAIN.slice(0, n).entries()) {
    const ctx = contextFor(t.w);
    const target = obligation(ctx, "control-effect", "dlg-thing/Save") ?? ctx.frontier[0];
    ids.push(step(t.w, decide(ctx, `save-${i}`, target.id, { kind: "act", do: s.kind, ...(s.url ? { url: s.url } : {}), ...(s.on ? { on: s.on } : {}), ...(s.value ? { value: s.value } : {}) })));
  }
  return ids;
}

test("context writes nothing, and names what is owed with a template for each", () => {
  const t = started({ requests: [post(1)] });
  const before = journalLength(t);
  const ctx = contextFor(t.w);
  assert.equal(journalLength(t), before, "reading where things stand changes nothing on disk");
  assert.equal(ctx.position, before);
  assert.equal(ctx.lifecycle, "active");
  assert.ok(ctx.frontier.length > 0);
  assert.ok(ctx.frontier.every((o) => o.id.startsWith("obl-") && Array.isArray(o.can)));
  assert.ok(obligation(ctx, "control-effect", "dlg-thing/Save"), "a control the plan reaches is owed");
  assert.equal(ctx.stop, null, "nothing yet justifies stopping");
});

test("a decision is judged before anything runs — shape, forbidden fields, staleness, target, action", () => {
  const t = started({ requests: [post(1)] });
  const ctx = contextFor(t.w);
  const target = ctx.frontier[0].id;
  const goto = { kind: "act", do: "goto", url: "/home" };
  const cases = [
    [{ ...decide(ctx, "a", target, goto), schemaVersion: 2 }, /SHAPE:/],
    [{ ...decide(ctx, "b", target, goto), verdict: "PASS" }, /FORBIDDEN: .*verdict/],
    [{ ...decide(ctx, "c", target, goto), confidence: "high" }, /FORBIDDEN:/],
    [{ ...decide(ctx, "d", target, goto), note: "x" }, /FIELDS:/],
    [decide(ctx, "e", target, goto, { expectedRevision: ctx.position - 1 }), /STALE:/],
    [decide(ctx, "f", "obl-nothing", goto), /TARGET:/],
    [decide(ctx, "g", target, { kind: "check-data", action: "act-1", query: COUNT, expect: 1 }), /ACTION: .*not by check-data/],
    [decide(ctx, "h", target, { kind: "act", do: "delete-everything" }), /ACTION: act\.do is goto, click or fill/],
    [decide(ctx, "i", target, { kind: "shell", command: "rm -rf /" }), /ACTION: action\.kind is one of/],
    [decide(ctx, "j", target, goto, { hypothesis: "x".repeat(241) }), /TEXT:/],
  ];
  for (const [raw, refusal] of cases) assert.throws(() => step(t.w, raw), refusal, JSON.stringify(raw).slice(0, 80));
  assert.equal(t.browser.calls.filter((c) => c[0] === "goto").length, 0, "nothing reached the browser");
  assert.equal(journalLength(t), ctx.position, "and nothing reached the journal");
});

test("evidence moves the frontier: a write puts reading it back first, and the check it asks for settles it", () => {
  const t = started({ requests: [post(1)], db: scriptedDb([0]) });
  savedThrough(t);
  const ctx = contextFor(t.w);
  const readBack = ctx.frontier[0];
  assert.equal(readBack.kind, "post-write", "what a write owes comes before any exploration");
  assert.deepEqual(readBack.template.tables, ["Things"]);
  assert.deepEqual(readBack.template.typed, ["${TC}"]);
  const answered = step(t.w, decide(ctx, "read-back", readBack.id, { kind: "check-data", action: readBack.template.action, query: COUNT, expect: 1 }));
  assert.equal(answered.state, "done");
  assert.equal(answered.progress, true);
  assert.deepEqual(answered.changed.find((o) => o.id === readBack.id)?.status, "violated", "a 201 over no record: the obligation does not hold");
  assert.equal(answered.findings.find((f) => f.family === "persistence").outcome, "CONFIRMED_DEFECT");
  assert.ok(answered.refs.some((r) => r.startsWith("chk-")));
});

test("the same decision sent twice runs once — the second is a replay", () => {
  const t = started({ requests: [post(1)] });
  const ctx = contextFor(t.w);
  const raw = decide(ctx, "once", obligation(ctx, "control-effect", "dlg-thing/Save").id, { kind: "act", do: "goto", url: "/home" });
  const first = step(t.w, raw);
  const again = step(t.w, raw);
  assert.equal(again.replayed, true);
  assert.equal(again.decision, first.decision);
  assert.equal(t.browser.calls.filter((c) => c[0] === "goto").length, 1, "the browser went there once");
});

test("a writing step that never settled is ambiguous: nothing writes until it is read back or a person releases it", () => {
  const t = started({ requests: [post(1)] });
  savedThrough(t, 3);
  const ctx = contextFor(t.w);
  const save = obligation(ctx, "control-effect", "dlg-thing/Save") ?? ctx.frontier[0];
  t.w.store.append(t.id, "decision", { id: "crashed", revision: ctx.position, target: save.id, action: { kind: "act", do: "click", on: "dlg-thing/Save" }, mutates: true });
  const after = contextFor(t.w);
  assert.equal(after.stop, "ambiguous-side-effect");
  assert.deepEqual(after.unsettled.map((d) => [d.id, d.mutates]), [["crashed", true]]);
  assert.throws(() => step(t.w, decide(after, "crashed", save.id, { kind: "act", do: "click", on: "dlg-thing/Save" })), /AMBIGUOUS:/);
  assert.throws(() => step(t.w, decide(after, "again", save.id, { kind: "act", do: "click", on: "dlg-thing/Save" })), /READ_BACK_FIRST:/);
  release(t.w, "crashed", "a person looked: no record was written");
  const released = contextFor(t.w);
  assert.notEqual(released.stop, "ambiguous-side-effect");
});

test("finish stops for a reason the engine can justify; a paused investigation refuses to act until it resumes", () => {
  const t = started({ requests: [post(1)] });
  const ctx = contextFor(t.w);
  const done = finish(t.w, "enough for today");
  assert.equal(done.reason, "stopped-early", "work was still open and nothing justified stopping");
  assert.equal(done.lifecycle, "paused");
  assert.ok(done.next.length > 0, "and it says what would come next");
  assert.throws(() => act(t.w, SAVE_CHAIN[0]), /paused — resume it first/);
  assert.throws(() => step(t.w, decide(contextFor(t.w), "late", ctx.frontier[0].id, { kind: "act", do: "goto", url: "/home" })), /LIFECYCLE:/);
  resume(t.w, "tomorrow");
  assert.equal(contextFor(t.w).lifecycle, "active");
  assert.equal(act(t.w, SAVE_CHAIN[0]).action.state, "done");
});

test("a resume after the minutes budget ran out restarts the clock — the action budget never resets", () => {
  const t = started({ settings: { limits: { actions: 25, requestsPerAction: 40, minutes: 1, pollSeconds: 30, decisions: 50, noProgress: 4 } } });
  t.browser.clock.tick(61 * 60000 + Date.parse(model(t).meta.at) - t.browser.clock.now());
  assert.throws(() => act(t.w, SAVE_CHAIN[0]), /minute budget is spent/);
  assert.equal(contextFor(t.w).stop, "budget-exhausted");
  finish(t.w);
  resume(t.w, "a person gave it another stretch");
  assert.equal(act(t.w, SAVE_CHAIN[0]).action.state, "done");
});

test("a question parks what it is about until a person answers", () => {
  const t = started({ requests: [post(1)] });
  const ctx = contextFor(t.w);
  const target = ctx.frontier[0];
  const asked = step(t.w, decide(ctx, "ask-1", target.id, { kind: "ask", asks: "May two things share a name?" }));
  assert.ok(asked.refs.some((r) => r.startsWith("qst-")));
  const parked = contextFor(t.w);
  assert.ok(!parked.frontier.some((o) => o.id === target.id), "it waits for the answer instead of being taken again");
  assert.equal(parked.recall.questions.length, 1);
  answer(t.w, parked.recall.questions[0].id, "No — a name is unique per tenant.");
  assert.ok(contextFor(t.w).frontier.some((o) => o.id === target.id), "answered, it is owed again");
});

test("PBI mode: a plan's scenarios are owed per layer, and a run of the linked case settles one", () => {
  const plan = findPlan(join(UI_TESTS, "screens"), "things");
  const t = aqaWorld({ mode: "explore-write" });
  const { id } = begin(t.make(), { objective: "verify the things plan", scope: "", inputs: [planAsInput({ ...plan, screen: undefined }, "things")] });
  const runs = [];
  const w = { ...t.make({ id }), planOf: (ref) => (ref === "things" ? { ...plan, screen: undefined } : null), findCase: () => ({ id: "create-thing", steps: [], creates: "a thing" }), digestOf: () => null, runCase: (c) => { runs.push(c); return { case: c, status: "PASS", proved: { ui: 1, api: 1, sql: 1 }, cause: null, confidence: null, evidence: "e", case_digest: null }; } };
  const ctx = contextFor(w);
  assert.equal(ctx.inputMode, "pbi");
  const sql = ctx.frontier.find((o) => o.kind === "scenario-layer" && o.subject === "things#S1" && o.layer === "sql");
  assert.ok(sql, "S1's sql commitment is owed");
  assert.ok(!ctx.frontier.some((o) => o.kind === "surface-visit"), "a PBI investigation is not sent round every screen");
  const ran = step(w, decide(ctx, "run-s1", sql.id, { kind: "run-case", case: "create-thing" }));
  assert.deepEqual(runs, ["create-thing"]);
  assert.equal(ran.changed.find((o) => o.id === sql.id)?.status, "satisfied");
  assert.ok(ran.changed.some((o) => o.subject === "things#S1" && o.layer === "ui" && o.status === "satisfied"), "one run settles every layer it proved");
});

// ------------------------------------------------ what the benchmark found
// Each of these was found by test/autonomous-qa-benchmark.test.mjs driving the
// loop end to end, and is held here on its own.

test("a read-back settles what the write owed, whichever finding its answer landed in", () => {
  const t = started({ requests: [post(1), post(2)], db: scriptedDb([2]) });
  savedThrough(t);
  const ctx = contextFor(t.w);
  const readBack = ctx.frontier[0];
  const answered = step(t.w, decide(ctx, "read-back", readBack.id, { kind: "check-data", action: readBack.template.action, query: COUNT, expect: 1 }));
  assert.equal(answered.findings.find((f) => f.family === "duplicate").outcome, "CONFIRMED_DEFECT", "two writes, two records: the duplicate finding holds the answer");
  assert.equal(answered.changed.find((o) => o.id === readBack.id)?.status, "violated", "and the read-back settled the write — it is not owed again");
  assert.equal(answered.stop, "completed-scope");
});

test("a read that repeats an earlier one teaches nothing — three of them hand the obligation to a person", () => {
  const t = started({ requests: [post(1), post(2)], db: scriptedDb([1]) });
  savedThrough(t);
  const ctx = contextFor(t.w);
  const action = { kind: "check-data", action: ctx.frontier[0].template.action, query: COUNT, expect: 1 };
  step(t.w, decide(ctx, "read-back", ctx.frontier[0].id, action));
  const need = obligation(contextFor(t.w), "finding-need");
  assert.ok(need, "two writes the server absorbed into one record: a suspicion to settle");
  const again = [1, 2, 3].map((i) => step(t.w, decide(contextFor(t.w), `again-${i}`, need.id, action)));
  assert.deepEqual(again.map((r) => r.progress), [false, false, false], "the same question, the same answer");
  assert.equal(again.at(-1).changed.find((o) => o.id === need.id)?.status, "blocked");
  assert.equal(contextFor(t.w).stop, "needs-requirement", "the loop stops instead of reading the same row until the budget runs out");
});

test("a decisionId sent again for another step is refused, never answered with the old step's result", () => {
  const t = started({ requests: [post(1)] });
  const ctx = contextFor(t.w);
  const target = obligation(ctx, "control-effect", "dlg-thing/Save").id;
  const goto = { kind: "act", do: "goto", url: "/home" };
  step(t.w, decide(ctx, "d-1", target, goto));
  assert.throws(() => step(t.w, decide(contextFor(t.w), "d-1", target, { kind: "act", do: "click", on: "home/Add" })), /ID_REUSED: d-1/);
  assert.equal(t.browser.calls.filter((c) => c[0] === "click").length, 0, "nothing ran");
  assert.equal(step(t.w, decide(ctx, "d-1", target, goto)).replayed, true, "the same step under the same id is still a replay");
});

// A PBI investigation of the fixture plan, the linked case's verdicts scripted.
function pbiWith(verdicts, planOver = (p) => p) {
  const plan = planOver({ ...findPlan(join(UI_TESTS, "screens"), "things"), screen: undefined });
  const t = aqaWorld({ mode: "explore-write" });
  const { id } = begin(t.make(), { objective: "verify the things plan", scope: "", inputs: [planAsInput(plan, "things")] });
  const runs = [];
  const w = { ...t.make({ id }), planOf: () => plan, findCase: (c) => findCase(join(UI_TESTS, "screens"), c), digestOf: () => null, runCase: (c) => { runs.push(c); return { case: c, ...verdicts.shift(), evidence: "e", case_digest: null }; } };
  return { w, runs, of: (s, layer) => loopWorld(w).obligations.find((o) => o.subject === `things#${s}` && o.layer === layer) };
}

const FAILED = { status: "FAIL", proved: { ui: 0, api: 0, sql: 0 }, cause: "PRODUCT_FAILURE", confidence: "high" };
const PASSED = { status: "PASS", proved: { ui: 1, api: 1, sql: 1 }, cause: null, confidence: null };

test("a run's failure is a person's — the loop is never sent to run it again, and a pass beside it is not satisfied", () => {
  const p = pbiWith([FAILED]);
  const ctx = contextFor(p.w);
  step(p.w, decide(ctx, "run-1", p.of("S1", "sql").id, { kind: "run-case", case: "create-thing" }));
  assert.deepEqual([p.of("S1", "sql").status, p.of("S1", "sql").blocker], ["blocked", "person"]);
  assert.ok(!contextFor(p.w).frontier.some((o) => o.kind === "finding-need"), "nothing the loop can run settles a run's failure: running it until it passes is not a fix");
  linkRun(p.w, { case: "create-thing", ...PASSED, evidence: "e", case_digest: null, authority: "accepted" });
  assert.equal(p.of("S1", "sql").status, "blocked", "a PASS after a FAIL of the same case does not make it satisfied");
  assert.match(p.of("S1", "sql").why, /1 of 2 run\(s\) passed — intermittent/);
  analyse(p.w);
  const [run] = modelOf(p.w.store.read(p.w.id)).findings.filter((f) => f.family === "run");
  assert.deepEqual([run.outcome, run.pattern, run.occurrences.length], ["SUSPECTED_DEFECT", "intermittent", 2], "both runs are occurrences of one finding");
});

test("the plan's own word comes first: a manual check and a scenario not ready are a person's, and a destructive case never runs", () => {
  const p = pbiWith([PASSED], (plan) => ({ ...plan, scenarios: plan.scenarios.map((s) => (s.id === "S3" ? { ...s, readiness: "draft" } : s)) }));
  assert.match(p.of("S2", "ui").why, /manual check — a person performs it/);
  assert.match(p.of("S3", "ui").why, /S3 is not ready/);
  assert.deepEqual([p.of("S4", "ui").status, p.of("S4", "ui").blocker], ["blocked", "person"]);
  assert.match(p.of("S4", "ui").why, /archive-thing is destructive/);
  const ctx = contextFor(p.w);
  assert.throws(() => step(p.w, decide(ctx, "rogue", p.of("S1", "sql").id, { kind: "run-case", case: "archive-thing" })), /ACTION: archive-thing is destructive/);
  assert.deepEqual(p.runs, [], "refused before anything ran");
});

test("the protocol is printed from its tables", () => {
  const p = protocolOf();
  assert.equal(p.schemaVersion, 1);
  assert.deepEqual(p.actions.map((a) => a.kind), ["act", "check-data", "security", "reproduce", "run-case", "ask"]);
  assert.ok(p.forbidden.includes("verdict") && p.forbidden.includes("approved"));
  assert.ok(p.stops.some((s) => s.id === "completed-scope" && s.lifecycle === "completed"));
});
