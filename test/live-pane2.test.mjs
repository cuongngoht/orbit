// LIVE PANE 2.0 (1.8.6, ADR 0022): the LIVE indicator moves on EVIDENCE -- a running action, a check's observation,
// a journal line -- and its pulse's phase is the newest evidence's, never the clock that redraws; one indicator word
// per state, each reachable; a coordinated workflow's plan reaches a viewer whole (the projection its source made),
// with each step's state in words its evidence earns, its revisions and what the skill factory does per capability;
// task progress counts steps done on their own contract and never time, test progress what a runner reported; the
// timeline is one normalized fold over every source, deduplicated on a replay, each event saying how far it can be
// trusted; what the pane answers is bounded and every string in it cleaned; and the terminal draws the same pane.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INDICATOR, INDICATOR_STATES, indicatorOf } from "../src/live/indicator.mjs";
import { progressOf, replansOf, skillsOf, stepsOf } from "../src/live/plan.mjs";
import { EVIDENCE, presentationOf } from "../src/live/presentation.mjs";
import { PROVENANCE, TIMELINE_SCHEMA, timelineOf } from "../src/live/timeline.mjs";
import { derivedOf } from "../src/live/tui/derive.mjs";
import { contextOf, frameOf } from "../src/live/tui/frame.mjs";
import { actionOfKey } from "../src/live/tui/keys.mjs";
import { PANE_VIEWS } from "../src/live/tui/model.mjs";
import { paneOf } from "../src/live/tui/pane.mjs";
import { progressRows, taskProgressOf, testProgressOf } from "../src/live/tui/progress.mjs";
import { reduce } from "../src/live/tui/reducer.mjs";
import { timelineFor, timelineRows } from "../src/live/tui/timeline-view.mjs";
import { INDICATOR_WORDS, PULSE } from "../src/live/words.mjs";
import { displayWidth } from "../src/live/render/width.mjs";
import { unstyled } from "../src/live/render/ansi.mjs";
import { ENG, NOW, SETTINGS, WF, ago, engEvents, engView, fed, stateOf, wfView } from "./live-tui.fixture.mjs";

const facts = (over = {}) => ({ reads: 1, failures: 0, good: true, partial: false, terminal: false, running: false, lastEventAt: null, lastObservedAt: null, now: NOW, idleAfterMs: 120_000, ...over });

test("LIVE needs evidence the task moved: a running action, a check's observation, or a journal line -- a tick never", () => {
  assert.equal(presentationOf(facts({ running: true })).evidence, "action");
  assert.equal(presentationOf(facts({ lastObservedAt: ago(5), lastEventAt: ago(500) })).state, "LIVE", "a check printing for twenty minutes with no journal line is still moving");
  assert.equal(presentationOf(facts({ lastObservedAt: ago(5), lastEventAt: ago(500) })).evidence, "observation");
  assert.equal(presentationOf(facts({ lastEventAt: ago(30) })).evidence, "line");
  assert.equal(presentationOf(facts({ lastEventAt: ago(500), lastObservedAt: ago(400) })).state, "IDLE");
  assert.deepEqual(EVIDENCE.map((r) => r.kind), ["action", "observation", "line"]);
});

test("the pulse's phase is the newest evidence's: it stands still while nothing arrives and moves when evidence does", () => {
  const at = ago(10);
  const a = presentationOf(facts({ lastEventAt: at, now: NOW }));
  const b = presentationOf(facts({ lastEventAt: at, now: NOW + 7_000 }));
  assert.equal(a.pulse, b.pulse, "seven seconds of redraws, no new line: the same frame");
  const c = presentationOf(facts({ lastEventAt: at, lastObservedAt: new Date(Date.parse(at) + 1000).toISOString(), now: NOW + 7_000 }));
  assert.notEqual(c.pulse, a.pulse, "a new observation line moves it");
  assert.equal(presentationOf(facts()).pulse, null, "no evidence, no phase");
});

const snap = (over = {}) => ({ view: { lifecycle: "EXECUTING", ...(over.view ?? {}) }, presentation: { state: "LIVE", pulse: 2, sinceLastActivityMs: 1_000, evidence: "line", ...(over.presentation ?? {}) }, ...(over.root ?? {}) });

