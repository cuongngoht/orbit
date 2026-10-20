// A viewer's state about its OWN view, and what the task is doing now: ordered tables, every row reachable,
// a tick never progress, and the same order of "current activity" Orbit Control's page uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { presentationOf, STATES, STATE_NAMES } from "../src/live/presentation.mjs";
import { CURRENT, currentOf, latestFailure, qaFold } from "../src/live/current.mjs";
import { GLYPHS, PRESENTATION_WORDS } from "../src/live/words.mjs";

const NOW = Date.parse("2026-10-08T10:00:00.000Z");
const facts = (over = {}) => ({ reads: 1, failures: 0, good: true, partial: false, terminal: false, running: false, lastEventAt: "2026-10-08T09:59:30.000Z", now: NOW, idleAfterMs: 120_000, ...over });

test("every viewer state is reachable, in order, and the last always matches", () => {
  const cases = { CONNECTING: { reads: 0 }, UNAVAILABLE: { failures: 1, good: false }, RECONNECTING: { failures: 1 }, DEGRADED: { partial: true }, FINISHED: { terminal: true }, LIVE: {}, IDLE: { lastEventAt: "2026-10-08T09:00:00.000Z" } };
  for (const [state, over] of Object.entries(cases)) assert.equal(presentationOf(facts(over)).state, state, state);
  assert.deepEqual(Object.keys(cases), STATE_NAMES);
  assert.equal(STATES.at(-1).when({}), true);
});

test("a viewer that keeps failing after it was good gives up as UNAVAILABLE", () => {
  assert.equal(presentationOf(facts({ failures: 4 })).state, "UNAVAILABLE");
});

test("time passing is not progress: a quiet task becomes IDLE; an action still running stays LIVE", () => {
  const quiet = facts({ lastEventAt: "2026-10-08T09:50:00.000Z" });
  assert.equal(presentationOf(quiet).state, "IDLE");
  assert.equal(presentationOf({ ...quiet, running: true }).state, "LIVE");
  assert.equal(presentationOf(quiet).sinceLastLineMs, 600_000);
});

test("every presentation state has a word and a glyph", () => {
  assert.deepEqual(Object.keys(PRESENTATION_WORDS).sort(), [...STATE_NAMES].sort());
});

// ---- current activity --------------------------------------------------------------------------

const view = (over = {}) => ({ terminal: false, ended: null, lifecycle: "EXECUTING", stage: "BUILDING", approvals: [], paused: null, blocked: null, actions: [], decision: null, ...over });

test("current activity: ended, approval, paused, blocked, QA, action, diagnosing, stage -- first match wins", () => {
  const qa = { "inv-1": { id: "inv-1", startedAt: "t", ended: null, steps: 2, step: null } };
  const running = [{ id: "act-1", type: "build", label: "build", state: "running", startedAt: "2026-10-08T09:59:00.000Z" }];
  assert.equal(currentOf(view({ terminal: true, ended: { kind: "completed" } })).kind, "ended");
  assert.equal(currentOf(view({ approvals: [{ id: "apr-1", open: true }] }), qa).kind, "approval");
  assert.equal(currentOf(view({ paused: { at: "x" } }), qa).kind, "paused");
  assert.equal(currentOf(view({ blocked: { stop: "ENVIRONMENT_BLOCKED" } }), qa).kind, "blocked");
  assert.equal(currentOf(view({ actions: running }), qa).kind, "qa");
  assert.equal(currentOf(view({ actions: running })).kind, "action");
  assert.equal(currentOf(view({ stage: "DIAGNOSING" }), qa).kind, "diagnosing");
  assert.equal(currentOf(view()).kind, "stage");
  assert.equal(CURRENT.at(-1).when(view()), true);
});

test("the order is the page's own: the panel's currentActivity checks the same kinds in the same order", () => {
  const ts = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "control-panel", "src", "features", "mission-control", "live", "live.reducer.ts"), "utf8");
  const body = ts.slice(ts.indexOf("export function currentActivity"), ts.indexOf("export const evidenceOf"));
  const order = [...body.matchAll(/kind: "([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, CURRENT.map((r) => r.kind));
});

test("the glyphs are the page's: same character and word for each kind of line", () => {
  const ts = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "control-panel", "src", "features", "mission-control", "live", "liveWords.ts"), "utf8");
  const page = Object.fromEntries([...ts.matchAll(/(\w+): \{ char: "([^"]+)", label: "([^"]+)" \}/g)].map((m) => [m[1], { char: m[2], label: m[3] }]));
  assert.deepEqual(page, GLYPHS);
});

test("an investigation's progress is folded from its own lines: steps, screenshots, the last failed request", () => {
  const ev = (kind, over) => ({ source: "inv-1", n: 0, at: "2026-10-08T09:59:00.000Z", kind, ...over });
  const qa = qaFold([ev("qa.started", { mode: "observe" }), ev("qa.step", { do: "click", on: "Confirm", screenshot: true }), ev("qa.network", { requests: [{ method: "POST", endpoint: "/api/refunds", status: 500 }] }), { source: "task", kind: "stage", at: "x" }]);
  assert.deepEqual([qa["inv-1"].steps, qa["inv-1"].screenshots, qa["inv-1"].lastFailure.status], [1, 1, 500]);
  assert.equal(Object.keys(qa).length, 1, "a task line is not QA");
});

test("the latest failure is the last thing that went wrong, from any source, and null when nothing did", () => {
  const events = [{ source: "inv-1", kind: "qa.network", at: "1", requests: [{ method: "POST", endpoint: "/a", status: 500 }] }, { source: "task", kind: "action-failed", at: "2", id: "act-2", summary: "2 tests failed" }];
  assert.deepEqual(latestFailure(events), { at: "2", what: "action", action: "act-2", summary: "2 tests failed" });
  assert.equal(latestFailure([{ source: "task", kind: "stage", at: "1" }]), null);
});
