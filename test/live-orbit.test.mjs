// THE ORBIT (0.0.3, ADR 0029; ADR 0027 drew the first): a planet with a satellite going round it, turning the whole
// time a viewer is open, in every state of the task, on the viewer's own clock -- motion, never progress, and never the
// word: the indicator says ORBITING only on evidence, and the orbit's clock moves nothing but the orbit. Its frames are
// sampled from an ellipse (src/live/orbit/geometry.mjs) in three sizes, Braille or ASCII (raster.mjs), every frame of a
// size one shape with the planet in the same cells.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HEADER_SIZES, MOTION, SPEEDS, motionOf, movingOf, orbitFrameAt, orbitOf, orbitTrackOf, trackFor } from "../src/live/orbit.mjs";
import { SIZES, gridOf, indexAt, planetOf, ringOf, sizeOf } from "../src/live/orbit/geometry.mjs";
import { framesOf, textOf } from "../src/live/orbit/raster.mjs";
import { INDICATOR_STATES } from "../src/live/indicator.mjs";
import { unstyled } from "../src/live/render/ansi.mjs";
import { displayWidth } from "../src/live/render/width.mjs";
import { derivedOf } from "../src/live/tui/derive.mjs";
import { contextOf, frameOf, orbitFrameOf } from "../src/live/tui/frame.mjs";
import { lifecycleOf } from "../src/live/tui/lifecycle-view.mjs";
import { initialState } from "../src/live/tui/model.mjs";
import { taskProgressOf, testProgressOf } from "../src/live/tui/progress.mjs";
import { reduce } from "../src/live/tui/reducer.mjs";
import { indicatorFor } from "../src/live/tui/workspace.mjs";
import { NOW, PLACE, SETTINGS, engineering, workflow } from "./live-tui.fixture.mjs";

const BIT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];
const pictureOf = (frame) => frame.map(textOf).join("\n");
const cellAt = (frame, key) => ((col, row) => [...textOf(frame[row])][col])(...key.split(":").map(Number));
const planetMasks = (s) => planetOf(s).reduce((m, p) => ((key) => m.set(key, (m.get(key) ?? 0) | BIT[p.y % 4][p.x % 2]))(`${Math.floor(p.x / 2)}:${Math.floor(p.y / 4)}`), new Map());
const step = (p, q) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
const opening = (line, n) => [...unstyled(line)].slice(0, n).join("");
const pane = (columns, rows = 30, over = {}) => workflow({ columns, rows, start: { layout: "pane" }, ...over });
const waitingState = (over = {}) => reduce(initialState({ columns: 100, rows: 30, layout: "pane", waiting: true, nowMs: NOW, settings: SETTINGS, place: PLACE, ...over }), { type: "tick", nowMs: NOW });

// ---- the geometry -------------------------------------------------------------------------------------------------

test("every size turns in frames of one shape: each a different picture, the planet's cells in every one of them", () => {
  for (const s of SIZES) {
    for (const ascii of [false, true]) {
      const frames = framesOf(s, { ascii });
      assert.ok(frames.length >= (ascii ? 8 : 12), `${s.name} ${ascii ? "ascii" : "braille"}: ${frames.length} frames`);
      assert.equal(new Set(frames.map(pictureOf)).size, frames.length, `${s.name}: every frame a different picture`);
      for (const f of frames) assert.equal(f.length, s.cells.h, `${s.name}: as tall as its size`);
      for (const r of frames.flat()) assert.equal(displayWidth(textOf(r)), s.cells.w, `${s.name}: as wide as its size`);
      for (const r of frames.flat()) assert.doesNotMatch(textOf(r), /[\u0000-\u001f\u007f-\u009f]/, "no control character");
    }
    for (const f of framesOf(s)) for (const [key, mask] of planetMasks(s)) assert.equal((cellAt(f, key).codePointAt(0) - 0x2800) & mask, mask, `${s.name}: the planet stands in ${key}`);
  }
});

