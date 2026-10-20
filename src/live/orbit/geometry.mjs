// THE ORBIT'S GEOMETRY (0.0.3, ADR 0029): a planet fixed in the middle of a grid of Braille dots and the ring its
// satellite runs on, sampled from an ellipse -- never drawn by hand, so a new size is one row and every frame of a size
// has one shape. A SIZE is so many terminal cells wide and tall, each cell two dots wide and four tall. Its ring is the
// fewest samples of its ellipse in which the satellite never moves more than one dot at a time, from the top of the
// ring and clockwise. Pure: no clock, no terminal.
//
//   SIZES                                  [{ name, cells: { w, h }, a, b, planet, ascii }]   a, b: half-axes in dots
//   sizeOf(name) -> size                   compact for a name it does not know
//   gridOf(size) -> { w, h, cx, cy }       the dot grid and its centre
//   planetOf(size) -> [{ x, y }]           the planet's dots: the same in every frame
//   ringOf(size) -> [{ x, y, near }]       the satellite's positions; near: on the half in front of the planet
//   indexAt(n, timeMs, revMs, phase?) -> k which of n positions the satellite is at, one revolution every revMs
export const SIZES = Object.freeze([
  Object.freeze({ name: "mini", cells: Object.freeze({ w: 3, h: 1 }), a: 2.5, b: 1.5, planet: "dot", ascii: "o" }),
  Object.freeze({ name: "compact", cells: Object.freeze({ w: 5, h: 1 }), a: 4.5, b: 1.5, planet: "dot", ascii: "o" }),
  Object.freeze({ name: "expanded", cells: Object.freeze({ w: 9, h: 3 }), a: 8, b: 5, planet: "disc", ascii: "(o)" }),
]);

export const sizeOf = (name) => SIZES.find((s) => s.name === name) ?? SIZES[1];

export const gridOf = (s) => ({ w: s.cells.w * 2, h: s.cells.h * 4, cx: (s.cells.w * 2 - 1) / 2, cy: (s.cells.h * 4 - 1) / 2 });

const span = (from, n) => Array.from({ length: n }, (_, i) => from + i);

const cross = (xs, ys) => xs.flatMap((x) => ys.map((y) => ({ x, y })));

// The planet, from the dot left of and above the centre: a 2×2 block in one cell (`⠶`), or a disc three cells wide
// (`⠰⣿⠆`) -- a 2×4 core and a 1×2 side either way of it.
const PLANETS = Object.freeze({
  dot: (x, y) => cross(span(x, 2), span(y, 2)),
  disc: (x, y) => [...cross(span(x, 2), span(y - 1, 4)), ...cross([x - 1, x + 2], span(y, 2))],
});

export const planetOf = (s) => ((g) => PLANETS[s.planet](Math.floor(g.cx), Math.floor(g.cy)))(gridOf(s));

// ---- the ring ---------------------------------------------------------------------------------------------------

const TOP = -Math.PI / 2;

const dotAt = (g, s, t) => ({ x: Math.round(g.cx + s.a * Math.cos(t)), y: Math.round(g.cy + s.b * Math.sin(t)) });

const same = (p, q) => p.x === q.x && p.y === q.y;

const stepOf = (p, q) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));

const sampled = (g, s, n) => Array.from({ length: n }, (_, k) => dotAt(g, s, TOP + (2 * Math.PI * k) / n));

// Samples that land on one dot are one position; the last is dropped when it is the first again.
const deduped = (pts) => pts.reduce((out, p) => (out.length && same(out.at(-1), p) ? out : [...out, p]), []);

const closed = (pts) => (pts.length > 1 && same(pts[0], pts.at(-1)) ? pts.slice(0, -1) : pts);

const ringAt = (g, s, n) => closed(deduped(sampled(g, s, n)));

const smooth = (pts) => pts.length > 2 && pts.every((p, i) => stepOf(p, pts[(i + 1) % pts.length]) <= 1);

const SAMPLES = span(8, 312);

const fewest = (g, s) => SAMPLES.find((n) => smooth(ringAt(g, s, n))) ?? SAMPLES.at(-1);

const built = (s) => ((g) => ringAt(g, s, fewest(g, s)).map((p) => Object.freeze({ ...p, near: p.y > g.cy })))(gridOf(s));

const RINGS = new Map();

const remembered = (s) => RINGS.set(s.name, Object.freeze(built(s))).get(s.name);

export const ringOf = (s) => RINGS.get(s.name) ?? remembered(s);

// ---- where the satellite is ---------------------------------------------------------------------------------------

const share = (x) => x - Math.floor(x);

const timeOf = (timeMs) => (Number.isFinite(timeMs) ? timeMs : 0);

// The share of a revolution a moment is -- plus a phase, in revolutions -- as one of n positions.
export const indexAt = (n, timeMs, revMs, phase = 0) => Math.min(n - 1, Math.floor(share(timeOf(timeMs) / revMs + phase) * n));
