// A person's live settings (revisioned, ranges refused rather than clamped) and a viewer's pin (a preference,
// never an execution event): both written only on a person's command, both read without a write.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realIo } from "../src/store/io.mjs";
import { defaultsOf, readLive, settingsProblems, writeLive } from "../src/live/settings.mjs";
import { clearPin, PIN_TTL_MS, readPins, writePin } from "../src/live/pin.mjs";

function room(t) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-live-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const AT = "2026-10-08T10:00:00.000Z";

test("nothing kept reads as the defaults, with no revision, and writes nothing", (t) => {
  const dir = room(t);
  const got = readLive(realIo(), join(dir, "settings.json"));
  assert.deepEqual(got.settings, defaultsOf());
  assert.equal(got.revision, null);
  assert.deepEqual(readdirSync(dir), []);
});

test("a write names the revision it read; a stale one is refused", (t) => {
  const file = join(room(t), "settings.json");
  const first = writeLive(realIo(), file, { statusLine: { lines: 3 } }, { revision: null, at: AT });
  assert.equal(first.settings.statusLine.lines, 3);
  assert.equal(first.settings.idleAfterSec, 120, "an untouched field keeps its default");
  assert.throws(() => writeLive(realIo(), file, { idleAfterSec: 60 }, { revision: "0000000000000000", at: AT }), (e) => e.code === "STALE_REVISION");
  assert.equal(writeLive(realIo(), file, { idleAfterSec: 60 }, { revision: first.revision, at: AT }).settings.idleAfterSec, 60);
});

test("a value out of its range, or a field nobody declared, is refused and never clamped", () => {
  assert.equal(settingsProblems({ statusLine: { lines: 4 } }).length, 1);
  assert.equal(settingsProblems({ statusLine: { refreshInterval: 0 } }).length, 1);
  assert.equal(settingsProblems({ terminal: { showQa: "yes" } }).length, 1);
  assert.deepEqual(settingsProblems({ statusLine: { command: "rm -rf /" } }), ["statusLine.command is not a live setting"]);
});

test("a pin is per session or per checkout, and the session's is read first by association", (t) => {
  const dir = join(room(t), "live");
  const io = realIo();
  writePin(io, dir, { mark: "a".repeat(16), task: "tsk-111111111111", at: AT, nowMs: Date.parse(AT) });
  writePin(io, dir, { mark: null, task: "tsk-222222222222", at: AT, nowMs: Date.parse(AT) });
  assert.deepEqual(readPins(io, dir, "a".repeat(16)), { session: "tsk-111111111111", checkout: "tsk-222222222222" });
  assert.deepEqual(readPins(io, dir, "b".repeat(16)), { session: null, checkout: "tsk-222222222222" });
  clearPin(io, dir, null);
  assert.equal(readPins(io, dir, null).checkout, null);
});

test("a pin names a task id and a scope in their own shapes, and an old pin is pruned when one is written", (t) => {
  const dir = join(room(t), "live");
  const io = realIo();
  assert.throws(() => writePin(io, dir, { mark: null, task: "../../etc", at: AT, nowMs: 0 }), /tsk-/);
  assert.throws(() => writePin(io, dir, { mark: "../x", task: "tsk-111111111111", at: AT, nowMs: 0 }), /session mark/);
  writePin(io, dir, { mark: "a".repeat(16), task: "tsk-111111111111", at: "2026-09-01T00:00:00.000Z", nowMs: Date.parse("2026-09-01T00:00:00.000Z") });
  writePin(io, dir, { mark: null, task: "tsk-222222222222", at: AT, nowMs: Date.parse("2026-09-01T00:00:00.000Z") + PIN_TTL_MS + 1 });
  assert.deepEqual(readdirSync(dir).sort(), ["checkout.json"]);
});

test("a corrupt pin is no pin", (t) => {
  const dir = room(t);
  writeFileSync(join(dir, "checkout.json"), "{ not json");
  assert.throws(() => readPins(realIo(), dir, null), /corrupt Orbit state/);
  assert.equal(readFileSync(join(dir, "checkout.json"), "utf8"), "{ not json");
});

test("1.8.6/0.0.3: the pane's animation is one of two words, the orbit's speed one of three, its timeline a bounded number -- anything else refused, never clamped", () => {
  assert.deepEqual(settingsProblems({ pane: { animation: "off", timelineRows: 40 } }), []);
  assert.equal(settingsProblems({ pane: { animation: "blink" } }).length, 1);
  assert.match(settingsProblems({ pane: { animation: "blink" } })[0], /one of auto, off/);
  assert.equal(settingsProblems({ pane: { timelineRows: 500 } }).length, 1);
  assert.equal(defaultsOf().pane.animation, "auto");
  assert.equal(defaultsOf().pane.timelineRows, 30);
  for (const speed of ["slow", "normal", "fast"]) assert.deepEqual(settingsProblems({ pane: { orbitSpeed: speed } }), [], speed);
  assert.match(settingsProblems({ pane: { orbitSpeed: "warp" } })[0], /one of slow, normal, fast/);
  assert.equal(defaultsOf().pane.orbitSpeed, "normal");
});