test("the satellite goes round the planet from the top, clockwise, one dot at a time, and the ring closes", () => {
  for (const s of SIZES) {
    const ring = ringOf(s);
    const g = gridOf(s);
    ring.forEach((p, i) => assert.ok(step(p, ring[(i + 1) % ring.length]) <= 1, `${s.name} ${i}: one dot at a time, the last to the first too`));
    assert.ok(ring[0].y < g.cy, `${s.name}: it starts at the top`);
    assert.ok(ring[Math.floor(ring.length / 4)].x > g.cx, `${s.name}: a quarter round it is on the right -- clockwise`);
    assert.ok(ring[Math.floor((3 * ring.length) / 4)].x < g.cx, `${s.name}: three quarters round, on the left`);
    for (const p of ring) assert.equal(p.near, p.y > g.cy, "near is the half in front of the planet");
  }
  assert.ok(ringOf(sizeOf("compact")).length >= 16 && ringOf(sizeOf("compact")).length <= 24, "the header's orbit: sixteen to twenty-four positions");
  assert.equal(framesOf(sizeOf("expanded"), { ascii: true }), framesOf(sizeOf("expanded"), { ascii: true }), "made once, then kept: the same frames, not a copy");
});

test("in ASCII the satellite is ' - or . by where it is in its cell, O in front of the planet, and hidden behind it", () => {
  assert.deepEqual(framesOf(sizeOf("mini"), { ascii: true }).map((f) => textOf(f[0])), [" o ", " o'", " o-", " o.", " O ", ".o ", "-o ", "'o "]);
  for (const s of SIZES) for (const r of framesOf(s, { ascii: true }).flat()) assert.match(textOf(r), /^[\x20-\x7e]+$/, s.name);
});

test("the satellite is bright in front of the planet and darker behind it, grey while the task does not move, and the track only where asked", () => {
  const s = sizeOf("compact");
  const tones = (o) => new Set(framesOf(s, o).flat(2).map((x) => x.tone));
  assert.deepEqual([...tones({ track: true })].sort(), ["orbit:far", "orbit:near", "orbit:planet", "orbit:track"]);
  assert.deepEqual([...tones({ track: true, variant: "gentle" })].sort(), ["orbit:far:gentle", "orbit:near:gentle", "orbit:planet", "orbit:track"]);
  assert.ok(!tones({}).has("orbit:track"), "no track unless asked");
  assert.ok(!tones({ ascii: true, track: true }).has("orbit:track"), "never in ASCII, where it would hide the satellite");
  assert.equal(trackFor({ colour: true, depth: "truecolor" }), true);
  assert.equal(trackFor({ colour: true, depth: "256" }), true);
  assert.equal(trackFor({ colour: true, depth: "16" }), false, "in sixteen colours the track and the far satellite are one grey");
  assert.equal(trackFor({ colour: false, depth: "truecolor" }), false, "in one colour a track would hide the satellite");
});

// ---- the motion ---------------------------------------------------------------------------------------------------

test("one moment is one frame, run twice, and a revolution later it is that frame again", () => {
  const o = { size: "compact", track: true };
  assert.deepEqual(orbitFrameAt(1234, o), orbitFrameAt(1234, o));
  assert.deepEqual(orbitFrameAt(1234, o).rows, orbitFrameAt(1234 + SPEEDS.normal, o).rows);
  assert.equal(orbitFrameAt(0, o).k, 0);
  assert.equal(indexAt(22, Number.NaN, 3000), 0, "a moment that is not a number is the start");
});

test("the speed is a row of SPEEDS: each a quarter round in a quarter of its revolution, and fast before slow", () => {
  assert.ok(SPEEDS.slow > SPEEDS.normal && SPEEDS.normal > SPEEDS.fast);
  const n = framesOf(sizeOf("expanded")).length;
  for (const speed of Object.keys(SPEEDS)) assert.equal(orbitFrameAt(SPEEDS[speed] / 4, { size: "expanded", speed }).k, Math.floor(n / 4), speed);
  assert.ok(orbitFrameAt(1000, { size: "expanded", speed: "fast" }).k > orbitFrameAt(1000, { size: "expanded", speed: "slow" }).k);
  assert.equal(orbitTrackOf({ state: "ACTIVE" }, { settings: { pane: { orbitSpeed: "fast" } } }).revMs, SPEEDS.fast);
  assert.equal(orbitTrackOf({ state: "ACTIVE" }).revMs, SPEEDS.normal, "normal by default");
});

test("a phase starts it that far round, and the header's two orbits share one angle at every moment", () => {
  const n = (size) => framesOf(sizeOf(size)).length;
  assert.equal(orbitFrameAt(0, { size: "compact", phase: 0.5 }).k, Math.floor(n("compact") / 2));
  for (const t of [0, 400, 750, 1500, 2200, 2999]) {
    for (const size of HEADER_SIZES) assert.equal(orbitFrameAt(t, { size }).k, Math.floor((t / SPEEDS.normal) * n(size)), `${size} at ${t}`);
  }
});