test("every indicator row is reachable in its order, and only ACTIVE pulses", () => {
  const cases = [
    [snap({ presentation: { state: "UNAVAILABLE" } }), "DISCONNECTED"],
    [{ view: null, presentation: { state: "IDLE" } }, "NONE"],
    [snap({ view: { lifecycle: "COMPLETED" } }), "COMPLETED"],
    [snap({ view: { lifecycle: "FAILED" } }), "FAILED"],
    [snap({ view: { lifecycle: "CANCELLED" } }), "CANCELLED"],
    [snap({ view: { lifecycle: "WAITING_APPROVAL" } }), "WAITING"],
    [snap({ view: { lifecycle: "BLOCKED" } }), "BLOCKED"],
    [snap({ presentation: { state: "DEGRADED" } }), "DEGRADED"],
    [snap(), "ACTIVE"],
    [snap({ presentation: { state: "IDLE", pulse: 2 } }), "IDLE"],
  ];
  assert.deepEqual(cases.map(([s]) => indicatorOf(s).state), INDICATOR_STATES);
  for (const [s, state] of cases) assert.equal(indicatorOf(s).pulse === null, state !== "ACTIVE", state);
  assert.equal(indicatorOf(snap()).glyph, PULSE[2]);
  assert.equal(indicatorOf(snap({ view: { lifecycle: "PAUSED" } })).word, "PAUSED", "the label says the actual state");
  assert.equal(INDICATOR.at(-1).when({}), true);
  assert.ok(INDICATOR_STATES.every((s) => INDICATOR_WORDS[s]), "every state has a word and a glyph");
});

test("a person who asked for no motion gets the still glyph, whatever arrives", () => {
  const still = indicatorOf(snap(), { pane: { animation: "off" } });
  assert.deepEqual([still.state, still.pulse, still.glyph, still.animate], ["ACTIVE", null, INDICATOR_WORDS.ACTIVE.glyph, false]);
});

// ---- the plan, through the feed's own frame ------------------------------------------------------------------

const PLAN = { ref: "0123456789abcdef", schema: 2, n: 2, workflow: "engineering", limit: 12, steps: [
  { id: "requirement", kind: "requirement", after: [], for: null, because: "PBI-1 is settled first", strict: true },
  { id: "context", kind: "context", after: [], for: null, because: "memory first", strict: false },
  { id: "engineering", kind: "engineering", after: ["requirement", "context"], for: null, because: "the change itself", strict: true },
  { id: "propose-skill", kind: "propose-skill", after: ["context"], for: "tenant.isolation.verification", because: "nothing provides it", strict: true },
  { id: "register-skill", kind: "register-skill", after: ["propose-skill"], for: "tenant.isolation.verification", because: "held to the contract", strict: true },
  { id: "playbook", kind: "playbook", after: ["context", "engineering", "register-skill"], for: "tenant.isolation.verification", because: "the objective needs it", strict: false },
  { id: "review", kind: "review", after: ["playbook"], for: null, because: "held to its plan", strict: true },
], replans: [{ n: 2, trigger: "CAPABILITY_MISSING", response: "insert-generation", step: "playbook", summary: "a draft and a register step go in before playbook" }] };

const RECEIPTS = [
  { key: "plan:0123456789abcdef", domain: "plan", ref: "0123456789abcdef", outcome: "ACTIVE", summary: "plan-2 (engineering, after CAPABILITY_MISSING at playbook): 7 step(s): requirement, context, engineering, propose-skill, register-skill, playbook, review", at: ago(200) },
  { key: "step:requirement", domain: "step", ref: "requirement", outcome: "SUCCEEDED", action: "act-1", at: ago(390) },
  { key: "step:context", domain: "step", ref: "context", outcome: "REPORTED", action: "act-2", at: ago(380) },
  { key: "step:propose-skill", domain: "step", ref: "propose-skill", outcome: "SUCCEEDED", action: "act-4", at: ago(150) },
  { key: "skill:tenant-isolation-verification", domain: "skill", ref: "tenant-isolation-verification", outcome: "DRAFT_VERIFIED", action: "act-4", summary: "the draft holds to the contract", at: ago(140) },
  { key: "step:register-skill", domain: "step", ref: "register-skill", outcome: "SUCCEEDED", action: "act-5", at: ago(100) },
  { key: "skill:tenant-isolation-verification:0.1.0:abcdef01", domain: "skill", ref: "tenant-isolation-verification:0.1.0:abcdef01", outcome: "ACTIVE", action: "act-5", summary: "reused: verified and active: tenant isolation", at: ago(100) },
  { key: "step:engineering", domain: "step", ref: "engineering", outcome: "RUNNING", action: "act-3", at: ago(300) },
  { key: `task:${ENG}`, domain: "task", ref: ENG, outcome: "STARTED", at: ago(300) },
];

