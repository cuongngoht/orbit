// Orbit LIVE and a task that STOPPED while the session went on without one. The bug: a coordinated workflow ended BLOCKED
// (an environment it could not run in), the person then chose /orbit-help to fix something else, it went the developer's
// way and started no task -- and the viewer kept the blocked workflow on show, still ("last line 8h ago"), because a
// stopped task is not finished and the session's own activity only drew when there was NO task. Now a stopped, quiet
// task the session's tools have moved past gives way to the session's own activity; every other case is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { derivedOf } from "../src/live/tui/derive.mjs";
import { sessionActivityOf } from "../src/live/session.mjs";
import { ENG, NOW, SETTINGS, ago, engView, engineering } from "./live-tui.fixture.mjs";

const tool = (s) => ({ t: ago(s), ev: "post-tool", tool: "edit", paths: ["src/a.mjs"], tokens: [], cmd: null });

const session = (s) => sessionActivityOf([tool(s)], { nowMs: NOW, idleAfterMs: SETTINGS.idleAfterSec * 1000, checks: ["test"] });

// A task whose last line was written 8 hours ago (nothing in the journal at all here: the viewer has only the view).
const stoppedState = (how = "session", over = {}) => ((s) => ({ ...s, association: { how, task: ENG, ids: [ENG] }, session: "session" in over ? over.session : session(5) }))(engineering({ view: { lifecycle: "BLOCKED", actions: [], ...(over.view ?? {}) }, events: [] }));

test("a blocked, quiet task gives way to the session's own tools once they have moved past it", () => {
  const d = derivedOf(stoppedState());
  assert.equal(d.root, null);
  assert.equal(d.focus, null);
  assert.equal(d.engineering, null, "every view reads 'no task', so every section draws the session's activity");
});

test("PAUSED and WAITING_APPROVAL are stopped too; an EXECUTING task is never replaced", () => {
  assert.equal(derivedOf(stoppedState("session", { view: { lifecycle: "PAUSED" } })).root, null);
  assert.equal(derivedOf(stoppedState("session", { view: { lifecycle: "WAITING_APPROVAL" } })).root, null);
  assert.notEqual(derivedOf(stoppedState("session", { view: { lifecycle: "EXECUTING" } })).root, null, "a running task is the task, whatever the session does");
});

test("a task a person picked or pinned stays; so does one while the session is quiet, or older than the task", () => {
  assert.notEqual(derivedOf(stoppedState("explicit")).root, null);
  assert.notEqual(derivedOf(stoppedState("pin")).root, null);
  assert.notEqual(derivedOf(stoppedState("session", { session: session(900) })).root, null, "no tool within the idle window: nothing moved past the task");
  assert.notEqual(derivedOf(stoppedState("session", { session: null })).root, null, "a viewer that does not know its session keeps the task");
});

test("a stopped task that still wrote something lately stays until the session's tools are newer than that line", () => {
  const recent = { view: { lifecycle: "BLOCKED", actions: [] } };
  const s = engineering({ ...recent, events: [{ source: "task", n: 0, at: ago(2), kind: "created" }] });
  assert.notEqual(derivedOf({ ...s, session: session(5) }).root, null, "the journal's last line (2s ago) is newer than the tool (5s ago)");
  assert.equal(engView().task.id, ENG);
});