test("it turns in every state of the indicator while a clock runs -- only ACTIVE is bright -- and stops only for no motion or no clock", () => {
  assert.deepEqual(MOTION.map((r) => r.variant), ["bright", "gentle"]);
  for (const state of INDICATOR_STATES) {
    const i = { state };
    assert.equal(orbitOf(i, { orbitMs: 0 }).moving, true, state);
    assert.notDeepEqual(orbitOf(i, { orbitMs: 0 }).rows, orbitOf(i, { orbitMs: SPEEDS.normal / 2 }).rows, `${state}: half a revolution later, another frame`);
    assert.equal(orbitOf(i).variant, state === "ACTIVE" ? "bright" : "gentle", state);
    assert.equal(orbitOf(i, { clock: false }).moving, false, `${state}: no clock, parked`);
  }
  assert.equal(motionOf(null).variant, "gentle", "no indicator: grey, still turning");
});

test("with the animation off it stands still, the same frame at every moment, whatever the task does", () => {
  const off = { pane: { animation: "off" } };
  for (const state of ["ACTIVE", "IDLE", "BLOCKED"]) {
    const frames = [0, 500, 9_000].map((orbitMs) => orbitOf({ state }, { orbitMs, settings: off }).rows);
    assert.deepEqual(frames[1], frames[0], state);
    assert.deepEqual(frames[2], frames[0], state);
  }
  assert.equal(movingOf(off), false);
  assert.equal(movingOf({ pane: { animation: "auto" } }), true);
});

test("with no clock -- a docked pane's answer -- it is parked as one segment, and the track says how a pane turns both orbits", () => {
  const parked = orbitOf({ state: "ACTIVE" }, { clock: false, size: "compact" });
  assert.deepEqual(parked.rows, [[{ text: parked.parked, tone: "brand" }]]);
  assert.equal(orbitOf({ state: "IDLE" }, { clock: false }).rows[0][0].tone, "subtle");
  const track = orbitTrackOf({ state: "IDLE" }, { track: true });
  assert.deepEqual(Object.keys(track).sort(), ["moving", "revMs", "rings", "variant"], "no time in it: a quiet task's answer is the same answer");
  assert.deepEqual([track.moving, track.variant], [true, "gentle"]);
  assert.deepEqual(track.rings.map((r) => r.size), HEADER_SIZES);
  for (const r of track.rings) assert.equal(r.parked, textOf(framesOf(sizeOf(r.size))[0][0]), `${r.size}: the text a pane finds`);
  for (const r of track.rings) assert.equal(r.frames.length, framesOf(sizeOf(r.size)).length, `${r.size}: every frame`);
  assert.equal(orbitTrackOf({ state: "IDLE" }, { settings: { pane: { animation: "off" } } }).moving, false);
});

// ---- in a viewer --------------------------------------------------------------------------------------------------

test("every viewer's header opens with it and carries it in the badge: compact where there is room, mini in a narrow pane", () => {
  assert.equal(opening(frameOf(pane(100), undefined, { orbitMs: 0 }).lines[0], 5), textOf(orbitFrameAt(0, { size: "compact" }).rows[0]));
  assert.equal(opening(frameOf(pane(44), undefined, { orbitMs: 0 }).lines[0], 3), textOf(orbitFrameAt(0, { size: "mini" }).rows[0]));
  for (const t of [0, 700, 1900]) assert.ok(unstyled(frameOf(pane(100), undefined, { orbitMs: t }).lines[0]).includes(`▏ ${textOf(orbitFrameAt(t, { size: "mini" }).rows[0])} ● ORBITING ▕`), `the badge's orbit at ${t}, at the header's angle`);
  assert.match(unstyled(frameOf(workflow({ columns: 100, rows: 30 })).lines[0]), /ORBIT LIVE .*● ORBITING/, "the dashboard too");
});

test("an orbit tick draws the rows that hold the orbit and nothing else: the frame it would have been, every other row the same string", () => {
  const s = pane(100);
  const d = derivedOf(s);
  const a = frameOf(s, d, { orbitMs: 0 });
  assert.deepEqual(a.orbitRows, [{ row: 0, part: "header", k: 0 }]);
  assert.equal(a.orbiting, true);
  const later = orbitFrameOf(s, d, a, { orbitMs: 700 });
  assert.deepEqual(later.lines, frameOf(s, d, { orbitMs: 700 }).lines);
  assert.notEqual(later.lines[0], a.lines[0]);
  assert.deepEqual(later.lines.slice(1), a.lines.slice(1));
  assert.equal(later.full, false, "never a full redraw");
});

