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