const planned = (over = {}) => {
  const s = fed(fed(stateOf({ root: WF, columns: over.columns ?? 90, rows: over.rows ?? 40, start: over.start }), WF, wfView({ receipts: RECEIPTS, verification: [] }), [{ source: "task", n: 0, at: ago(400), kind: "created", objective: "tenant isolation" }]), ENG, engView(), engEvents(), "child");
  return reduce(s, { type: "frames", task: WF, frames: [{ event: "plan-view", id: "t=9", data: { source: "plan", task: WF, ref: PLAN.ref, revision: PLAN.n, view: over.plan ?? PLAN } }] });
};

test("a plan reaches a viewer whole: every step, its waits, its reason, its state in a word its evidence earns", () => {
  const s = planned();
  const d = derivedOf(s);
  const steps = stepsOf(d.root.plan, d.root.view);
  assert.deepEqual(steps.map((x) => [x.id, x.outcome]), [["requirement", "SUCCEEDED"], ["context", "REPORTED"], ["engineering", "RUNNING"], ["propose-skill", "SUCCEEDED"], ["register-skill", "SUCCEEDED"], ["playbook", "PENDING"], ["review", "PENDING"]]);
  assert.deepEqual(progressOf(steps), { done: 4, verified: 3, reported: 1, total: 7 }, "a step that may stand on a report counts once reported; a strict one only verified");
  const p = paneOf(s, d);
  assert.deepEqual(p.plan.steps.map((x) => x.state), ["VERIFIED", "REPORTED", "RUNNING", "VERIFIED", "VERIFIED", "PENDING", "PENDING"]);
  assert.equal(p.plan.n, 2);
  assert.deepEqual(p.plan.replans.map((r) => r.trigger), ["CAPABILITY_MISSING"]);
  const plan = p.views.find((v) => v.id === "plan").rows.map((r) => [...r.left, ...r.right].map((x) => x.text).join(""));
  assert.ok(plan.some((l) => /playbook .*the objective needs it.*PENDING.*← context, engineering, register-skill/.test(l)));
  assert.ok(plan.some((l) => /plan-2 CAPABILITY_MISSING → insert-generation at playbook/.test(l)));
  assert.ok(plan.some((l) => /registered ACTIVE/.test(l)));
});

test("what the skill factory did for a capability is matched by the action that did it, and a reused version says so", () => {
  const d = derivedOf(planned());
  assert.deepEqual(skillsOf(d.root.plan, d.root.view), [{ capability: "tenant.isolation.verification", drafted: "SUCCEEDED", checked: "DRAFT_VERIFIED", registered: "ACTIVE", followed: "PENDING", pin: "tenant-isolation-verification:0.1.0:abcdef01", reused: true, summary: "reused: verified and active: tenant isolation" }]);
});

test("with no projection -- a task from before 1.8.6 -- the steps and revisions are read off the receipts", () => {
  const view = { receipts: [{ domain: "plan", ref: "a", outcome: "SUPERSEDED", summary: "plan-1 (engineering): 2 step(s): context, review" }, { domain: "plan", ref: "b", outcome: "ACTIVE", summary: "plan-2 (engineering, after TASK_FAILED at review): 2 step(s): context, review" }, { domain: "step", ref: "context", outcome: "REPORTED" }] };
  assert.deepEqual(stepsOf(null, view).map((s) => [s.id, s.outcome]), [["context", "REPORTED"], ["review", "PENDING"]]);
  assert.deepEqual(replansOf(null, view), [{ n: 2, trigger: "TASK_FAILED", response: null, step: "review", summary: null }]);
});

