// ONE FRAME of the full-screen viewer: every row of the screen as a string, each exactly `columns - 1` cells wide
// (the last column is never written, so no terminal scrolls or wraps on it), holding no line break and no
// sequence but colour. This is the ONE place a row becomes a string: every segment of data goes through
// src/live/render/width.mjs `drawn` -- cleaned by printable(), cut by display width, then coloured -- so a
// journal's text cannot reach the terminal as anything but text.
//
//   frameOf(state, derived?) -> { columns, rows, lines, full, extents }
import { drawn, displayWidth } from "../render/width.mjs";
import { blankOn, unstyled } from "../render/ansi.mjs";
import { derivedOf, yielded } from "./derive.mjs";
import { glyph } from "./glyphs.mjs";
import { LABELS, RIGHT_SHARE, TIERS, budgetOf, tierOf } from "./layout.mjs";
import { SECTIONS } from "./sections/index.mjs";
import { footerRow, headerRow } from "./sections/top.mjs";
import { dim, row, seg } from "./sections/parts.mjs";
import { activityOverlay } from "./overlays/activity.mjs";
import { pickerOverlay } from "./overlays/picker.mjs";
import { evidenceOverlay } from "./overlays/evidence.mjs";
import { diagnosticsOverlay } from "./overlays/diagnostics.mjs";
import { helpOverlay, tooSmallRows } from "./overlays/help.mjs";
import { emptyRow, paneBody } from "./pane-frame.mjs";
import { orbitOf } from "../orbit.mjs";
import { indicatorFor } from "./workspace.mjs";

const OVERLAYS = Object.freeze({ picker: (s) => pickerOverlay(s), activity: (s, d) => activityOverlay(s, d), evidence: (s) => evidenceOverlay(s), diagnostics: (s, d, t) => diagnosticsOverlay(s, d, t.name), help: () => helpOverlay() });

const FIXED = 4;
const NO_EXTENT = Object.freeze({ max: 0, page: 1 });

// The pane layout is a COLUMN beside an AI CLI (1.8.6): it is drawn down to PANE_MIN -- a 36% split of a 110-column
// terminal is 40 -- read in the dashboard's narrow tier where the dashboard itself would need 60×12.
export const PANE_MIN = Object.freeze({ columns: 20, rows: 8 });

const NARROW = TIERS.find((t) => t.name === "narrow");

const paneFits = (state, size) => state.viewer.layout === "pane" && !state.viewer.overlay && size.columns >= PANE_MIN.columns && size.rows >= PANE_MIN.rows;

const tierFor = (state, size) => ((t) => (t.name === "too-small" && paneFits(state, size) ? NARROW : t))(tierOf(size.columns, size.rows));

export function contextOf(state, d) {
  const size = state.viewer.size;
  const tier = tierFor(state, size);
  const width = Math.max(1, size.columns - 1);
  return { state: yielded(state), d, tier, width, inner: Math.max(10, width - tier.label), nowMs: state.viewer.nowMs, size };
}

// ---- a row as a string ----------------------------------------------------------------------------------

const glyphed = (ctx, segs) => (ctx.state.viewer.ascii ? segs.map((s) => ({ ...s, text: glyph(String(s.text).replace(/\r?\n/g, " ⏎ "), true) })) : segs);

const toneAll = (segs, tone) => segs.map((s) => ({ ...s, tone }));

const GUTTER = [
  { when: (r) => r.selected || r.current, mark: "›" },
  { when: (r) => r.match, mark: "•" },
  { when: () => true, mark: " " },
];

const labelSegs = (ctx, r) => (r.label === undefined ? [] : [seg(`${GUTTER.find((g) => g.when(r)).mark}${String(r.label).padEnd(Math.max(0, ctx.tier.label - 1))}`, "label")]);

const shown = (ctx, r) => (r.selected || r.current ? toneAll(r.left, "match") : r.left);

const padded = (line, width, paint = false) => `${line}${blankOn(Math.max(0, width - displayWidth(unstyled(line))), paint)}`;

// What a row is coloured with (0.0.1, ADR 0027): nothing, sixteen colours, or a PAINT at the terminal's depth on the
// row's BAND -- a header, the tabs, a card of checks, the footer -- where the terminal may draw bands at all.
const bandOf = (ctx, r) => (ctx.state.viewer.bands ? (r.band ?? (r.card ? "card" : null)) : null);

