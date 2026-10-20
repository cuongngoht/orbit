// A check's OBSERVATION on the page (1.8.5): an `activity-view` frame is read field by field and dropped when it is
// not one; a projection is replaced by a newer one only -- a late, repeated or older frame moves nothing -- so a
// reconnect never doubles a count; and the words are the terminal's: a total only when the runner said one.
import { describe, expect, it } from "vitest";
import { initialLive, liveReducer } from "./live.reducer";
import { isNewer, observationOf, observationsOf, progressOf, type Observation } from "./observation";
import { FRAME_NAMES, frameOf } from "./stream";

const view = (over: Record<string, unknown> = {}) => ({ action: "act-5", state: "running", seq: 40, resets: 0, why: "required: the change reaches node:api (modified)", command: { component: "node:api", declaredAs: "test" }, adapter: { id: "tap", runner: "TAP", capabilities: { cases: "reported", total: "at-end" } }, counts: { passed: 33, failed: 1, skipped: 0, todo: 0, cancelled: 0 }, reported: 34, total: null, recent: [{ key: "1.34", name: "ToolRoutingTests.MissingTool", state: "failed" }], failures: [{ name: "ToolRoutingTests.MissingTool", category: "assertion", message: "expected 'tool-a'", location: "routing.test.js:41", stack: ["a", "b"] }], output: { lines: 412, lastAt: "2026-10-15T09:00:00.000Z" }, gaps: [], complete: false, ...over });

const event = (data: unknown) => new MessageEvent("activity-view", { data: JSON.stringify(data) });

const parsed = (over: Record<string, unknown> = {}): Observation => {
  const o = observationOf(view(over));
  if (o === null) throw new Error("a valid view did not parse");
  return o;
};

describe("a check's observation", () => {
  it("is a frame the stream listens for, read field by field, and dropped when its action is not the projection's", () => {
    expect(FRAME_NAMES).toContain("activity-view");
    expect(frameOf("activity-view", event({ source: "activity", action: "act-5", revision: 40, view: view() }))).toMatchObject({ type: "activity", observation: { action: "act-5", reported: 34, total: null } });
    expect(frameOf("activity-view", event({ action: "act-9", view: view() }))).toBeNull();
    expect(frameOf("activity-view", event({ action: "act-5", view: { ...view(), seq: "40" } }))).toBeNull();
    expect(observationOf({ action: "act-5", seq: 1, counts: { passed: "many" }, recent: [{ key: "x", state: "exploded" }] })).toMatchObject({ counts: { passed: 0 }, recent: [] });
  });

  it("is replaced by a newer projection only: a later revision, or a file begun again -- never an older or a repeated one", () => {
    const state = [parsed(), parsed({ seq: 12, counts: { passed: 2 } })].reduce((s, o) => liveReducer(s, { type: "observed", observations: [o] }), initialLive());
    expect(state.activity["act-5"]?.counts.passed).toBe(33);
    expect(liveReducer(state, { type: "observed", observations: [parsed()] })).toBe(state);
    expect(isNewer(parsed(), parsed({ seq: 3, resets: 1 }))).toBe(true);
    const two = liveReducer(state, { type: "observed", observations: observationsOf({ "act-5": view({ seq: 41 }), "act-2": view({ action: "act-2", state: "completed" }) }) });
    expect(Object.keys(two.activity).sort()).toEqual(["act-2", "act-5"]);
  });

  it("says only what was reported: a total when the runner said one, and that a command printing no cases shows none", () => {
    expect(progressOf(parsed())).toEqual({ cases: "33 passed · 1 failed", total: "34 reported · total unknown", unavailable: null, onlyFailures: null });
    expect(progressOf(parsed({ total: 40 })).total).toBe("34 of 40 reported");
    expect(progressOf(parsed({ adapter: { id: "generic", capabilities: { cases: "none" } }, counts: {}, reported: 0 })).unavailable).toMatch(/case progress unavailable/);
    expect(progressOf(parsed({ adapter: { id: "dotnet-test", runner: "VSTest", capabilities: { cases: "failures" } } })).onlyFailures).toMatch(/only the cases that did not pass/);
  });
});
