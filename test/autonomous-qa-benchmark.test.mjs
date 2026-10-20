// The autonomous QA BENCHMARK: scripted fake applications with an independent
// ground truth (test/fixtures/benchmark/), each driven through the loop the way
// a host drives it -- context → one decision → step → … → checkpoint → finish --
// by a SCRIPTED policy standing in for the host's model.
//
// The policy is deliberately plain. It takes the frontier's head and fills in
// the template the engine offers, and it writes only what a model would have to
// write itself: the predicate of a read-back, the value it types. So what is
// measured is the ENGINE: that what it owes leads somewhere, that it concludes
// what the evidence supports and no more, and that it never writes what nobody
// authorised.
//
// Five gates, each over every app:
//   no false confirmation   nothing correct is called a defect, and nothing is
//                           confirmed that its oracle cannot confirm
//   every defect detected   with an oracle, and evidence the journal holds --
//                           BLOCKED or INCONCLUSIVE is not "detected"
//   correct is recognised   a benchmark that a do-nothing engine passes proves
//                           nothing
//   no unauthorised write   exactly the writes truth.json expects, never a
//                           destructive control or case, only read-only SQL
//   resume and memory hold  a crash mid-write writes once; a replay, a second
//                           checkpoint or another host adds no support
// And one baseline, printed rather than gated: decisions, actions and redundant
// steps per mode and family -- what future efficiency thresholds are set from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Refused } from "../src/errors.mjs";
import { caseDigest } from "../src/dsl/index.mjs";
import { short } from "../src/hash.mjs";
import { findCase } from "../src/dsl/load.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { begin, checkpoint, contextFor, finish, modelOf, planAsInput, release, resume, step } from "../src/investigation/index.mjs";
import { projectReceipts } from "../src/investigation/memory.mjs";
import { controlOf, requiredInputs } from "../src/investigation/surfaces.mjs";
import { findPlan } from "../src/qa/load.mjs";
import { planFindings } from "../src/qa/validate.mjs";
import { triage } from "../src/query/triage.mjs";
import { resultJson } from "../src/run/result.mjs";
import { runCase } from "../src/run/run-case.mjs";
import { aqaWorld, correctTenancy, post, SAVE, scriptedDb, started, tenantWorld } from "./autonomous-qa.harness.mjs";
import { UI_TESTS, fakeContext } from "./fakes/context.mjs";
import { knowledgeWorld } from "./fakes/knowledge.mjs";

const BENCH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "benchmark");
const json = (file) => JSON.parse(readFileSync(join(BENCH, file), "utf8"));
const APPS = json("apps.json").apps;
const TRUTH = json("truth.json").apps;
const REFUNDS = json("refunds.plan.json");
const REFUND_CASE = json("refund-limit.json");
const THINGS = findPlan(join(UI_TESTS, "screens"), "things");

const DEFECTS = new Set(["CONFIRMED_DEFECT", "SUSPECTED_DEFECT"]);
const WRITING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const EFFECTS = "ui-tests/graph/effects.json";
const PLAN_FILE = "ui-tests/screens/plans.plan.json";
const CRASH = "the host process died";

// ------------------------------------------------------------------ products
// What each word in apps.json makes the fake application DO.
const REQUESTS = {
  save: (i, r) => post(i + 1, { status: r.status }),
  telemetry: (i, r) => ({ n: i + 1, method: "POST", url: "https://app.test/api/telemetry", status: r.status, afterCall: ["click", SAVE], body: "{}" }),
};

const TENANCY = { "keeps-tenants-apart": correctTenancy, "shows-a-to-everyone": () => ({ status: 200, contains: true }) };

const RULES = { "refuses-over-limit": (input) => ({ allowed: Number(input.amount) <= 100 }), "allows-everything": () => ({ allowed: true }) };

const requestsOf = (app) => (app.product.requests ?? []).map((r, i) => REQUESTS[r.call](i, r));

const timed = (app) => (app.product.timing ? (g) => { g.effectOn.get("dlg-thing/Save").timing = app.product.timing; } : undefined);

// A browser that is not there: a headless investigation that touched one would throw.
const noBrowser = () => new Proxy({}, { get: (_, key) => (key === "then" ? undefined : () => { throw new Error(`the browser was asked for ${String(key)}`); }) });

// console.log swapped for the length of one in-process command, the way a
// spawned one's stdout would be read.
function quietly(fn) {
  const lines = [];
  const was = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try { return { value: fn(), lines }; } finally { console.log = was; }
}

