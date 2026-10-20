// ORBIT LIVE'S LOOK, 0.0.2 (ADR 0028): the pane a person reads beside an AI CLI, as its mockup draws it -- the badge
// (the orbit, a dot, the word) on the header's right; each view's key over its label with the view's own words beside
// them; TASK EXECUTION with NOW on its right; the baseline's runs in a bordered card; the step a person's eye goes to in
// the brand's tone; a workflow's milestones under the step whose turn it was; the progress bars on the right edge and
// the status bar spread across the width -- and the orbit drawn every frame while it turns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { frameOf } from "../src/live/tui/frame.mjs";
import { derivedOf } from "../src/live/tui/derive.mjs";
import { contextOf } from "../src/live/tui/frame.mjs";
import { paneOf } from "../src/live/tui/pane.mjs";
import { reduce } from "../src/live/tui/reducer.mjs";
import { checklistOf, viewOf } from "../src/live/tui/workspace.mjs";
import { eventsView } from "../src/live/tui/events-view.mjs";
import { unstyled } from "../src/live/render/ansi.mjs";
import { displayWidth } from "../src/live/render/width.mjs";
import { ENG, NOW, WF, ago, engEvents, engView, fed, stateOf, wfView, workflow } from "./live-tui.fixture.mjs";

const screen = (s) => frameOf(s).lines.map((l) => unstyled(l).trimEnd());

const pane = (columns, rows) => workflow({ columns, rows, start: { layout: "pane" } });

test("the header names where the viewer stands and carries the badge -- the orbit, a dot and ORBITING -- with the task's kind and age", () => {
  const head = screen(pane(100, 40))[0];
  assert.match(head, /ORBIT LIVE +refunds → feature\/refunds +.* ● ORBITING +workflow · \d+m\d+s$/);
  assert.doesNotMatch(head, /tsk-/, "the task's id is NOW's first line, never the pane header's");
  assert.match(screen(workflow({ columns: 100, rows: 40 }))[0], /tsk-/, "the dashboard keeps naming which task it shows");
});

test("the tabs are each view's key and label on one row where the six fit, the picked view's words after them", () => {
  const lines = screen(pane(100, 40));
  const tabs = lines.find((l) => /^1: Events {2}2: Tests {2}3: Changes {2}4: Notices {2}5: Plan {2}6: Timeline/.test(l));
  assert.ok(tabs, lines.join("\n"));
  assert.match(tabs, /newest on top · milestones$/, "the hint, cut at a part, never inside one");
});

test("a pane too narrow for one row puts each view's key over its label, never cutting a key", () => {
  const lines = screen(pane(60, 40));
  const keys = lines.findIndex((l) => /^1: +2: +3: +4: +5: +6:/.test(l));
  assert.ok(keys > 0, lines.join("\n"));
  assert.match(lines[keys + 1], /^Events +Tests +Changes +Notices +Plan +Timeline/);
});

test("TASK EXECUTION says NOW on its right, and the baseline's runs are a card with a border and a status column", () => {
  const lines = screen(pane(72, 48));
  assert.ok(lines.some((l) => /^TASK EXECUTION +NOW$/.test(l)), lines.join("\n"));
  const top = lines.findIndex((l) => l.startsWith("╭"));
  assert.match(lines[top + 1], /^│ ▶ Baseline \(before the change\) +status │$/);
  assert.match(lines[top + 2], /^│ {3}✓ build +PASSED │$/);
  assert.ok(lines.slice(top + 1).some((l) => l.startsWith("╰")), "the card is closed");
  for (const l of frameOf(pane(72, 48)).lines) assert.equal(displayWidth(unstyled(l)), 71);
});

test("wide puts NOW beside the checklist, and ASCII draws the card's border in plain characters", () => {
  const lines = screen(pane(120, 40));
  assert.ok(lines.some((l) => /^✓ Requirements .* Context /.test(l) || /Requirements.*(task|Context)/.test(l)), lines.join("\n"));
  const ascii = screen(workflow({ columns: 72, rows: 48, ascii: true, start: { layout: "pane" } }));
  assert.ok(ascii.some((l) => /^\+-+\+$/.test(l)), ascii.join("\n"));
});

test("the step a person's eye goes to is in the brand's tone: the one running, else the newest that ran", () => {
  const s = pane(100, 40);
  const rows = checklistOf(contextOf(s, derivedOf(s))).filter((r) => r.depth === 0);
  const engineering = rows.find((r) => /Engineering/.test(r.left.map((x) => x.text).join("")));
  assert.equal(engineering.left.find((x) => x.text === "Engineering").tone, "title");
  assert.ok(rows.filter((r) => r !== engineering).every((r) => r.left.every((x) => x.tone !== "title")));
});

