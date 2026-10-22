// A generated test's progress as a viewer shows it (doc §9; ADR 0032): counted per OBLIGATION from the
// investigation's own milestone events -- a retry is the same test, a replayed or re-delivered event changes
// nothing, an older event never overwrites a newer one, a viewer that reconnects carries on from where it
// was, and an unknown is drawn as nothing, never as 0.
import assert from "node:assert/strict";
import { test } from "node:test";
import { activityOf } from "../src/investigation/activity.mjs";
import { qaFold, testCountsOf } from "../src/live/current.mjs";
import { lineOf } from "../src/live/render/lines.mjs";
import { qaSection } from "../src/live/tui/sections/qa.mjs";

const INV = "inv-20261021-120000-abcd";
let clock = 0;
const at = () => `2026-10-21T12:00:${String(clock++).padStart(2, "0")}.000Z`;

// Journal records as the investigation writes them, through the allow-list, tagged with their source.
const events = (records) => records.flatMap((r) => activityOf({ at: r.at ?? at(), ...r })).map((e) => ({ ...e, source: INV }));

const discovered = (n, state = "closed") => [{ kind: "discovery", eventId: `dsc-${state}`, state, count: n }];
const obligation = (o) => [{ kind: "obligation", eventId: `obl-${o}`, obligation: o }, { kind: "designed", eventId: `dsg-${o}`, obligation: o, design: `tds-${o}`, state: "designed" }, { kind: "version", eventId: `ver-${o}`, design: `tds-${o}`, version: `case-${o}@0123456789abcdef` }];
const started = (o, attempt) => ({ kind: "started", eventId: `str-${o}-${attempt}`, version: `case-${o}@0123456789abcdef`, execution: `exe-${o}-${attempt}`, attempt });
const evaluated = (o, attempt, outcome) => ({ kind: "evaluated", eventId: `evl-${o}-${attempt}`, execution: `exe-${o}-${attempt}`, obligation: o, outcome, attempt });

const countsOf = (evs, from) => testCountsOf(qaFold(evs, from)[INV]);

test("one obligation tried twice is one test: the count is per obligation, the latest word it earned", () => {
  const c = countsOf(events([...discovered(1), ...obligation("tob-a"), started("tob-a", 1), evaluated("tob-a", 1, "INCONCLUSIVE"), started("tob-a", 2), evaluated("tob-a", 2, "SATISFIED")]));
  assert.deepEqual(c, { total: 1, satisfied: 1, contradicted: 0, running: 0, done: 1, discovering: false });
});

test("satisfied, contradicted and running are counted of the obligations discovered", () => {
  const c = countsOf(events([...discovered(3), ...obligation("tob-a"), ...obligation("tob-b"), ...obligation("tob-c"), started("tob-a", 1), evaluated("tob-a", 1, "SATISFIED"), started("tob-b", 1), evaluated("tob-b", 1, "CONTRADICTED"), started("tob-c", 1)]));
  assert.deepEqual([c.satisfied, c.contradicted, c.running, c.total], [1, 1, 1, 3]);
});

test("an event folded twice -- a replay, a reconnect that re-reads -- changes nothing", () => {
  const evs = events([...obligation("tob-a"), started("tob-a", 1), evaluated("tob-a", 1, "CONTRADICTED")]);
  assert.deepEqual(countsOf([...evs, ...evs]), countsOf(evs));
});

test("an older event read after a newer one moves nothing: the start of an attempt never undoes its result", () => {
  const base = events([...obligation("tob-a")]);
  const start = events([started("tob-a", 1)]);
  const result = events([evaluated("tob-a", 1, "SATISFIED")]);
  const c = countsOf([...base, ...result, ...start]);
  assert.deepEqual([c.running, c.satisfied], [0, 1]);
});

test("a viewer that reconnects carries on from its state, and the overlap it reads again is not counted twice", () => {
  const all = events([...discovered(2), ...obligation("tob-a"), ...obligation("tob-b"), started("tob-a", 1), evaluated("tob-a", 1, "SATISFIED"), started("tob-b", 1), evaluated("tob-b", 1, "SATISFIED")]);
  const before = qaFold(all.slice(0, 8));
  const after = qaFold(all.slice(6), before);
  assert.deepEqual(testCountsOf(after[INV]), testCountsOf(qaFold(all)[INV]));
});

test("while discovery is open the total is not known: only what is done is said", () => {
  const c = countsOf(events([...discovered(0, "open"), ...obligation("tob-a"), started("tob-a", 1), evaluated("tob-a", 1, "SATISFIED")]));
  assert.equal(c.discovering, true);
  const rows = qaSection(ctxOf(qaFold(events([...discovered(0, "open"), ...obligation("tob-a"), evaluated("tob-a", 1, "SATISFIED")])))).rows;
  assert.ok(rows.some((r) => textOf(r) === "tests 1 done · discovering"), rows.map(textOf).join("\n"));
});

test("an investigation that has said nothing about a generated test draws no test row -- never a 0", () => {
  const qa = qaFold([{ source: INV, kind: "qa.started", at: at(), mode: "observe" }]);
  assert.equal(testCountsOf(qa[INV]), null);
  assert.ok(!qaSection(ctxOf(qa)).rows.some((r) => /tests/.test(textOf(r))));
  const counted = qaSection(ctxOf(qaFold(events([...discovered(2), ...obligation("tob-a"), ...obligation("tob-b"), started("tob-a", 1)])))).rows.map(textOf);
  assert.ok(counted.includes("tests 0 satisfied · 0 contradicted · 1 running of 2"), counted.join("\n"));
});

test("every milestone event reads as a line a person can follow", () => {
  for (const e of events([...discovered(1), ...obligation("tob-a"), started("tob-a", 1), evaluated("tob-a", 1, "CONTRADICTED"), { kind: "validated", state: "invalid", version: "v", findings: ["x"] }, { kind: "authorized", state: "blocked", version: "v", why: "no grant" }, { kind: "observed", execution: "exe-1", completeness: "partial" }, { kind: "published", report: "r", state: "failed" }, { kind: "cleanup", execution: "exe-1", state: "quarantined" }])) {
    const line = lineOf(e);
    assert.ok(line.summary.length > 0, e.kind);
  }
  assert.equal(lineOf(events([evaluated("tob-a", 1, "CONTRADICTED")])[0]).failed, true);
});

function ctxOf(qa) {
  return { d: { root: { qa, events: [] } }, state: { viewer: { settings: {} } }, nowMs: 0 };
}

function textOf(row) {
  return row.left.map((s) => s.text).join("");
}
