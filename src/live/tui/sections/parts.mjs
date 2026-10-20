// The pieces every section is made of. A ROW is { left: [segment], right: [segment], ... }, a segment is
// { text, tone } -- DATA, never a styled string: the frame (frame.mjs) is the one place a row is cleaned, cut to
// the width it may have and coloured, through src/live/render/width.mjs `drawn`.
import { durationOf, clockOf } from "../../render/lines.mjs";
import { PULSE } from "../../words.mjs";

export const ABSENT = Object.freeze({ unknown: "UNKNOWN", unrecorded: "NOT RECORDED" });

export const seg = (text, tone) => ({ text: String(text ?? ""), tone });
export const dim = (text) => seg(text, "subtle");
export const row = (left, right = [], extra = {}) => ({ left: left.filter((s) => s && s.text !== ""), right: right.filter((s) => s && s.text !== ""), ...extra });
export const str = (v) => (typeof v === "string" && v.length > 0 ? v : null);
export const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Segments joined by a dimmed separator, nothing kept that has nothing to say.
export const joined = (segs, sep = " · ") => segs.filter((s) => s && s.text !== "").flatMap((s, i) => (i ? [dim(sep), s] : [s]));

// A row with nothing in it, and a rule across a width (0.0.3: the screen's regions, tui/regions.mjs, and the pane's).
export const blank = () => row([]);
export const rule = (width, ch = "─") => row([dim(ch.repeat(Math.max(0, width)))]);

// NOW's label column (0.0.3): one width for every row of it -- the task's, the tracked work's, the session's and the
// lifecycle's -- so their words start in one column, as Orbit Live's look lines them up.
export const LABEL_CELLS = 12;
export const labelled = (label, segs) => row([dim(label.padEnd(LABEL_CELLS)), ...segs], [], { label });

// The pulse of a row that is genuinely running: by wall-clock second, the LIVE glyphs (src/live/words.mjs PULSE).
export const pulseOf = (nowMs) => PULSE[Math.floor(nowMs / 1000) % PULSE.length];

const ms = (iso) => (typeof iso === "string" ? Date.parse(iso) : NaN);

// How long from one journal time to another (or to now, when it has not ended). Null when either is unknown.
export function between(from, to, nowMs) {
  const end = to ? ms(to) : nowMs;
  return Number.isFinite(ms(from)) && Number.isFinite(end) ? durationOf(end - ms(from)) : null;
}

export const since = (iso, nowMs) => between(iso, null, nowMs);

export const clock = (iso) => clockOf(iso);

export const nowClock = (nowMs) => clockOf(new Date(nowMs).toISOString());

// Cells packed into rows no wider than `width`, a cell never split across two.
export function packed(cells, width, sep = "   ") {
  const rows = [[]];
  for (const cell of cells) placed(rows, cell, width, sep);
  return rows.filter((r) => r.length);
}

const widthOf = (cells) => cells.reduce((n, c) => n + [...c.text].length, 0);

function placed(rows, cell, width, sep) {
  const last = rows.at(-1);
  const fits = !last.length || widthOf(last) + sep.length + [...cell.text].length <= width;
  if (fits) last.push(...(last.length ? [dim(sep)] : []), cell);
  if (!fits) rows.push([cell]);
}
