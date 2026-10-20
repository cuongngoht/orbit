// THE ORBIT (0.0.1, ADR 0027): motion, never progress. It turns only while the LIVE indicator is ACTIVE -- LIVE's own
// evidence rule (ADR 0022) -- with the newest evidence's phase; it rests on its parked frame otherwise, and stays still
// for a person who asked for no motion. Every viewer's header opens with it, and a docked pane turns it from what
// `live pane` hands it, with the engine's numbers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FPS, KICK_MS, MOTION, motionOf, orbitOf, orbitTrackOf, phaseOf } from "../src/live/orbit.mjs";
import { unstyled } from "../src/live/render/ansi.mjs";
import { displayWidth } from "../src/live/render/width.mjs";
import { frameOf } from "../src/live/tui/frame.mjs";
import { glyph } from "../src/live/tui/glyphs.mjs";
import { reduce } from "../src/live/tui/reducer.mjs";
import { ORBIT_GLYPHS } from "../src/live/words.mjs";
import { NOW, engineering, workflow } from "./live-tui.fixture.mjs";

const T0 = Date.parse("2026-10-20T08:00:00.000Z");
const at = (ms) => new Date(T0 + ms).toISOString();
const indicator = (over = {}) => ({ state: "ACTIVE", animate: true, lastAt: at(0), ...over });
const U = ORBIT_GLYPHS.unicode;
const A = ORBIT_GLYPHS.ascii;

test("twelve frames of three cells and a parked one, each a different picture, every cell with its ASCII row", () => {
  assert.equal(U.frames.length, 12);
  assert.equal(new Set(U.frames).size, 12);
  for (const f of [...U.frames, U.parked]) assert.equal(displayWidth(f), 3, f);
  for (const f of [...U.frames, U.parked]) assert.match(glyph(f, true), /^[\x20-\x7e]{3}$/, f);
  for (const f of [...A.frames, A.parked]) assert.match(f, /^[\x20-\x7e]{3}$/, f);
});

test("it turns only while the indicator is ACTIVE; any other state parks it, in a quiet tone", () => {
  assert.deepEqual(MOTION.map((r) => r.pose), ["orbiting", "still", "parked"]);
  for (const state of ["IDLE", "WAITING", "BLOCKED", "COMPLETED", "FAILED", "CANCELLED", "DEGRADED", "DISCONNECTED", "NONE"]) {
    assert.deepEqual(orbitOf(indicator({ state }), { nowMs: T0 + 500 }), { text: U.parked, tone: "subtle", moving: false }, state);
  }
  assert.equal(orbitOf(null, { nowMs: T0 }).text, U.parked, "no indicator, no motion");
});

test("a tick moves nothing once the evidence stops: a parked orbit is the same frame at every redraw", () => {
  const idle = indicator({ state: "IDLE" });
  assert.equal(new Set([0, 1_000, 60_000, 3_600_000].map((dt) => orbitOf(idle, { nowMs: T0 + dt }).text)).size, 1);
});

test("its phase is the newest evidence's: launched by a line, fast for KICK_MS, then cruising", () => {
  assert.equal(phaseOf(0), 0);
  assert.equal(phaseOf(100), 1, `${FPS.kick} frames a second while launched`);
  assert.equal(phaseOf(KICK_MS), 30);
  assert.equal(phaseOf(KICK_MS + 1_000), 30 + FPS.cruise, `${FPS.cruise} frames a second after`);
  const i = indicator();
  assert.equal(orbitOf(i, { nowMs: T0 }).text, U.frames[0], "a new line launches it from the top of its ring");
  assert.equal(orbitOf(i, { nowMs: T0 + 300 }).text, U.frames[3]);
  assert.equal(orbitOf(indicator({ lastAt: at(300) }), { nowMs: T0 + 300 }).text, U.frames[0], "newer evidence launches it again");
  assert.equal(orbitOf(i, { nowMs: T0 + 300 }).text, orbitOf(i, { nowMs: T0 + 300 }).text, "one moment, one frame");
  assert.equal(orbitOf(i, { nowMs: T0 + 300 }).moving, true);
});

test("a person who asked for no motion gets it still -- in the brand's tone while the task moves", () => {
  const still = indicator({ animate: false });
  assert.deepEqual(orbitOf(still, { nowMs: T0 + 300 }), { text: U.parked, tone: "brand", moving: false });
  assert.equal(motionOf(still).pose, "still");
});

test("with no clock -- a docked pane's header -- it is parked, and the track says how a pane turns it", () => {
  assert.deepEqual(orbitOf(indicator(), { nowMs: null }), { text: U.parked, tone: "brand", moving: false });
  assert.deepEqual(orbitTrackOf(indicator()), { moving: true, tone: "brand", frames: U.frames, parked: U.parked, lastAt: at(0), kickMs: KICK_MS, fps: FPS });
  assert.equal(orbitTrackOf(indicator({ state: "IDLE" })).moving, false);
  assert.deepEqual(orbitTrackOf(indicator(), { ascii: true }).frames, A.frames);
});

test("ASCII is given its own frames whole", () => {
  assert.equal(orbitOf(indicator(), { ascii: true, nowMs: T0 + 300 }).text, A.frames[3 % A.frames.length]);
  assert.equal(orbitOf(indicator({ state: "IDLE" }), { ascii: true, nowMs: T0 }).text, A.parked);
});

test("every viewer's header opens with it: turning while the task moves, parked -- with the true word -- once it stops", () => {
  const head = (s) => [...unstyled(frameOf(s).lines[0])].slice(0, 3).join("");
  const moving = workflow({ columns: 100, rows: 30, start: { layout: "pane" } });
  assert.ok(U.frames.includes(head(moving)), head(moving));
  assert.match(unstyled(frameOf(moving).lines[0]), /ORBIT LIVE .*● ORBITING/, "the badge: the orbit, a dot and the word (0.0.2)");
  const blocked = engineering({ columns: 100, rows: 30, start: { layout: "pane" }, view: { lifecycle: "BLOCKED", blocked: { stop: "ENVIRONMENT_BLOCKED" } } });
  assert.equal(head(blocked), U.parked, "a blocked task does not orbit, however its checks run");
  assert.match(unstyled(frameOf(blocked).lines[0]), /■ BLOCKED/);
  assert.equal(head(reduce(blocked, { type: "tick", nowMs: NOW + 3_600_000 })), U.parked, "and no clock moves it");
});