const PAINTS = [
  { when: (v) => !v.colour, paint: () => false },
  { when: (v) => v.depth !== "256" && v.depth !== "truecolor", paint: () => true },
  { when: () => true, paint: (v, band) => ({ depth: v.depth, band }) },
];

const paintOf = (ctx, r) => ((v) => PAINTS.find((p) => p.when(v)).paint(v, bandOf(ctx, r)))(ctx.state.viewer);

function rightOf(ctx, r, paint) {
  const segs = ctx.tier.right || r.always ? glyphed(ctx, r.right ?? []) : [];
  const want = displayWidth(segs.map((s) => s.text).join(""));
  return segs.length ? drawn(segs, Math.min(want, Math.floor(ctx.width * (r.rightShare ?? RIGHT_SHARE))), paint) : "";
}

// The cut a row gets when it is too long ends in `…`, added after the glyphs were swapped: in ASCII it is a dot.
const asciiCut = (ctx, line) => (ctx.state.viewer.ascii ? line.replace(/…/g, ".") : line);

function rendered(ctx, r) {
  const paint = paintOf(ctx, r);
  const right = asciiCut(ctx, rightOf(ctx, r, paint));
  const room = ctx.width - displayWidth(unstyled(right)) - (right ? 1 : 0);
  const left = asciiCut(ctx, drawn(glyphed(ctx, [...labelSegs(ctx, r), ...shown(ctx, r)]), room, paint));
  return right ? `${padded(left, room, paint)}${blankOn(1, paint)}${right}` : padded(left, ctx.width, paint);
}

// Two rows side by side (0.0.2, the pane's wide tier): each drawn at its own column's width, one cell between them.
const columnCtx = (ctx, width) => ({ ...ctx, width: Math.max(1, width), tier: { ...ctx.tier, right: true } });

const sideBySide = (ctx, r) => `${rendered(columnCtx(ctx, r.split), r.columns[0])}${blankOn(1, paintOf(ctx, r))}${rendered(columnCtx(ctx, ctx.width - r.split - 1), r.columns[1])}`;

const renderedRow = (ctx, r) => (r.columns ? sideBySide : rendered)(ctx, r);

const blank = () => row([]);
const rule = (ctx, ch) => row([dim(ch.repeat(ctx.width))]);

// ---- scrolling windows ----------------------------------------------------------------------------------

const textOf = (r) => [...r.left, ...(r.right ?? [])].map((s) => s.text).join("").toLowerCase();

const matchesOf = (rows, query) => (query ? rows.map((r, i) => (textOf(r).includes(query.toLowerCase()) ? i : -1)).filter((i) => i >= 0) : []);

const mod = (n, m) => ((n % m) + m) % m;

// Where a window starts: at the current search match when a search jumped, else by the list's own scroll --
// RECENT counts from its top (newest), SANDBOX from its bottom (newest).
function startOf(ctx, s, rows, room, matches) {
  const max = Math.max(0, rows.length - room);
  const search = ctx.state.viewer.search;
  const jumped = search.jump && matches.length && ctx.state.viewer.focus === s.scroll;
  const target = jumped ? matches[mod(search.at, matches.length)] - Math.floor(room / 2) : s.scroll === "recent" ? ctx.state.viewer.scroll.recent : max - ctx.state.viewer.scroll.sandbox;
  return Math.max(0, Math.min(max, target));
}

function windowed(ctx, s, room) {
  const matches = ctx.state.viewer.focus === s.scroll ? matchesOf(s.rows, ctx.state.viewer.search.query) : [];
  const start = startOf(ctx, s, s.rows, room, matches);
  const current = matches.length ? matches[mod(ctx.state.viewer.search.at, matches.length)] : -1;
  return s.rows.slice(start, start + room).map((r, i) => ({ ...r, match: matches.includes(start + i), current: start + i === current && ctx.state.viewer.search.jump }));
}

const extentOf = (s, room) => ({ max: Math.max(0, s.rows.length - room), page: Math.max(1, room - 1) });

// ---- the dashboard ----------------------------------------------------------------------------------------

const labelOf = (ctx, name) => LABELS[name][ctx.tier.short ? 1 : 0];

function sectionLines(ctx, s, n) {
  const head = s.head ? [s.head] : [];
  const rows = s.rows.filter((r) => ctx.tier.detail || !r.detail);
  const items = s.scroll ? windowed(ctx, { ...s, rows }, Math.max(0, n - head.length)) : rows.slice(0, Math.max(0, n - head.length));
  return [...head, ...items].map((r, i) => ({ ...r, label: i === 0 ? labelOf(ctx, s.name) : "" }));
}

