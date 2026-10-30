// SATELLITE LIVE, full screen, on a fake terminal: it enters and leaves the alternate screen once, gives the keyboard
// back, leaves no timer or listener behind, switches views by key, and refuses a pipe.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fakeTimers, fakeTty, screenOf } from "../../test/fakes/tty.mjs";
import { runSatelliteTui, tuiRefusal } from "../cli/satellite-tui.mjs";
import { journalLine } from "../src/store/line.mjs";

const RECORDS = readFileSync(new URL("./fixtures/two-runs.journal.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(journalLine).filter(Boolean);

const followerOf = (records) => ((left) => ({ pull: () => ({ items: left.splice(0).map((record) => ({ record })) }) }))([...records]);

test("the viewer draws the mission, switches views by key, and leaves with one teardown", async () => {
  const tty = fakeTty({ columns: 120, rows: 30 });
  const timers = fakeTimers();
  const run = runSatelliteTui({ follower: followerOf(RECORDS), nowMs: () => Date.parse("2026-10-22T08:10:00.000Z") }, tty, { timers });
  assert.match(screenOf(tty.all(), 120, 30).join("\n"), /SATELLITE LIVE[\s\S]*1 Mission[\s\S]*MISSION/);
  tty.type("2");
  assert.match(screenOf(tty.all(), 120, 30).join("\n"), /AGENT RUNS/);
  tty.type("q");
  const out = await run;
  assert.deepEqual([out.why, tty.stdin.raw, timers.active(), tty.stdin.listenerCount("data"), tty.stdout.listenerCount("resize")], ["a person left", [true, false], 0, 0, 0]);
  assert.match(tty.all(), /\u001b\[\?1049l$/);
});

test("a pipe or TERM=dumb is refused with the watch command to use instead", () => {
  assert.match(tuiRefusal(fakeTty({ isTTY: false })), /live watch --plain/);
  assert.match(tuiRefusal(fakeTty({ term: "dumb" })), /TERM=dumb/);
  assert.equal(tuiRefusal(fakeTty()), null);
});

// ---- 0.2.2, ADR 0044: which host agent carries each run, a selection by run id, and an inspector ------------------

const MSN = "msn-0000000000f1";
const X = "claude:00000000000000aa";
const trailEvent = (n, type, data) => ({ id: `h-${n}`, type, data, at: `2026-10-22T09:05:0${n}.000Z` });
const TRAIL = { source: "ok", events: [trailEvent(1, "agent.invoked", { id: "orbit:satellite-reader", call: "claude:c1", run: `${MSN}/arn-1` }), trailEvent(2, "agent.launched", { id: "orbit:satellite-reader", call: "claude:c1", launched: X }), trailEvent(3, "agent.started", { id: "orbit:satellite-reader", agent: X }), trailEvent(4, "tool.used", { tool: "Read", kind: "read", ok: true, agent: X }), trailEvent(5, "tool.used", { tool: "Grep", kind: "search", ok: false, agent: X })] };

const viewing = (over = {}) => {
  const tty = fakeTty({ columns: over.columns ?? 140, rows: over.rows ?? 40 });
  const run = runSatelliteTui({ follower: followerOf(over.records ?? RECORDS), nowMs: () => Date.parse("2026-10-22T09:10:00.000Z"), trail: () => over.trail ?? TRAIL }, tty, { timers: fakeTimers(), ascii: over.ascii === true });
  return { tty, run, screen: () => screenOf(tty.all(), over.columns ?? 140, over.rows ?? 40).join("\n") };
};

test("each run says which host agent carries it and how that is known; j and k select a run, enter inspects it, esc closes", async () => {
  const v = viewing();
  v.tty.type("2");
  assert.match(v.screen(), /arn-1[\s\S]*HOST_OBSERVED\s+host agent 000000aa · 2 call\(s\) · the host says it started[\s\S]*arn-2[\s\S]*UNATTRIBUTED\s+no hook saw the Agent call/);
  v.tty.type("j");
  assert.match(v.screen(), /▶ arn-1/);
  v.tty.type("j");
  assert.match(v.screen(), /▶ arn-2/);
  v.tty.type("k");
  v.tty.type("\r");
  assert.match(v.screen(), /RUN arn-1\s+msn-0000000000f1\/arn-1[\s\S]*role\s+[\s\S]*rol-a:1\.0\.0:aaaaaaaa[\s\S]*attribution\s+HOST_OBSERVED[\s\S]*calls\s+2 direct · 0 through the agents it launched · 1 failed[\s\S]*ITS CALLS[\s\S]*search\s+Grep\s+failed/);
  v.tty.type("\u001b\u001b");
  assert.match(v.screen(), /AGENT RUNS/);
  v.tty.type("q");
  await v.run;
});

test("the Tools view counts each run's calls, keeps the session's own apart, and says what the join stood on", async () => {
  const v = viewing();
  v.tty.type("6");
  assert.match(v.screen(), /TOOL CALLS BY AGENT RUN[\s\S]*arn-1\s+HOST_OBSERVED\s+2 call\(s\) by host agent 000000aa[\s\S]*arn-2\s+UNATTRIBUTED[\s\S]*COVERAGE[\s\S]*session trail\s+read/);
  v.tty.type("q");
  await v.run;
  const off = viewing({ trail: { source: "off", events: [] } });
  off.tty.type("6");
  assert.match(off.screen(), /session trail\s+switched off here/);
  off.tty.type("q");
  await off.run;
});

test("a narrow screen, an ASCII terminal and a mission with no run yet are all drawn whole", async () => {
  const narrow = viewing({ columns: 40, rows: 12 });
  narrow.tty.type("2");
  narrow.tty.type("j");
  for (const line of narrow.screen().split("\n")) assert.ok(line.length <= 40, line);
  narrow.tty.type("\r");
  assert.match(narrow.screen(), /RUN arn-1/);
  narrow.tty.type("q");
  await narrow.run;
  const ascii = viewing({ ascii: true });
  ascii.tty.type("2");
  ascii.tty.type("j");
  assert.ok(/^[\x20-\x7e\n]*$/.test(ascii.screen()), "ASCII only");
  ascii.tty.type("q");
  await ascii.run;
  const empty = viewing({ records: RECORDS.filter((r) => !r.kind.startsWith("agentrun.")) });
  empty.tty.type("2");
  empty.tty.type("j");
  empty.tty.type("\r");
  assert.match(empty.screen(), /no agent run yet/, "nothing to select, nothing to inspect");
  empty.tty.type("q");
  await empty.run;
});

test("a selection names a run, so a run that arrives above it never moves it, and a deep tree keeps the selected run on screen", async () => {
  const { actionOf, initialState, reduce } = await import("../src/live/tui/state.mjs");
  const { frameOf } = await import("../src/live/tui/frame.mjs");
  const { liveViewOf } = await import("../src/live/view.mjs");
  const { modelOf } = await import("../src/mission/fold.mjs");
  const runAt = (i, parent) => ({ kind: "agentrun.created", id: `arn-${i}`, unit: "wu-1", parentAgentRun: parent, dispatch: "native", profile: "READ_ONLY", attempt: 1, mode: "EXPLORING", action: `act-${i + 1}`, depth: 0, at: "2026-10-22T09:00:00.000Z" });
  const records = [{ kind: "mission.created", id: MSN, objective: "deep", at: "2026-10-22T09:00:00.000Z" }, ...Array.from({ length: 30 }, (_, i) => runAt(i + 1, i ? `arn-${i}` : undefined))];
  const viewer = { state: "LIVE", glyph: "*", word: "ORBITING", tone: "info" };
  const deep = liveViewOf(modelOf(records));
  const s = reduce(initialState({ view: "agents", columns: 100, rows: 14 }), { type: "select", id: "arn-30" });
  assert.match(frameOf(s, deep, viewer).lines.join("\n"), /▶ arn-30/, "thirty runs deep, the selected one is on the screen");
  const later = liveViewOf(modelOf([...records, runAt(31, "arn-1")]));
  assert.equal(s.selected, "arn-30");
  assert.match(frameOf(s, later, viewer).lines.join("\n"), /▶ arn-30/, "a run drawn above it moved nothing");
  assert.deepEqual(actionOf(s, "k", later), { type: "select", id: "arn-29" }, "k names the run drawn above the selected one");
  assert.equal(actionOf({ ...s, view: "mission" }, "k", later).type, "move", "elsewhere j and k scroll, as they always did");
  const orphan = liveViewOf(modelOf([records[0], runAt(5, "arn-4")]));
  assert.match(frameOf(reduce(initialState({ view: "agents", columns: 140, rows: 20 }), { type: "select", id: "arn-5" }), orphan, viewer).lines.join("\n"), /parent arn-4 is not in this mission's journal/);
});
