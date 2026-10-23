// ONE FRAME of Satellite Live's full screen: exactly `rows` lines, each cut to `columns` by what it shows (Orbit
// Live's drawn()), from the live view, the viewer's own state and the orbit's own clock. Pure, so the terminal adapter
// only compares it with the last one and rewrites the rows that changed. The orbit turns on `orbitMs`, the terminal's
// monotonic clock, and says nothing about the mission: the viewer's word (ORBITING, IDLE, FINISHED ...) and the
// mission's lifecycle are their own columns, and a tick that turns the orbit changes the header row alone.
import { orbitOf } from "../../../../src/live/orbit.mjs";
import { drawn } from "../../../../src/live/render/width.mjs";
import { glyph } from "../../../../src/live/tui/glyphs.mjs";
import { dim, seg } from "../../../../src/live/tui/sections/parts.mjs";
import { VIEWS, viewOf } from "./views.mjs";

export const CHROME = Object.freeze({ header: 1, tabs: 1, rule: 1, footer: 1 });

export const MIN_SIZE = Object.freeze({ columns: 40, rows: 8 });

export const bodyHeightOf = (s) => Math.max(1, s.rows - CHROME.header - CHROME.tabs - CHROME.rule - CHROME.footer);

export const HELP = Object.freeze([
  ["1 … 9", "show a view: mission, agents, roles, skills, workflows, tools, memory, timeline, verification"],
  ["tab · shift-tab", "the next or the previous view (also → and ←, l and h)"],
  ["j k ↑ ↓", "scroll a line"],
  ["pgdn · pgup", "scroll a page"],
  ["g · G", "the top or the bottom"],
  ["space", "freeze what is shown (the journal is still followed) · space again to catch up"],
  ["r", "draw everything again"],
  ["?", "this help · any key closes it"],
  ["q · ctrl-c", "leave -- the mission is never touched"],
  ["", "Satellite Live is a viewer: it approves, resumes, cancels and runs nothing"],
]);

// The orbit is bright only while lines arrive (ORBITING); otherwise it turns grey at the same speed.
const indicatorOf = (viewer) => ({ state: viewer.state === "LIVE" ? "ACTIVE" : viewer.state });

const orbitRow = (s, viewer, orbitMs) => orbitOf(indicatorOf(viewer), { size: "mini", ascii: s.ascii, orbitMs }).rows[0] ?? [];

const headerRow = (s, view, viewer, orbitMs) => [...orbitRow(s, viewer, orbitMs), seg(" "), seg(" SATELLITE LIVE ", "chip"), seg(" "), seg(`${viewer.glyph} ${viewer.word}`, viewer.tone), dim(`  ${view.mission.id ?? "no mission"} · ${view.mission.lifecycle} · revision ${view.meta.seq}`), seg(s.frozen ? "  FROZEN" : "", "warning")];

const tabsRow = (s) => VIEWS.map((v) => seg(` ${v.key} ${v.title} `, v.id === s.view ? "selected" : "subtle"));

const ruleRow = (s) => [dim((s.ascii ? "-" : "─").repeat(s.columns))];

const footerRow = () => [dim("q quit · 1-9 view · tab next · j/k scroll · g/G ends · space freeze · r redraw · ? help")];

const helpRows = () => [[seg("SATELLITE LIVE · KEYS", "label")], [], ...HELP.map(([keys, say]) => [seg(`  ${keys.padEnd(18)}`, "key"), dim(say)])];

const bodyOf = (s, view) => (s.help ? helpRows() : viewOf(s.view).rows(view));

const asciiOf = (segs, ascii) => (ascii ? segs.map((g) => ({ ...g, text: glyph(g.text, true) })) : segs);

const lineOf = (s, segs) => drawn(asciiOf(segs, s.ascii), s.columns, s.colour);

// Where the body starts: the state's scroll, kept inside what the view has.
const topOf = (s, total) => Math.max(0, Math.min(s.top, total - bodyHeightOf(s)));

const windowOf = (s, rows, top) => Array.from({ length: bodyHeightOf(s) }, (_, i) => rows[top + i] ?? []);

const tooSmall = (s) => s.columns < MIN_SIZE.columns || s.rows < MIN_SIZE.rows;

const smallFrame = (s) => ({ lines: Array.from({ length: s.rows }, (_, i) => (i === 0 ? lineOf(s, [seg(`Satellite Live needs ${MIN_SIZE.columns}×${MIN_SIZE.rows}: use live watch --plain`, "warning")]) : "")), columns: s.columns, rows: s.rows, top: 0, total: 0, full: s.full });

// s: the viewer's state (state.mjs); view: liveViewOf(...); viewer: viewerStateOf(...); orbitMs: the orbit's clock
export function frameOf(s, view, viewer, orbitMs = 0) {
  if (tooSmall(s)) return smallFrame(s);
  const rows = bodyOf(s, view);
  const top = topOf(s, rows.length);
  const lines = [headerRow(s, view, viewer, orbitMs), tabsRow(s), ruleRow(s), ...windowOf(s, rows, top), footerRow()].map((segs) => lineOf(s, segs));
  return { lines, columns: s.columns, rows: s.rows, top, total: rows.length, full: s.full };
}