const roomOf = (s, budget) => Math.max(0, budget.rows.get(s.name) - (s.head ? 1 : 0));

function dashboard(ctx, height) {
  const sections = SECTIONS.map((f) => f(ctx)).filter(Boolean);
  const budget = budgetOf(sections, height);
  const lines = budget.sections.flatMap((s, i) => [...(i && budget.gaps ? [blank()] : []), ...sectionLines(ctx, s, budget.rows.get(s.name))]);
  const extents = Object.fromEntries(budget.sections.filter((s) => s.scroll).map((s) => [s.scroll, extentOf(s, roomOf(s, budget))]));
  return { lines: sections.length ? lines : [emptyRow(ctx.state.viewer)], extents };
}

// ---- an overlay ---------------------------------------------------------------------------------------

// Where an overlay's list starts: centred on the cursor when rows can be chosen, else the cursor IS the scroll.
const overlayStart = (o, room, cursor) => (o.selectable ? Math.max(0, Math.min(o.rows.length - room, cursor - Math.floor(room / 2))) : Math.max(0, Math.min(cursor, o.rows.length - room)));

const overlayExtent = (o, room) => ({ overlay: { max: o.selectable ? Math.max(0, o.rows.length - 1) : Math.max(0, o.rows.length - room), page: Math.max(1, room - 1) } });

function overlay(ctx, height) {
  const o = OVERLAYS[ctx.state.viewer.overlay](ctx.state, ctx.d, ctx.tier);
  const top = [row([seg(o.title, "label")]), ...o.lead];
  const room = Math.max(1, height - top.length - (o.after?.length ?? 0));
  const start = overlayStart(o, room, ctx.state.viewer.cursor);
  return { lines: [...top, ...o.rows.slice(start, start + room).map((r, i) => ({ ...r, selected: o.selectable && start + i === ctx.state.viewer.cursor })), ...(o.after ?? [])].map((r) => ({ ...r, label: r.label ?? "" })), extents: overlayExtent(o, room) };
}

// ---- the frame ----------------------------------------------------------------------------------------

const fill = (lines, n, ctx) => [...lines.slice(0, n), ...Array.from({ length: Math.max(0, n - lines.length) }, () => padded("", ctx.width))];

const EXTENTS = (got) => ({ recent: got.recent ?? NO_EXTENT, sandbox: got.sandbox ?? NO_EXTENT, overlay: got.overlay ?? NO_EXTENT });

// What fills the screen between the header and the footer: an overlay a person opened, the pane (1.8.6) when the
// viewer is laid out as one, else the dashboard.
const BODIES = [
  { when: (ctx) => Boolean(ctx.state.viewer.overlay), body: overlay },
  { when: (ctx) => ctx.state.viewer.layout === "pane", body: paneBody },
  { when: () => true, body: dashboard },
];

function body(ctx) {
  const height = Math.max(0, ctx.size.rows - FIXED);
  const got = BODIES.find((b) => b.when(ctx)).body(ctx, height);
  return { lines: fill(got.lines.map((r) => renderedRow(ctx, r)), height, ctx), extents: EXTENTS(got.extents) };
}

const tooSmall = (ctx) => ({ lines: fill(tooSmallRows(ctx.size).map((r) => rendered(ctx, r)), ctx.size.rows, ctx), extents: EXTENTS({}) });

// Whether the header's orbit is turning in this frame (0.0.2): a viewer that paints often asks, to draw every frame of it.
const orbitingOf = (ctx) => ctx.tier.name !== "too-small" && orbitOf(indicatorFor(ctx), { nowMs: ctx.nowMs }).moving;

export function frameOf(state, d = derivedOf(state)) {
  const ctx = contextOf(state, d);
  const got = ctx.tier.name === "too-small" ? tooSmall(ctx) : { ...body(ctx), top: [headerRow(ctx), rule(ctx, "═")], bottom: [rule(ctx, "─"), footerRow(ctx)] };
  const lines = got.top ? [...got.top.map((r) => rendered(ctx, r)), ...got.lines, ...got.bottom.map((r) => rendered(ctx, r))] : got.lines;
  return { columns: ctx.size.columns, rows: ctx.size.rows, lines: lines.slice(0, ctx.size.rows), full: Boolean(state.viewer.redraw), extents: got.extents, orbiting: orbitingOf(ctx) };
}
