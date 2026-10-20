// ORBIT LIVE'S LOOK (0.0.1, ADR 0027): a terminal with more than sixteen colours draws the palette at its depth and a
// pane's rows on their bands; sixteen colours draw as before; no colour draws no sequence at all; a light background
// gets no band; and every line is still exactly the screen's width, holding nothing but ansi.mjs's own sequences.
import assert from "node:assert/strict";
import { test } from "node:test";
import { OWN_SEQUENCE, TONES, blankOn, toned, unstyled } from "../src/live/render/ansi.mjs";
import { BANDS, DEPTHS, LOOK, PALETTE, bandsOf, depthOf } from "../src/live/render/theme.mjs";
import { displayWidth } from "../src/live/render/width.mjs";
import { frameOf } from "../src/live/tui/frame.mjs";
import { reduce } from "../src/live/tui/reducer.mjs";
import { workflow } from "./live-tui.fixture.mjs";

const seqs = (text) => text.match(/\u001b\[[0-9;?]*[A-Za-z]/g) ?? [];

const bg = (name) => `48;2;${PALETTE[name].rgb.join(";")}`;

test("every tone has a look, every look's colours are the palette's, every band is a colour of it", () => {
  for (const tone of Object.keys(TONES)) assert.ok(LOOK[tone], `${tone} has a look`);
  for (const [tone, l] of Object.entries(LOOK)) for (const c of [l.fg, l.bg].filter(Boolean)) assert.ok(PALETTE[c], `${tone}: ${c}`);
  for (const c of Object.values(BANDS)) assert.ok(PALETTE[c], c);
  for (const [name, c] of Object.entries(PALETTE)) assert.ok(c.rgb.length === 3 && c.xterm >= 16 && c.xterm <= 255, name);
  assert.deepEqual(DEPTHS, ["16", "256", "truecolor"]);
});

test("a tone at each depth: 24-bit, the nearest of 256, sixteen as before, and nothing without colour", () => {
  assert.equal(toned("x", "brand", { depth: "truecolor", band: null }), "\u001b[1;38;2;242;139;102mx\u001b[0m");
  assert.equal(toned("x", "brand", { depth: "256", band: null }), "\u001b[1;38;5;209mx\u001b[0m");
  assert.equal(toned("x", "brand", true), "\u001b[35mx\u001b[0m");
  assert.equal(toned("x", "brand", { depth: "16", band: "header" }), "\u001b[35mx\u001b[0m", "sixteen colours never draw a band");
  assert.equal(toned("x", "brand", false), "x");
});

test("on a band every piece of a row keeps the band's background -- a chip its own", () => {
  const paint = { depth: "truecolor", band: "header" };
  assert.equal(toned("x", null, paint), `\u001b[${bg("header")}mx\u001b[0m`);
  assert.equal(toned("x", "subtle", paint), `\u001b[38;2;125;133;148;${bg("header")}mx\u001b[0m`);
  assert.equal(toned("x", "chip", paint), `\u001b[1;38;2;242;139;102;${bg("elevated")}mx\u001b[0m`);
  assert.equal(blankOn(2, paint), `\u001b[${bg("header")}m  \u001b[0m`);
  assert.equal(blankOn(2, false), "  ");
  assert.equal(blankOn(0, paint), "");
});

test("the depth is what the terminal says it draws, and a light background gets no band", () => {
  assert.equal(depthOf({ COLORTERM: "truecolor", TERM: "xterm-256color" }), "truecolor");
  assert.equal(depthOf({ COLORTERM: "24bit" }), "truecolor");
  assert.equal(depthOf({ WT_SESSION: "f7a3" }), "truecolor", "Windows Terminal draws 24-bit and says so only by being there");
  assert.equal(depthOf({ TERM: "tmux-256color" }), "256");
  assert.equal(depthOf({ TERM: "xterm" }), "16");
  assert.equal(depthOf({}), "16");
  assert.equal(bandsOf({ COLORTERM: "truecolor" }), true);
  assert.equal(bandsOf({ COLORTERM: "truecolor", COLORFGBG: "0;15" }), false, "black on white");
  assert.equal(bandsOf({ TERM: "xterm-256color", COLORFGBG: "0;default;7" }), false);
  assert.equal(bandsOf({ COLORTERM: "truecolor", COLORFGBG: "15;0" }), true, "white on black");
  assert.equal(bandsOf({ TERM: "xterm" }), false, "sixteen colours: no band");
});

test("a text symbol is one cell as terminals draw it; an emoji and a CJK character two; a Braille cell one", () => {
  for (const ch of ["▶", "⚠", "⏸", "✓", "●", "■", "⠿", "⠀"]) assert.equal(displayWidth(ch), 1, ch);
  for (const ch of ["📸", "👤", "中", "가"]) assert.equal(displayWidth(ch), 2, ch);
});

const painted = (over) => ((s) => reduce({ ...s, viewer: { ...s.viewer, ...over } }, { type: "painted" }))(workflow({ columns: 90, rows: 32, colour: true, start: { layout: "pane" } }));

test("a pane at every depth, on bands or not: every line exactly the screen's width, only ansi.mjs's sequences", () => {
  for (const over of [{ depth: "truecolor", bands: true }, { depth: "256", bands: true }, { depth: "truecolor", bands: false }, { depth: "16", bands: false }]) {
    const lines = frameOf(painted(over)).lines;
    for (const l of lines) assert.equal(displayWidth(unstyled(l)), 89, JSON.stringify(over));
    for (const x of lines.flatMap(seqs)) assert.match(x, OWN_SEQUENCE, JSON.stringify(over));
  }
});

test("the header, the tabs, the checks and the footer sit on their bands; with no bands, none is drawn", () => {
  const banded = frameOf(painted({ depth: "truecolor", bands: true })).lines;
  assert.ok(banded[0].includes(bg("header")), "the header's band");
  for (const band of ["tabs", "card", "footer"]) assert.ok(banded.some((l) => l.includes(bg(band))), `the ${band}' band`);
  const plain = frameOf(painted({ depth: "truecolor", bands: false })).lines;
  for (const band of Object.values(BANDS)) assert.ok(!plain.some((l) => l.includes(bg(band))), band);
});