test("task progress counts what a denominator the owners recorded says, test progress what a runner reported -- never time", () => {
  const ctx = contextOf(planned(), derivedOf(planned()));
  assert.deepEqual(taskProgressOf(ctx), { basis: "plan", done: 4, total: 7, verified: 3, reported: 1, revision: 2, unit: "steps", percent: 57 });
  const none = stateOf({ columns: 90, rows: 40 });
  assert.deepEqual(taskProgressOf(contextOf(none, derivedOf(none))), { basis: null, indeterminate: true }, "no denominator: indeterminate, never a guessed share");
  const bigger = planned({ plan: { ...PLAN, n: 3, steps: [...PLAN.steps, { id: "qa", kind: "qa", after: ["engineering"], for: null, because: "x", strict: true }] } });
  assert.equal(taskProgressOf(contextOf(bigger, derivedOf(bigger))).percent, 50, "a revision that adds work may lower the share");
});

test("a workflow's status bar counts its steps as its TASK line does, on the plan's contract -- never 7/8 beside 8/8", () => {
  const ctx = contextOf(planned(), derivedOf(planned()));
  const p = taskProgressOf(ctx);
  const bar = statusBarOf(ctx).left.map((x) => x.text).join("");
  assert.match(bar, new RegExp(`STEPS ${p.done}/${p.total}`), "a step that may stand on a report counts once reported, in both");
});

test("test progress takes a runner's own totals once it said them, as the status bar does -- VSTest prints only its failures", () => {
  const ctxOf = (observation) => ({ d: { engineering: { activities: [{ kind: "test", observation }] } } });
  const vstest = { adapter: { id: "dotnet-test", runner: "vstest" }, state: "ended", counts: { passed: 0, failed: 1, skipped: 0 }, reported: 1, total: 30, totals: { tests: 30, passed: 29, failed: 1, skipped: 0 } };
  assert.deepEqual(testProgressOf(ctxOf(vstest)), { runner: "vstest", passed: 29, failed: 1, skipped: 0, reported: 1, total: 30, pending: 0, said: true, running: false, aborted: false });
  const words = (o) => progressRows(ctxOf(o))[1].left.map((s) => s.text).join("");
  assert.match(words(vstest), /29 passed · 1 failed · of 30, as the runner said/, "never 0 passed beside a status bar that says 29/30");
  const streaming = { state: "running", counts: { passed: 12, failed: 1, skipped: 0 }, reported: 13, total: null, totals: null };
  assert.deepEqual([testProgressOf(ctxOf(streaming)).passed, testProgressOf(ctxOf(streaming)).said], [12, false], "before the runner said its totals, the cases observed");
  assert.match(words(streaming), /12 passed · 1 failed · 13 reported, total not said yet · runner running/);
  assert.match(words({ ...vstest, totals: { tests: 30, passed: 27, failed: 1 } }), /of 30, as the runner said · 2 it did not account for/, "totals that do not add up say so");
});

// ---- the timeline --------------------------------------------------------------------------------------------

test("the timeline is one normalized fold: a schema, provenance per event, a replayed line once, and two journals merged in time", () => {
  const events = [{ source: "task", n: 0, kind: "created", at: ago(30), objective: "o" }, { source: "task", n: 1, kind: "decision", at: ago(20), observed: "x" }, { source: "task", n: 1, kind: "decision", at: ago(20), observed: "y" }, { source: "task", n: 2, kind: "receipt", domain: "step", ref: "context", outcome: "REPORTED", at: ago(10) }, { source: "task", n: 3, kind: "brand-new-kind", at: ago(5) }];
  const child = [{ source: "task", n: 0, kind: "created", at: ago(25), objective: "child" }];
  const t = timelineOf({ sources: [{ task: WF, events }, { task: ENG, events: child }], limit: 40 });
  assert.ok(t.every((e) => e.schema === TIMELINE_SCHEMA));
  assert.deepEqual(t.map((e) => [e.id, e.provenance, e.type]), [[`${WF}:task:0`, "observed", "created"], [`${ENG}:task:0`, "observed", "created"], [`${WF}:task:1`, "reported", "decision"], [`${WF}:task:2`, "reported", "receipt"], [`${WF}:task:3`, "observed", "other"]]);
  assert.match(t.find((e) => e.id === `${WF}:task:1`).title, /x/, "the first delivery of a replayed line is the event");
  assert.equal(PROVENANCE.at(-1).when({}), true);
  assert.equal(timelineOf({ sources: [{ task: WF, events: Array.from({ length: 200 }, (_, i) => ({ source: "task", n: i, kind: "stage", stage: "TESTING", at: ago(300 - i) })) }], limit: 30 }).length, 30, "bounded, newest last");
});

