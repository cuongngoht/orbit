// THE ORBIT AS TEXT (0.0.3, ADR 0029): every frame of a size -- its satellite at each position of its ring -- as rows of
// segments: Braille, where a cell is the dots that fall in it, or plain ASCII, where a cell is one character. Every frame
// of a size is the same width and height and holds the planet in the same cells. A cell's TONE says what it shows, the
// first row of a table that holds: the planet (its cell keeps the planet's tone whatever passes it, so the planet is
// never lost behind the satellite); the satellite, in front of the planet (near) or behind it (far); the track it runs
// on, only when asked (a track needs colour: in one colour it would hide the satellite); or nothing.
//
//   TONES_OF: variant -> { planet, near, far, track }      the variant is a row of orbit.mjs MOTION
//   framesOf(size, { ascii?, variant?, track? }) -> [frame] frame: [row], row: [{ text, tone }]; made once, then kept
//   textOf(row) -> string                                  what a row of a frame reads
import { planetOf, ringOf } from "./geometry.mjs";

export const TONES_OF = Object.freeze({
  bright: Object.freeze({ planet: "orbit:planet", near: "orbit:near", far: "orbit:far", track: "orbit:track" }),
  gentle: Object.freeze({ planet: "orbit:planet", near: "orbit:near:gentle", far: "orbit:far:gentle", track: "orbit:track" }),
});

const cellKey = (p) => `${Math.floor(p.x / 2)}:${Math.floor(p.y / 4)}`;

const cellsOf = (s) => Array.from({ length: s.cells.h }, (_, row) => Array.from({ length: s.cells.w }, (_, col) => ({ col, row, key: `${col}:${row}` })));

const satTone = (sat, t) => (sat.near ? t.near : t.far);

const cellWith = (table, layers, t) => table.find((r) => r.when(layers)).cell(layers, t);

// ---- Braille: a cell is the OR of its dots ------------------------------------------------------------------------

const BIT = Object.freeze([[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]);

const braille = (dots) => String.fromCodePoint(0x2800 + dots.reduce((m, p) => m | BIT[p.y % 4][p.x % 2], 0));

const BRAILLE_CELL = Object.freeze([
  { when: (l) => l.planet.length > 0, cell: (l, t) => ({ text: braille([...l.planet, ...l.sat]), tone: t.planet }) },
  { when: (l) => l.sat.length > 0, cell: (l, t) => ({ text: braille(l.sat), tone: satTone(l.sat[0], t) }) },
  { when: (l) => l.track.length > 0, cell: (l, t) => ({ text: braille(l.track), tone: t.track }) },
  { when: () => true, cell: () => ({ text: braille([]), tone: null }) },
]);

const inCell = (dots, c) => dots.filter((p) => cellKey(p) === c.key);

const brailleLayers = (c, sat, at) => ({ planet: inCell(at.planet, c), sat: inCell([sat], c), track: inCell(at.track, c) });

const brailleFrame = (s, sat, at) => cellsOf(s).map((row) => merged(row.map((c) => cellWith(BRAILLE_CELL, brailleLayers(c, sat, at), at.tones))));

// ---- ASCII: a cell is one character -- the planet's, or where in the cell the satellite is ------------------------
// A cell is four dots tall, so the satellite reads ' at its top, - across its middle and . at its bottom; passing in
// front of the planet it is O, and behind it the planet hides it.

const SUB = Object.freeze(["'", "-", "-", "."]);

const planetFrom = (s) => Math.floor((s.cells.w - s.ascii.length) / 2);

const planetChar = (s, c) => (c.row === Math.floor(s.cells.h / 2) && c.col >= planetFrom(s) && c.col < planetFrom(s) + s.ascii.length ? s.ascii[c.col - planetFrom(s)] : null);

const ASCII_CELL = Object.freeze([
  { when: (l) => l.char !== null && l.sat.length > 0 && l.sat[0].near, cell: (l, t) => ({ text: "O", tone: t.planet }) },
  { when: (l) => l.char !== null, cell: (l, t) => ({ text: l.char, tone: t.planet }) },
  { when: (l) => l.sat.length > 0, cell: (l, t) => ({ text: SUB[l.sat[0].y % 4], tone: satTone(l.sat[0], t) }) },
  { when: () => true, cell: () => ({ text: " ", tone: null }) },
]);

const asciiFrame = (s, sat, at) => cellsOf(s).map((row) => merged(row.map((c) => cellWith(ASCII_CELL, { char: planetChar(s, c), sat: inCell([sat], c) }, at.tones))));

// ---- frames --------------------------------------------------------------------------------------------------------

// Neighbouring cells of one tone are one segment.
const joinedTo = (out, x) => [...out.slice(0, -1), { text: out.at(-1).text + x.text, tone: x.tone }];

const merged = (cells) => cells.reduce((out, x) => (out.length && out.at(-1).tone === x.tone ? joinedTo(out, x) : [...out, x]), []);

export const textOf = (row) => row.map((x) => x.text).join("");

const frameText = (frame) => frame.map(textOf).join("\n");

// Neighbouring frames that read the same are one (an ASCII cell cannot show every dot a Braille cell can), and so are
// the last and the first.
const distinct = (frames) => frames.reduce((out, f) => (out.length && frameText(out.at(-1)) === frameText(f) ? out : [...out, f]), []);

const wrapped = (frames) => (frames.length > 1 && frameText(frames[0]) === frameText(frames.at(-1)) ? frames.slice(0, -1) : frames);

const RASTERS = Object.freeze({ braille: brailleFrame, ascii: asciiFrame });

const modeOf = (o) => (o.ascii ? "ascii" : "braille");

const tracked = (o) => o.track === true && !o.ascii;

const keyOf = (s, o) => `${s.name}|${modeOf(o)}|${TONES_OF[o.variant] ? o.variant : "bright"}|${tracked(o) ? "track" : "plain"}`;

const deepFrozen = (frames) => Object.freeze(frames.map((f) => Object.freeze(f.map((row) => Object.freeze(row.map((x) => Object.freeze(x)))))));

function built(s, o) {
  const at = { planet: planetOf(s), track: tracked(o) ? ringOf(s) : [], tones: TONES_OF[o.variant] ?? TONES_OF.bright };
  return deepFrozen(wrapped(distinct(ringOf(s).map((sat) => RASTERS[modeOf(o)](s, sat, at)))));
}

const FRAMES = new Map();

const remembered = (s, o) => FRAMES.set(keyOf(s, o), built(s, o)).get(keyOf(s, o));

export const framesOf = (s, o = {}) => FRAMES.get(keyOf(s, o)) ?? remembered(s, o);
