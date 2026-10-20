// The live feed as a page holds it, pure: one row per line however often it arrives, the newest WINDOW
// rows kept, a view never moved backwards, and what the task is doing now said in a fixed order.
import { describe, expect, it } from "vitest";
import { pbi482View } from "../../../testing/fakeMission";
import type { TaskView } from "../mission.types";
import { currentActivity, initialLive, liveReducer, WINDOW, type LiveAction } from "./live.reducer";
import type { LiveEvent, LiveState } from "./live.types";
import { FILTERS, GLYPHS, rowOf } from "./liveWords";

const labels = new Map([["act-1", "Build"]]);
const at = (s: number) => `2026-10-08T09:00:${String(s % 60).padStart(2, "0")}.000Z`;
const line = (n: number, kind: string, fields: Record<string, unknown> = {}, source = "task"): LiveEvent => ({ source, n, at: at(n), kind, ...fields });
const run = (actions: LiveAction[], from: LiveState = initialLive()) => actions.reduce(liveReducer, from);
const received = (events: LiveEvent[], cursor: string | null = null): LiveAction => ({ type: "received", events, cursor, labels });

describe("the live reducer", () => {
  it("draws each kind of line with its glyph, its tone and the timeline's own words", () => {
    const rows = [
      rowOf(line(0, "stage", { stage: "TESTING" }), labels),
      rowOf(line(1, "action-started", { id: "act-1", type: "build" }), labels),
      rowOf(line(2, "action-completed", { id: "act-1", outcome: "failed", summary: "2 failed" }), labels),
      rowOf(line(3, "decision", { observed: "it failed", nextAction: "inspect", hypothesis: "a null reaches it" }), labels),
      rowOf(line(4, "file-changed", { path: "src/RefundService.cs", change: "modified", added: 7, removed: 2 }), labels),
      rowOf(line(5, "approval-requested", { id: "apr-1", action: "database.migrate", environment: "dev" }), labels),
      rowOf(line(6, "paused", {}), labels),
    ];
    expect(rows.map((r) => [GLYPHS[r.glyph].char, r.group])).toEqual([["●", "state"], ["▶", "action"], ["✗", "action"], ["◇", "decision"], ["+", "file"], ["👤", "approval"], ["⏸", "state"]]);
    expect(rows[0]).toMatchObject({ line: "TESTING", stage: true });
    expect(rows[2]).toMatchObject({ line: "Build  ✗ 2 failed", failed: true, tone: "danger" });
    expect(rows[3].detail).toBe("Hypothesis: a null reaches it");
    expect(rows[4].detail).toBe("+7 −2");
  });

  it("draws QA lines from what they hold: a step, a failed request, console errors, a case", () => {
    const qa = (n: number, kind: string, fields: Record<string, unknown>) => rowOf(line(n, kind, fields, "inv-20261008-090000-aaaa"), labels);
    expect(qa(0, "qa.step", { do: "click", on: "Confirm refund", url: "/orders/821", ms: 133, screenshot: true, state: "done" })).toMatchObject({ line: "click Confirm refund", detail: "/orders/821 · 133ms · 📸 screenshot", failed: false, group: "qa" });
    expect(qa(1, "qa.network", { requests: [{ method: "POST", endpoint: "/api/refund", status: 500 }], action: "act-3" })).toMatchObject({ line: "POST /api/refund → 500", detail: "during act-3", failed: true, glyph: "warning" });
    expect(qa(2, "qa.console", { errors: 2, messages: ["TypeError: x is undefined"] })).toMatchObject({ line: "Browser console: 2 error(s)", detail: "TypeError: x is undefined" });
    expect(qa(3, "qa.run", { case: "refund-flow", status: "PASS", proved: { ui: 2, api: 1, sql: 1 } })).toMatchObject({ line: "Case refund-flow: PASS", detail: "proved ui 2 · api 1 · sql 1", glyph: "ok", failed: false });
  });

  it("a line received twice -- in one batch or after a reconnect -- is one row, and a no-op keeps the same state", () => {
    const once = run([received([line(0, "created"), line(1, "stage", { stage: "CONTEXT" }), line(1, "stage", { stage: "CONTEXT" })], "t=2")]);
    expect(once.rows.map((r) => r.key)).toEqual(["task:0:created", "task:1:stage"]);
    expect(liveReducer(once, received([line(1, "stage", { stage: "CONTEXT" })]))).toBe(once);
    expect(once.cursor).toBe("t=2");
  });

  it("keeps the newest WINDOW rows, counts the rest as hidden, and Load earlier brings every line back", () => {
    const many = Array.from({ length: WINDOW + 25 }, (_, n) => line(n, "receipt", { domain: "check", ref: `chk-${n}` }));
    const state = run([received(many)]);
    expect([state.rows.length, state.hidden, state.rows[0].n]).toEqual([WINDOW, 25, 25]);
    const all = liveReducer(state, { type: "loadedEarlier", events: many, cursor: "t=525", labels });
    expect([all.rows.length, all.hidden, all.unbounded]).toEqual([WINDOW + 25, 0, true]);
  });

  it("a view with a lower revision never replaces a newer one", () => {
    const newer: TaskView = { ...pbi482View(), revision: 40 };
    const state = run([{ type: "viewed", view: newer }, { type: "viewed", view: { ...pbi482View(), revision: 39 } }]);
    expect(state.view?.revision).toBe(40);
  });

  it("lines that arrive while the person reads further up are counted, and following again clears the count", () => {
    const state = run([{ type: "unfollowed" }, received([line(0, "created"), line(1, "stage", { stage: "CONTEXT" })])]);
    expect([state.following, state.newSinceFollow]).toEqual([false, 2]);
    expect(run([{ type: "followed" }], state).newSinceFollow).toBe(0);
  });

  it("folds one investigation's lines into what it has done: its step, its last failure, console errors, screenshots, cases, its end", () => {
    const inv = "inv-20261008-090000-aaaa";
    const state = run([received([line(0, "qa.started", { mode: "observe" }, inv), line(1, "qa.step", { do: "goto", on: "/orders/821", url: "/orders/821", screenshot: true }, inv), line(2, "qa.network", { requests: [{ method: "POST", endpoint: "/api/refund", status: 500 }] }, inv), line(3, "qa.console", { errors: 2 }, inv), line(4, "qa.run", { case: "refund-flow", status: "FAIL", evidence: true }, inv)])]);
    expect(state.qa[inv]).toMatchObject({ mode: "observe", steps: 1, screenshots: 2, consoleErrors: 2, url: "/orders/821", lastFailure: { method: "POST", endpoint: "/api/refund", status: 500 }, runs: { passed: 0, failed: 1 }, ended: null });
    expect(run([received([line(5, "qa.ended", { lifecycle: "completed" }, inv)])], state).qa[inv].ended?.lifecycle).toBe("completed");
  });

  it("says what the task is doing in order: ended, a person's decision, paused, blocked, QA in flight, a running action, diagnosing, the stage -- never a percentage", () => {
    const base = { ...pbi482View(), approvals: [] };
    const qa = run([received([line(0, "qa.started", {}, "inv-20261008-090000-aaaa")])]).qa;
    expect(currentActivity(pbi482View(), {}, labels).kind).toBe("approval");
    expect(currentActivity({ ...base, terminal: true, lifecycle: "COMPLETED", ended: { kind: "completed", at: at(9), stop: null, summary: "done", because: null, by: null } }, qa, labels).kind).toBe("ended");
    expect(currentActivity({ ...base, paused: { at: at(1), by: "person", because: null } }, qa, labels).kind).toBe("paused");
    expect(currentActivity(base, qa, labels).kind).toBe("qa");
    expect(currentActivity(base, {}, labels)).toMatchObject({ kind: "action", label: "Regression" });
    expect(currentActivity({ ...base, stage: "DIAGNOSING", actions: base.actions.filter((a) => a.state !== "running") }, qa, labels)).toMatchObject({ kind: "diagnosing", lastFailure: "RefundTests: 1 failed", next: "inspect-refund-validation" });
    expect(currentActivity({ ...base, actions: [] }, {}, labels).kind).toBe("stage");
    expect(JSON.stringify(currentActivity(base, qa, labels))).not.toMatch(/%|percent|eta/i);
  });

  it("every filter keeps exactly the rows it names", () => {
    const rows = [rowOf(line(0, "decision", { observed: "x", nextAction: "y" }), labels), rowOf(line(1, "action-failed", { id: "act-1" }), labels), rowOf(line(2, "file-changed", { path: "a" }), labels), rowOf(line(3, "approval-requested", { id: "apr-1" }), labels), rowOf(line(0, "qa.step", { do: "goto" }, "inv-20261008-090000-aaaa"), labels)];
    const kept = Object.fromEntries(FILTERS.map((f) => [f.id, rows.filter(f.keeps).map((r) => r.kind)]));
    expect(kept).toEqual({ all: ["decision", "action-failed", "file-changed", "approval-requested", "qa.step"], decisions: ["decision"], actions: ["action-failed"], qa: ["qa.step"], files: ["file-changed"], errors: ["action-failed"], approvals: ["approval-requested"] });
  });
});