// -------------------------------------------------------------------- worlds
// Each way in, as the composition root would bind it (cli/autonomous-qa.mjs).
const WAYS = {
  screen: (app, rows) => started({ mode: app.mode, requests: requestsOf(app), db: scriptedDb(rows ?? app.product.rows ?? [1]), graph: timed(app), settings: app.settings ?? {} }, { objective: app.objective, scope: app.scope }),
  security: (app) => tenantWorld(app.tenancy, TENANCY[app.product.tenancy]),
  pbi: (app) => begun(aqaWorld({ mode: app.mode, browser: noBrowser() }), app, [planAsInput(REFUNDS, REFUNDS.id)]),
  hybrid: (app) => begun(aqaWorld({ mode: app.mode, requests: requestsOf(app), db: scriptedDb([1]) }), app, [planAsInput(THINGS, THINGS.id)]),
};

function begun(t, app, inputs) {
  const { id } = begin(t.make(), { objective: app.objective, scope: app.scope, inputs });
  return { ...t, id, w: t.make({ id }) };
}

const wayOf = (app) => (app.tenancy ? "security" : app.way);

// What the composition root binds beside the world: the plans, the cases, how
// a case runs, and where a receipt's result rests.
const BINDINGS = {
  screen: () => ({}),
  security: () => ({}),
  pbi: (app, runs) => ({ planOf: (ref) => (ref === REFUNDS.id ? REFUNDS : null), findCase: (id) => (id === REFUND_CASE.id ? REFUND_CASE : null), digestOf: (id) => (id === REFUND_CASE.id ? caseDigest(REFUND_CASE) : null), runCase: (id) => ranHeadless(app, id, runs) }),
  hybrid: (app, runs) => ({ planOf: (ref) => (ref === THINGS.id ? THINGS : null), findCase: (id) => fixtureCase(id), digestOf: (id) => (fixtureCase(id) ? caseDigest(fixtureCase(id)) : null), runCase: (id) => ranScripted(app, id, runs) }),
};

const fixtureCase = (id) => findCase(join(UI_TESTS, "screens"), id);