test("a check's end in the timeline says the runner's totals and its own state -- never 0 passed, never an object", () => {
  const vstest = { action: "act-9", command: { purpose: "test", program: "dotnet", declaredAs: { file: "ledger.tests.csproj" } }, startedAt: ago(30), lastAt: ago(3), endedAt: ago(2), state: "failed", counts: { passed: 0, failed: 1 }, totals: { tests: 30, passed: 29, failed: 1 }, outcome: { exitCode: 1 }, failures: [] };
  const end = timelineOf({ sources: [{ task: ENG, events: [], observations: { "act-9": vstest } }] }).find((e) => e.type === "check.ended");
  assert.equal(end.title, "test · dotnet · 29 passed · 1 failed of 30, as the runner said");
  assert.equal(end.status, "failed", "the observation's own word, not its outcome record");
  const json = JSON.stringify(timelineRows({ d: { root: null, child: null } }, 30)) + JSON.stringify(end);
  assert.ok(!json.includes("[object Object]"));
  const tap = timelineOf({ sources: [{ task: ENG, events: [], observations: { "act-9": { ...vstest, state: "completed", counts: { passed: 48, failed: 0 }, totals: null } } }] }).find((e) => e.type === "check.ended");
  assert.equal(tap.title, "test · dotnet · 48 passed · 0 failed", "before a runner said its totals, the cases observed");
});

test("the Timeline VIEW reads like Events and Tests -- the plan's revisions first, then newest on top -- while the data keeps time order", () => {
  const ctx = contextOf(planned(), derivedOf(planned()));
  const data = timelineFor(ctx, 30);
  const rest = data.filter((e) => e.type !== "plan.revised");
  assert.ok(rest.length >= 2, "a fixture with several events");
  const lines = timelineRows(ctx, 30).filter((r) => !r.depth).map((r) => r.left.map((s) => s.text).join(""));
  assert.match(lines[0], /plan-2: CAPABILITY_MISSING at playbook/, "a pane that clips from the top still shows the revision");
  assert.ok(lines[1].endsWith(rest.at(-1).title), "then the newest");
  assert.ok(lines.at(-1).endsWith(rest[0].title), "the oldest last, where a short pane clips");
  assert.ok(data.every((e, i) => i === 0 || (data[i - 1].at ?? "") <= (e.at ?? "")), "the data itself is in time order");
});

test("a plan's revision is never scrolled out of the timeline, however busy the task -- and the timeline stays bounded", () => {
  const busy = Array.from({ length: 200 }, (_, i) => ({ source: "task", n: i + 1, kind: "stage", stage: "TESTING", at: ago(200 - i) }));
  const activated = { source: "task", n: 0, kind: "receipt", domain: "plan", ref: "0123456789abcdef", outcome: "ACTIVE", summary: "plan-2 (engineering, after CAPABILITY_MISSING at playbook): 8 step(s)", at: ago(400) };
  const replans = [{ n: 2, trigger: "CAPABILITY_MISSING", response: "insert-generation", step: "playbook", summary: "a draft and a register step go in" }];
  const t = timelineOf({ sources: [{ task: WF, events: [activated, ...busy] }], replans, limit: 30 });
  assert.equal(t.length, 30, "still the limit");
  assert.deepEqual(t.filter((e) => e.type === "plan.revised").map((e) => [e.revision, e.provenance]), [[2, "inferred"]], "the revision two hundred lines ago is kept");
  assert.equal(t.at(-1).id, `${WF}:task:200`, "the rest are the newest");
  assert.equal(timelineOf({ sources: [{ task: WF, events: busy }], replans: Array.from({ length: 40 }, (_, i) => ({ n: i + 2 })), limit: 30 }).length, 30, "revisions never break the bound");
});