test("a workflow's milestones sit under the step whose turn it was, newest on top; every other task keeps the flat list", () => {
  const ev = (n, s, kind, over = {}) => ({ source: "task", n, at: ago(s), kind, ...over });
  const events = [ev(0, 400, "created"), ev(1, 379, "receipt", { domain: "step", ref: "requirement", outcome: "SUCCEEDED" }), ev(2, 300, "receipt", { domain: "task", ref: ENG, outcome: "STARTED" }), ev(3, 20, "blocked", { stop: "ENVIRONMENT_BLOCKED", needs: "capability" })];
  const view = wfView({ actions: [{ id: "act-1", type: "engine.run", state: "succeeded", startedAt: ago(390), endedAt: ago(380), receipts: [] }, { id: "act-3", type: "agent.dispatch", state: "running", startedAt: ago(301), endedAt: null, receipts: [] }] });
  const s = fed(fed(stateOf({ root: WF, columns: 100, rows: 40, start: { layout: "pane" } }), WF, view, events), ENG, engView(), engEvents(), "child");
  const v = eventsView(contextOf(s, derivedOf(s)));
  const words = v.rows.map((r) => r.left.map((x) => x.text).join(""));
  assert.match(words[0], /Engineering/, words.join("\n"));
  assert.match(words[1], /▲ .*Blocked: ENVIRONMENT_BLOCKED · needs capability/);
  assert.ok(words.findIndex((w) => /Requirement/.test(w) && !/snapshot/.test(w)) > words.findIndex((w) => /Engineering task started/.test(w)), "the older step below");
  assert.equal(v.hint, "newest on top · milestones · every line · scroll");
  const flat = eventsView(contextOf(fed(stateOf({ columns: 100, rows: 40 }), ENG, engView(), engEvents()), derivedOf(fed(stateOf({ columns: 100, rows: 40 }), ENG, engView(), engEvents()))));
  assert.ok(flat.rows.every((r) => r.status === undefined), "an engineering task's list has no step heads");
});

test("the status bar is spread across the width with a dot between each part, ending in the indicator's word", () => {
  const lines = screen(pane(100, 40));
  const bar = lines.find((l) => /^STEPS /.test(l));
  assert.match(bar, /^STEPS \d+\/\d+ +· +CHECKS \d+\/\d+ +· +EXECUTING +· +ORBITING$/);
  assert.ok(bar.length >= 95, "the parts share the whole width");
});

test("the pane's answer carries the header in parts, a card's rows by their box, and each view's hint", () => {
  const p = paneOf(pane(100, 40));
  assert.deepEqual(p.headerParts.badge.map((x) => x.text).join("").trim().split(/\s+/).slice(-2), ["●", "ORBITING"]);
  assert.match(p.headerParts.right.map((x) => x.text).join(""), /^workflow · /);
  assert.ok(p.checklist.some((r) => r.box === "baseline"));
  assert.equal(p.views.find((v) => v.id === "events").hint, "newest on top · milestones · every line · scroll");
  assert.equal(viewOf(contextOf(pane(100, 40), derivedOf(pane(100, 40))), "plan").hint, null);
});

test("a frame says whether the orbit turns in it, so the viewer draws every frame of it and none once it rests", () => {
  assert.equal(frameOf(pane(100, 40)).orbiting, true);
  const done = reduce(fed(stateOf({ columns: 100, rows: 40, start: { layout: "pane" } }), ENG, engView({ lifecycle: "COMPLETED", terminal: true, ended: { kind: "completed", at: ago(30) } }), engEvents()), { type: "tick", nowMs: NOW });
  assert.equal(frameOf(done).orbiting, false);
});

test("a whole line says what it came to: a run that failed red, one that passed green, a step that is done green, one only reported quiet", () => {
  const s = pane(100, 40);
  const rows = checklistOf(contextOf(s, derivedOf(s)));
  const toneOf = (re) => rows.flatMap((r) => r.left).find((x) => re.test(x.text)).tone;
  assert.equal(toneOf(/^test$/), "danger");
  assert.equal(toneOf(/^build$/), "success");
  assert.equal(toneOf(/Requirements/), "success");
  assert.equal(toneOf(/Project context/), "subtle");
  assert.equal(toneOf(/the tests pass/), "danger");
});

test("in the Events view a line written in the same second and tone continues the one above; the newest step is lit, older ones quiet", () => {
  const ev = (n, s, kind, over = {}) => ({ source: "task", n, at: ago(s), kind, ...over });
  const events = [ev(0, 400, "created"), ev(1, 379, "receipt", { domain: "step", ref: "requirement", outcome: "SUCCEEDED" }), ev(2, 20, "receipt", { domain: "step", ref: "engineering", outcome: "BLOCKED", summary: "nothing here provides it" }), ev(3, 20, "blocked", { stop: "ENVIRONMENT_BLOCKED", needs: "capability" })];
  const view = wfView({ actions: [{ id: "act-1", type: "engine.run", state: "succeeded", startedAt: ago(390), endedAt: ago(380), receipts: [] }, { id: "act-3", type: "agent.dispatch", state: "running", startedAt: ago(301), endedAt: null, receipts: [] }] });
  const s = fed(fed(stateOf({ root: WF, columns: 100, rows: 40, start: { layout: "pane" } }), WF, view, events), ENG, engView(), engEvents(), "child");
  const rows = eventsView(contextOf(s, derivedOf(s))).rows;
  const words = rows.map((r) => r.left.map((x) => x.text).join(""));
  const blocked = words.findIndex((w) => /Blocked: ENVIRONMENT_BLOCKED/.test(w));
  assert.match(words[blocked + 1], /^ {13}Step engineering blocked/, words.join("\n"));
  assert.equal(rows[blocked].left[2].tone, "warning", "the newest step's warning is yellow");
  const older = rows.find((r) => /Requirement/.test(r.left.map((x) => x.text).join("")) && r.at);
  assert.equal(older.left[2].tone, "subtle");
});

test("a progress bar is a heavy line on a light one, so it reads as one bar without colour too", () => {
  const lines = screen(workflow({ columns: 100, rows: 40, start: { layout: "pane" } }));
  assert.match(lines.find((l) => /^TASK {2,}/.test(l)), /━+─+ \d+\/\d+ steps/);
});