test("the orbit's clock moves nothing but the orbit: the indicator, the lifecycle, the progress and every other row are the same at two moments", () => {
  for (const s of [engineering({ columns: 100, rows: 34, start: { layout: "pane" } }), pane(100, 34), engineering({ columns: 120, rows: 34 })]) {
    const d = derivedOf(s);
    const before = JSON.stringify(s);
    const at = (orbitMs) => contextOf(s, d, { orbitMs });
    assert.deepEqual(indicatorFor(at(1700)), indicatorFor(at(0)));
    assert.deepEqual(lifecycleOf(at(1700)), lifecycleOf(at(0)));
    assert.deepEqual([taskProgressOf(at(1700)), testProgressOf(at(1700))], [taskProgressOf(at(0)), testProgressOf(at(0))]);
    const [a, b] = [frameOf(s, d, { orbitMs: 0 }), frameOf(s, d, { orbitMs: 1700 })];
    const rest = (f) => f.lines.filter((_, i) => !f.orbitRows.some((o) => o.row === i));
    assert.deepEqual(rest(b), rest(a));
    assert.notDeepEqual(b.orbitRows.map((o) => b.lines[o.row]), a.orbitRows.map((o) => a.lines[o.row]));
    assert.equal(JSON.stringify(s), before, "and nothing is written into the viewer's state");
  }
});

test("a blocked task still orbits -- motion is the viewer's, the word is the task's, and it stays BLOCKED", () => {
  const blocked = engineering({ columns: 100, rows: 30, start: { layout: "pane" }, view: { lifecycle: "BLOCKED", blocked: { stop: "ENVIRONMENT_BLOCKED" } } });
  const d = derivedOf(blocked);
  const heads = [0, 500, 1000, 1500, 2000].map((orbitMs) => unstyled(frameOf(blocked, d, { orbitMs }).lines[0]));
  assert.ok(new Set(heads.map((h) => opening(h, 5))).size > 2, "it turns");
  for (const h of heads) assert.match(h, /■ BLOCKED/);
  assert.equal(frameOf(blocked).orbiting, true);
  const later = reduce(blocked, { type: "tick", nowMs: NOW + 3_600_000 });
  assert.equal(indicatorFor(contextOf(later, derivedOf(later), { orbitMs: 99_999 })).state, "BLOCKED", "an hour of orbit moves no state");
});

test("a viewer waiting for its session's task turns the expanded orbit in the middle of the body, over what it waits for", () => {
  const s = waitingState();
  const d = derivedOf(s);
  const f = frameOf(s, d, { orbitMs: 0 });
  assert.deepEqual(f.orbitRows.map((o) => o.part), ["header", "expanded", "expanded", "expanded"]);
  const lines = f.lines.map((l) => unstyled(l));
  for (const o of f.orbitRows.slice(1)) {
    const l = lines[o.row];
    assert.ok(Math.abs((l.length - l.trimStart().length) - (l.length - l.trimEnd().length)) <= 1, `centred: ${l}`);
  }
  const sentence = lines.findIndex((l) => /^ +waiting for this session's task/.test(l));
  assert.ok(sentence > f.orbitRows.at(-1).row, "the words under the orbit, centred, with no gutter");
  const later = orbitFrameOf(s, d, f, { orbitMs: 900 });
  assert.notDeepEqual(f.orbitRows.slice(1).map((o) => later.lines[o.row]), f.orbitRows.slice(1).map((o) => f.lines[o.row]), "it turns while the viewer waits");
  assert.deepEqual(later.lines.filter((_, i) => !f.orbitRows.some((o) => o.row === i)), f.lines.filter((_, i) => !f.orbitRows.some((o) => o.row === i)));
  assert.doesNotMatch(lines.join(""), /ORBITING/, "and nothing says the task moves: there is none");
});

test("a short body says what the viewer waits for without the orbit; an ASCII viewer's waiting orbit is ASCII", () => {
  const short = frameOf(waitingState({ rows: 9 }), undefined, { orbitMs: 0 });
  assert.deepEqual(short.orbitRows.map((o) => o.part), ["header"]);
  assert.ok(short.lines.some((l) => /waiting for this session's task/.test(unstyled(l))));
  const ascii = frameOf(waitingState({ ascii: true }), undefined, { orbitMs: 1200 });
  assert.doesNotMatch(ascii.lines.join(""), /[⠀-⣿]/);
  assert.ok(ascii.lines.some((l) => /\(o\)/.test(l)), "the planet with its rings");
});