test("a failed case's expected and actual travel to the timeline from the observation, and every string a pane answers is cleaned", () => {
  const evil = `adds${String.fromCharCode(27)}[2J`;
  const obs = { action: "act-6", command: { purpose: "test", program: "npm" }, startedAt: ago(9), lastAt: ago(2), endedAt: null, counts: { passed: 1, failed: 1 }, failures: [{ seq: 4, name: evil, expected: "2", actual: "1" }] };
  const t = timelineOf({ sources: [{ task: ENG, events: [], observations: { "act-6": obs } }] });
  assert.deepEqual(t.find((e) => e.type === "test.case.failed"), { schema: 1, id: `${ENG}:act:act-6:fail:4`, task: ENG, source: "activity", provenance: "observed", type: "test.case.failed", title: evil, status: "failed", expected: "2", actual: "1", evidence: "act:act-6", at: ago(2) });
  const s = reduce(fed(stateOf({ columns: 90, rows: 40 }), ENG, engView(), engEvents()), { type: "frames", task: ENG, frames: [{ event: "activity-view", id: "t=99", data: { source: "activity", task: ENG, action: "act-6", revision: 9, view: { ...obs, version: 1, state: "running", reported: 2, total: null, totals: null, recent: [], failuresMore: 0, output: null, outcome: null, aborted: null, seq: 9, complete: false, mismatch: false, gaps: [], adapter: null } } }] });
  const json = JSON.stringify(paneOf(s));
  assert.ok(!json.includes(String.fromCharCode(27)), "no escape byte reaches a drawer, in a row or in the data");
  assert.ok(json.length < 48 * 1024);
});

// ---- the pane in a terminal ----------------------------------------------------------------------------------

test("the terminal's pane layout: v switches to it, 1 to 6 pick its views, and every line is exactly the screen's width", () => {
  const pane = (s) => reduce(s, actionOfKey(s.viewer, "v"));
  for (const size of [{ columns: 44, rows: 20 }, { columns: 72, rows: 34 }, { columns: 100, rows: 40 }]) {
    let s = pane(planned(size));
    assert.equal(s.viewer.layout, "pane");
    for (const [i, id] of PANE_VIEWS.entries()) {
      s = reduce(s, actionOfKey(s.viewer, String(i + 1)));
      assert.equal(s.viewer.view, id);
      const f = frameOf(s);
      assert.equal(f.lines.length, size.rows);
      for (const line of f.lines) assert.equal(displayWidth(unstyled(line)), size.columns - 1, `${size.columns}x${size.rows} ${id}: ${line}`);
    }
  }
});

test("a terminal pane cut to its room keeps the TOP of the Timeline view, as a docked pane does -- the revision, then the newest", () => {
  const start = planned({ columns: 90, rows: 22, start: { layout: "pane" } });
  const short = reduce(start, actionOfKey(start.viewer, "6"));
  assert.equal(short.viewer.view, "timeline");
  const lines = frameOf(short).lines.map((l) => unstyled(l).trimEnd());
  const tabs = lines.findIndex((l) => /6 Timeline/.test(l));
  assert.ok(tabs >= 0, "the Timeline view is drawn");
  const ctx = contextOf(short, derivedOf(short));
  const events = timelineFor(ctx, 30).filter((e) => e.type !== "plan.revised");
  const first = lines.findIndex((l) => /plan-2: CAPABILITY_MISSING at playbook/.test(l));
  assert.ok(first > tabs, "the revision first: the view's top row is kept, under the tabs that head the column (0.0.1)");
  assert.ok(lines[first + 1].includes(events.at(-1).title.slice(0, 20)), "then the newest event, never the oldest");
});

test("the pane layout keeps progress and the LIVE indicator at the bottom edge, nearest the prompt beside it", () => {
  const s = reduce(planned({ columns: 72, rows: 34, start: { layout: "pane" } }), { type: "view", at: 4 });
  const lines = frameOf(s).lines.map((l) => unstyled(l).trimEnd());
  const status = lines.findIndex((l) => /STEPS /.test(l));
  assert.match(lines[status - 2], /^TASK +.*4\/7 steps · 57%/);
  assert.match(lines[status], /(ORBITING|IDLE)$/, "the indicator on the right of the status bar, at every width");
  assert.equal(status, lines.length - 3, "then only the rule and the footer");
  assert.ok(lines.some((l) => /plan-2 \(engineering\)/.test(l)), "the Plan view picked with 5");
});

test("a viewer an opener started beside an AI CLI starts as the pane; one a person started is the dashboard", () => {
  assert.equal(stateOf({ start: { layout: "pane" } }).viewer.layout, "pane");
  assert.equal(stateOf().viewer.layout, "dashboard");
  assert.equal(stateOf({ start: { layout: "sideways" } }).viewer.layout, "dashboard", "a layout nobody declared is the dashboard");
  assert.equal(SETTINGS.idleAfterSec, 120);
});