// The PBI's case, run for real by the runner with no browser at all, and
// triaged the way link-run is: the verdict and its cause are the engine's own.
function ranHeadless(app, id, runs) {
  const ctx = fakeContext({ browser: noBrowser() });
  ctx.capabilities.register({ id: "refunds.decide", apiVersion: "orbit.capability/v1", doc: "ask the refund rule what it decides", page: false, invoke: (ext, input) => RULES[app.product.rule](input) }, "benchmark");
  ctx.cases = [{ ...REFUND_CASE, _file: join(ctx.project.screensDir, "_no-screen", "cases", `${id}.json`) }];
  const dir = mkdtempSync(join(tmpdir(), "orbit-bench-run-"));
  try { return headlessFacts(ctx, id, dir, runs); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function headlessFacts(ctx, id, dir, runs) {
  const ran = resultJson(quietly(() => runCase(ctx, [join(BENCH, `${id}.json`), "--json"])).value);
  const said = JSON.parse(quietly(() => triage(ctx, [ran.evidence, "--json"])).lines.at(-1));
  runs.push({ case: id, writes: false });
  return { case: id, status: ran.status, proved: ran.proved, cause: said.type, confidence: said.confidence, evidence: "benchmark", case_digest: ran.case_digest };
}

// A fixture case the app's product answers for: the runner's verdict, scripted.
function ranScripted(app, id, runs) {
  const said = app.product.runs[id] ?? { status: "BLOCKED", proved: null };
  const c = fixtureCase(id);
  runs.push({ case: id, writes: Boolean(c?.creates || c?.destructive), destructive: Boolean(c?.destructive) });
  return { case: id, status: said.status, proved: said.proved, cause: null, confidence: null, evidence: "benchmark", case_digest: c ? caseDigest(c) : null };
}

// Project knowledge over a fake filesystem, bound the way cli/autonomous-qa.mjs
// binds it -- so a checkpoint's projection goes through the real ingest door.
const knowledgeRoom = () => knowledgeWorld({ files: { [EFFECTS]: "the map", [PLAN_FILE]: "the plans" } });

function remembering(w, k, host) {
  return { ...w, memory: { knowledge: k, tracked: k.tracked() }, receipting: { scopeOf: (o) => [o.kind === "scenario-layer" ? PLAN_FILE : EFFECTS], fingerprints: (paths) => k.source.fingerprints(paths), seen: { host, session: `claude:${short(host, 16)}` } } };
}

// ------------------------------------------------------------------- policy
// The host's model, scripted: the frontier's head, the engine's template, and
// only what a model writes itself -- the predicate, the synthetic value. Each
// host session names its decisions afresh (`prefix`): an id is unique within
// the investigation, and one reused for another step is refused (ID_REUSED).
function scriptedPolicy(graph, prefix) {
  const state = { chain: [], chainFor: null, typed: 0, n: 0 };
  const take = {
    "control-effect": (h) => nextInChain(state, graph, h),
    "surface-visit": (h) => ({ kind: "act", do: "goto", url: h.template.url }),
    "post-write": (h) => ({ kind: "check-data", action: h.template.action, query: `SELECT COUNT(*) AS n FROM ${h.template.tables[0]} WHERE Name='${h.template.typed[0]}'`, expect: h.template.expect }),
    "scenario-layer": (h) => (h.template.case ? { kind: "run-case", case: h.template.case, ...(h.template.draft ? { draft: true } : {}) } : { kind: "ask", asks: `${h.title} — which case drives it?` }),
    "tenancy-row": (h) => ({ kind: "security", rows: h.template.rows }),
    "finding-need": (h) => (h.template ? { kind: "reproduce", finding: h.template.finding } : { kind: "ask", asks: `what would settle: ${h.title}` }),
  };
  return (ctx) => {
    const head = ctx.frontier[0];
    if (!head || (ctx.stop && !readingBack(ctx, head))) return null;
    return { schemaVersion: 1, decisionId: `${prefix}-${++state.n}`, expectedRevision: ctx.position, target: head.id, action: take[head.kind](head), reason: `the frontier's head: ${head.kind}` };
  };
}

// While a write is unsettled, the one thing a host may still do is read it back.
const readingBack = (ctx, head) => ctx.stop === "ambiguous-side-effect" && head.kind === "post-write";

// A control is reached the way the map says, its required boxes typed, then clicked.
function nextInChain(state, graph, head) {
  if (!state.chain.length || state.chainFor !== head.id) Object.assign(state, { chain: chainTo(state, graph, head.template), chainFor: head.id });
  return { kind: "act", ...state.chain.shift() };
}

function chainTo(state, graph, t) {
  const control = controlOf(graph, graph.edgeOn.get(t.on));
  const fills = control.writes ? requiredInputs(graph, control).map((c) => ({ do: "fill", on: c.key, value: `TC-bench-${++state.typed}` })) : [];
  const reach = t.reach ? [{ do: "goto", url: t.reach.url }, ...t.reach.via.map((v) => ({ do: "click", on: v.key }))] : [];
  return [...reach, ...fills, { do: "click", on: t.on }];
}

// ------------------------------------------------------------------- driver
// Until the policy has nothing to send. A refusal ends the drive: a scripted
// policy that repeats a refused decision would only measure itself. A crash
// (the one error that is not a typed stop) ends it too -- the host died.
function drive(w, policy, tally, max = 60) {
  for (let i = 0; i < max; i++) {
    const d = policy(contextFor(w));
    if (!d) return tally;
    tally.sent.push(d);
    if (!stepped(w, d, tally)) return tally;
  }
  return { ...tally, overran: true };
}

function stepped(w, d, tally) {
  try { noted(tally, step(w, d)); return true; }
  catch (e) { return interrupted(e, tally); }
}

// The first decision after which a defect outcome stood -- "actions to first defect".
function noted(tally, answered) {
  if (tally.firstDefectAt === null && answered.findings.some((f) => DEFECTS.has(f.outcome))) tally.firstDefectAt = tally.sent.length;
}

// What ends a drive short, first row that applies; anything else is a bug, thrown.
const INTERRUPTIONS = [
  { is: (e) => e instanceof Refused, note: (e, tally) => tally.refused.push(e.message) },
  { is: (e) => e.message === CRASH, note: (e, tally) => { tally.crashed = true; } },
];

function interrupted(e, tally) {
  const row = INTERRUPTIONS.find((r) => r.is(e));
  if (!row) throw e;
  row.note(e, tally);
  return false;
}

const newTally = () => ({ sent: [], refused: [], crashed: false, firstDefectAt: null });

// The host dies while the step that clicked `on` is being settled: the
// decision and everything the click showed are on the journal, `settled` is not.
function crashingAt(w, on) {
  const armed = { yes: true };
  const decided = (id, decisionId) => w.store.read(id).find((r) => r.kind === "decision" && r.id === decisionId);
  const append = (id, kind, record) => {
    if (armed.yes && kind === "settled" && decided(id, record.decision)?.action?.on === on) { armed.yes = false; throw new Error(CRASH); }
    return w.store.append(id, kind, record);
  };
  return { ...w, store: { ...w.store, append } };
}

// ------------------------------------------------------------------ one app
// One session: its world, bound, driven, checkpointed and finished.
function session(app, k, host, rows) {
  const t = WAYS[wayOf(app)](app, rows);
  const runs = [];
  const bind = (w) => remembering({ ...w, ...BINDINGS[wayOf(app)](app, runs) }, k, host);
  const w = bind(t.w);
  const tally = drive(app.crash ? crashingAt(w, app.crash.settling) : w, scriptedPolicy(t.ctx.graph, host), newTally());
  const crash = tally.crashed ? recovered(app, t, bind, tally) : null;
  const end = ended(bind(t.make({ id: t.id })));
  return { t, runs, tally, crash, ...end };
}

function ended(w) {
  const last = checkpoint(w);
  const done = modelOf(w.store.read(w.id)).lifecycle === "active" ? finish(w) : null;
  return { last, done, model: modelOf(w.store.read(w.id)), journal: w.store.read(w.id), w };
}

// A NEW host session on the same journal: what the crashed step did is read
// back, the loop stops for the unsettled write, a PERSON releases it, and the
// investigation resumes -- the action budget carried over, never reset.
function recovered(app, t, bind, tally) {
  const w = bind(t.make({ id: t.id }));
  const resent = refusedWith(() => step(w, { ...tally.sent.at(-1), expectedRevision: contextFor(w).position }));
  const before = contextFor(w);
  const readBack = drive(w, scriptedPolicy(t.ctx.graph, "after-crash"), newTally());
  const paused = finish(w, "a writing step never settled");
  release(w, before.unsettled[0].id, "a person looked: one record was written");
  resume(w, "released; carry on");
  return { resent, before, readBack, paused, after: drive(w, scriptedPolicy(t.ctx.graph, "resumed"), newTally()) };
}

function refusedWith(fn) {
  try { fn(); return null; }
  catch (e) { if (e instanceof Refused) return e.message; throw e; }
}

// Every app once, memoised: each gate reads the same outcome.
const OUTCOMES = new Map();

function outcomeOf(app) {
  if (!OUTCOMES.has(app.id)) OUTCOMES.set(app.id, played(app));
  return OUTCOMES.get(app.id);
}

function played(app) {
  const k = knowledgeRoom();
  const sessions = (app.sessions ?? [{ host: "laptop-a" }]).map((s) => session(app, k, s.host, s.rows));
  return { app, k, sessions, findings: sessions.flatMap((s) => s.model.findings.map((f) => ({ ...f, journal: s.journal }))) };
}

// -------------------------------------------------------------- the reading
const about = (f, x) => f.family === x.family && f.key.includes(x.subject);
const resolves = (f) => f.evidence.length > 0 && f.evidence.every((e) => f.journal.some((r) => r.id === e));

// A defect is detected by a defect outcome that names an oracle and cites only
// evidence the journal holds; a confirmable one must be CONFIRMED.
const detects = (x) => (f) => about(f, x) && DEFECTS.has(f.outcome) && f.oracle && f.oracle !== "none" && resolves(f) && (!x.confirmable || f.outcome === "CONFIRMED_DEFECT");

// A confirmation the truth does not back: a correct behaviour called a
// defect, or a defect confirmed that its oracle cannot confirm.
const unbacked = (truth) => (f) => f.outcome === "CONFIRMED_DEFECT" && !truth.defects.some((x) => about(f, x) && x.confirmable);

// What every session wrote: writing controls clicked, write probes sent, cases that write run.
function writesOf(o) {
  const graph = o.sessions[0].t.ctx.graph;
  const counts = {};
  const bump = (k) => { counts[k] = (counts[k] ?? 0) + 1; };
  o.sessions.forEach((s) => { clicked(s.t.browser, graph).forEach(bump); probed(s.t.browser).forEach(bump); s.runs.filter((r) => r.writes).forEach((r) => bump(r.case)); });
  return counts;
}

// A headless app's browser is a proxy that answers nothing: it made no calls.
const callsOf = (browser) => (Array.isArray(browser.calls) ? browser.calls : []);

function clicked(browser, graph) {
  const edges = callsOf(browser).filter((c) => c[0] === "click").map((c) => graph.edges.find((e) => e.selector === c[1])).filter(Boolean);
  return edges.filter((e) => controlOf(graph, e).writes || e.destructive).map((e) => `${e.from}/${e.via}`);
}

const probed = (browser) => callsOf(browser).filter((c) => c[0] === "eval" && /^fetch\(/.test(String(c[1]))).map((c) => /method:"(\w+)"/.exec(c[1])?.[1]).filter((m) => WRITING.has(m)).map((m) => `probe ${m}`);

const destructiveTouched = (o) => o.sessions.some((s) => s.runs.some((r) => r.destructive) || clickedEdges(s).some((e) => e.destructive));

const clickedEdges = (s) => callsOf(s.t.browser).filter((c) => c[0] === "click").map((c) => s.t.ctx.graph.edges.find((e) => e.selector === c[1])).filter(Boolean);

const queriesOf = (o) => o.sessions.flatMap((s) => s.t.ctx.db?.seen?.queries ?? []);

// ------------------------------------------------------------------- gates
test("the benchmark's own ground: every app has a truth, and its PBI plan and case are valid", () => {
  assert.deepEqual(APPS.map((a) => a.id).sort(), Object.keys(TRUTH).sort(), "an app with no truth measures nothing, and a truth with no app is a claim about nothing");
  const ctx = fakeContext({ browser: noBrowser() });
  ctx.capabilities.register({ id: "refunds.decide", apiVersion: "orbit.capability/v1", doc: "the refund rule", page: false, invoke: () => ({ allowed: false }) }, "benchmark");
  assert.deepEqual(validate(REFUND_CASE, ctx.graph, ctx.dsl, ctx.validators), []);
  assert.deepEqual(planFindings(REFUNDS, { cases: new Map([[REFUND_CASE.id, REFUND_CASE]]), graph: ctx.graph, validate: (c) => validate(c, ctx.graph, ctx.dsl, ctx.validators) }).filter((f) => f.level === "error"), []);
});

test("gate: no false confirmation — nothing correct is called a defect, and nothing is confirmed its oracle cannot confirm", () => {
  const unbackedBy = APPS.map((app) => [app.id, outcomeOf(app).findings.filter(unbacked(TRUTH[app.id])).map((f) => `${f.key}: ${f.actual}`)]);
  assert.deepEqual(unbackedBy.filter(([, xs]) => xs.length), []);
});

test("gate: every seeded defect is detected — a defect outcome, an oracle, evidence the journal holds", () => {
  const missed = APPS.flatMap((app) => TRUTH[app.id].defects.filter((x) => !outcomeOf(app).findings.some(detects(x))).map((x) => `${app.id}: ${x.family} ${x.subject} (${outcomeOf(app).findings.filter((f) => about(f, x)).map((f) => f.outcome).join(", ") || "no finding at all"})`));
  assert.deepEqual(missed, []);
});

test("gate: every correct behaviour is recognised as expected — undecided is not a pass", () => {
  const unrecognised = APPS.flatMap((app) => TRUTH[app.id].holds.filter((x) => { const said = outcomeOf(app).findings.filter((f) => about(f, x)); return !said.length || said.some((f) => f.outcome !== "OBSERVED_EXPECTED_BEHAVIOR"); }).map((x) => `${app.id}: ${x.family} ${x.subject} (${outcomeOf(app).findings.filter((f) => about(f, x)).map((f) => f.outcome).join(", ") || "no finding"})`));
  assert.deepEqual(unrecognised, []);
});

test("gate: no side effect nobody authorised — exactly the expected writes, no destructive control or case, read-only SQL", () => {
  for (const app of APPS) {
    const o = outcomeOf(app);
    assert.deepEqual(writesOf(o), TRUTH[app.id].writes, `${app.id}: what it wrote`);
    assert.equal(destructiveTouched(o), false, `${app.id}: a destructive control or case`);
    assert.deepEqual(queriesOf(o).filter((q) => !/^\s*(SELECT|WITH)\b/i.test(q)), [], `${app.id}: SQL that is not a read`);
    assert.ok(o.sessions.every((s) => !s.tally.overran), `${app.id}: the loop reached a stop on its own`);
  }
});

test("gate: a crash mid-write resumes without writing twice — the resend is AMBIGUOUS, the write is read back, a person releases it", () => {
  const [s] = outcomeOf(APPS.find((a) => a.crash)).sessions;
  assert.equal(s.tally.crashed, true, "the host died while the Save click was being settled");
  assert.match(s.crash.resent ?? "", /^AMBIGUOUS:/, "the same decision sent again is refused, never run again");
  assert.equal(s.crash.before.stop, "ambiguous-side-effect");
  assert.deepEqual(s.crash.readBack.sent.map((d) => d.action.kind), ["check-data"], "the one step taken while it is unsettled reads the write back");
  assert.deepEqual([s.crash.paused.reason, s.crash.paused.lifecycle], ["ambiguous-side-effect", "paused"]);
  assert.equal(s.model.lifecycle, "completed", "released and resumed, it finishes its scope");
  assert.ok(s.model.decisions.length >= s.tally.sent.length + s.crash.readBack.sent.length, "the decision budget carried over the crash and the resume");
});

test("gate: memory keeps what held, contests what failed, and a replay adds nothing", () => {
  for (const app of APPS) {
    const o = outcomeOf(app);
    const support = () => o.k.know.all().map((c) => [c.id, c.support.sessions, c.support.against]);
    const before = support();
    for (const s of o.sessions) {
      const again = checkpoint(s.w);
      assert.deepEqual([again.receipts, again.projected], [[], []], `${app.id}: a second checkpoint keeps nothing new`);
      projectReceipts(remembering(s.w, o.k, "laptop-z"), s.model.receipts);
    }
    assert.deepEqual(support(), before, `${app.id}: a replay from this host or another adds no support`);
  }
  const twice = outcomeOf(APPS.find((a) => a.sessions));
  const [claim] = twice.k.know.all().filter((c) => c.subject.startsWith("dlg-thing"));
  assert.ok(claim, "Monday's result reached knowledge");
  assert.ok(claim.support.against >= 1, "Tuesday's contradiction counts against it — contested");
  assert.equal(claim.relation, "satisfies", "and never overwrote it");
});

test("baseline: decisions, actions and redundant steps per mode and family", (t) => {
  const rows = APPS.map((app) => baselineOf(outcomeOf(app)));
  const groups = [...new Set(rows.map((r) => `${r.mode} · ${r.family}`))].map((g) => summed(g, rows.filter((r) => `${r.mode} · ${r.family}` === g)));
  t.diagnostic("mode · family              apps  decisions  actions  checks  runs  probes  redundant  refused  to-first-defect");
  for (const g of groups) t.diagnostic(`${g.group.padEnd(26)} ${String(g.apps).padStart(4)}  ${String(g.decisions).padStart(9)}  ${String(g.actions).padStart(7)}  ${String(g.checks).padStart(6)}  ${String(g.runs).padStart(4)}  ${String(g.probes).padStart(6)}  ${String(g.redundant).padStart(9)}  ${String(g.refused).padStart(7)}  ${g.toFirstDefect}`);
  t.diagnostic("app                            how each session ended");
  for (const app of APPS) t.diagnostic(`${app.id.padEnd(30)} ${outcomeOf(app).sessions.map(endOf).join(" · ")}`);
  assert.ok(rows.every((r) => r.redundant <= r.decisions));
  assert.equal(rows.reduce((n, r) => n + r.refused, 0), 0, "a policy that follows the frontier is never refused");
});

// The stop the last finish recorded, and where the investigation stands.
const endOf = (s) => `${s.journal.filter((r) => r.kind === "completed").at(-1)?.reason ?? "—"} (${s.model.lifecycle})`;

function baselineOf(o) {
  const m = o.sessions.map((s) => s.model);
  const sum = (f) => m.reduce((n, x) => n + f(x), 0);
  const first = o.sessions.map((s) => s.tally.firstDefectAt).find((n) => n !== null) ?? null;
  return { mode: o.app.mode, family: TRUTH[o.app.id].defects[0]?.family ?? "clean", decisions: sum((x) => x.decisions.length), actions: sum((x) => x.actions.length), checks: sum((x) => x.checks.length), runs: sum((x) => x.runs.length), probes: sum((x) => x.security.length), redundant: sum((x) => x.settled.filter((s) => s.progress === false && s.state !== "released").length), refused: o.sessions.reduce((n, s) => n + s.tally.refused.length, 0), toFirstDefect: first };
}

function summed(group, rows) {
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  const firsts = rows.map((r) => r.toFirstDefect).filter((n) => n !== null);
  return { group, apps: rows.length, decisions: sum("decisions"), actions: sum("actions"), checks: sum("checks"), runs: sum("runs"), probes: sum("probes"), redundant: sum("redundant"), refused: sum("refused"), toFirstDefect: firsts.length ? `${Math.min(...firsts)}–${Math.max(...firsts)}` : "—" };
}