// ---- 1.8.6 review: what an independent read of this release found, each held here ---------------------------

import { compactLines } from "../src/live/render/compact.mjs";
import { indicatorFor, statusBarOf } from "../src/live/tui/workspace.mjs";

test("the pane layout is drawn in a column a 36% split leaves -- 44 columns -- never told it needs 60", () => {
  const s = reduce(planned({ columns: 44, rows: 24, start: { layout: "pane" } }), { type: "view", at: 4 });
  const lines = frameOf(s).lines.map((l) => unstyled(l));
  assert.ok(!lines.some((l) => /needs 60/.test(l)), lines.join("\n"));
  assert.ok(lines.some((l) => /^STEPS /.test(l.trim())), "the status bar is there");
  assert.ok(lines.some((l) => /^TASK/.test(l.trim())), "and the task's progress");
});

test("every new line of evidence moves the pulse one frame, however close together, and nothing else does", () => {
  const at = ago(10);
  const a = presentationOf(facts({ lastEventAt: at, evidenceMark: 41 }));
  const b = presentationOf(facts({ lastEventAt: at, evidenceMark: 42 }));
  assert.notEqual(a.pulse, b.pulse, "two lines in the same second are two beats");
  assert.equal(presentationOf(facts({ lastEventAt: at, evidenceMark: 42, now: NOW + 9_000 })).pulse, b.pulse, "the clock moves nothing");
});

test("a workflow's indicator pulses on the evidence of the engineering task it started, its lifecycle the workflow's", () => {
  const s = planned();
  const d = derivedOf(s);
  const ctx = contextOf(s, { ...d, root: { ...d.root, presentation: { ...d.root.presentation, state: "IDLE", pulse: null } }, child: { ...d.child, presentation: { state: "LIVE", pulse: 3, evidence: "observation", sinceLastActivityMs: 500 } } });
  const i = indicatorFor(ctx);
  assert.deepEqual([i.state, i.pulse, i.evidence], ["ACTIVE", 3, "observation"]);
});

test("a quiet task's pane answer is the same answer every time it is asked: no wall clock, no how-long-ago", () => {
  const ended = (nowMs) => ({ ...reduce(fed(stateOf({ columns: 90, rows: 40 }), ENG, engView({ lifecycle: "COMPLETED", terminal: true, actions: [], ended: { kind: "completed", at: ago(30) } }), engEvents()), { type: "tick", nowMs }) });
  const first = paneOf(ended(NOW));
  const later = paneOf(ended(NOW + 61_000));
  assert.deepEqual(first.header, later.header);
  assert.equal(first.indicator.since, undefined);
  assert.deepEqual(first.statusBar, later.statusBar);
});

test("the status line keeps its LIVE glyph still for a person who asked for no motion", () => {
  const snap = { association: { how: "session", task: ENG }, view: engView(), presentation: { state: "LIVE", pulse: 2, sinceLastLineMs: 1000 }, current: null, activities: [], failure: null, nowMs: NOW, events: [], qa: [] };
  const moving = compactLines(snap, { lines: 1, columns: 100, colour: false })[0];
  const still = compactLines({ ...snap, still: true }, { lines: 1, columns: 100, colour: false })[0];
  assert.match(moving, new RegExp(PULSE[2]));
  assert.match(still, /● ORBITING/);
});

test("a revision is placed at the moment its plan became ACTIVE, not when it was later replaced", () => {
  const events = [{ source: "task", n: 4, kind: "receipt", domain: "plan", ref: "a", outcome: "ACTIVE", summary: "plan-2 (engineering, after TASK_FAILED at review): 2 step(s): context, review", at: ago(300) }];
  const view = { receipts: [{ domain: "plan", ref: "a", outcome: "SUPERSEDED", summary: "plan-2 (engineering, after TASK_FAILED at review): 2 step(s): context, review", at: ago(20) }] };
  const [revision] = timelineOf({ sources: [{ task: WF, events }], replans: [{ n: 2, trigger: "TASK_FAILED", response: "retry", step: "review" }], view }).filter((e) => e.type === "plan.revised");
  assert.equal(revision.at, ago(300));
});
