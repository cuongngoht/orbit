// THE PANE in a terminal (1.8.6, ADR 0022): what a host docks beside its session, drawn by the full-screen viewer for a
// viewer opened BESIDE an AI CLI -- a tmux or Windows Terminal split, an iTerm2 pane, the VS Code companion's
// terminal -- so Codex, Antigravity and Claude Code outside its fullscreen layout show the same work the same way.
// The same parts as the docked pane (workspace.mjs, progress.mjs), stacked for a column: the tabs of the views (1 to 6)
// under the header, the work's checklist, what it does NOW, the view a person picked, task and test progress, and the
// status bar with the LIVE indicator -- on the bands of Orbit Live's look (0.0.1, ADR 0027: render/theme.mjs). Rows of
// segments, never a styled string: the frame (frame.mjs) cleans, cuts and colours them as it does a section's.
//
//   paneBody(ctx, height) -> { lines: [row], extents }
import { PANE_VIEWS } from "./model.mjs";
import { progressRows } from "./progress.mjs";
import { blank, dim, row, rule, seg } from "./sections/parts.mjs";
import { orbitRows } from "./sections/top.mjs";
import { checklistOf, currentRows, indicatorFor, paneTierOf, statusBarOf, viewOf } from "./workspace.mjs";
import { PANE_TITLES } from "../words.mjs";
import { displayWidth } from "../render/width.mjs";

const VIEW_LABELS = { events: "Events", tests: "Tests", changes: "Changes", notices: "Notices", plan: "Plan", timeline: "Timeline" };

// How many rows each block may have, by the pane's tier -- the docked pane's own budget (hooks/live-pane.tsx). Wide
// puts the checklist and NOW side by side (0.0.2), so the two share one budget.
const BUDGETS = [
  { when: (t) => t === "tiny", of: () => ({ checklist: 0, current: 0 }) },
  { when: (t) => t === "narrow", of: (t, room) => ({ checklist: 0, current: room }) },
  { when: (t) => t === "wide", of: (t, room, n) => ((top) => ({ checklist: top, current: top }))(Math.min(Math.max(n.checklist, n.current) + 2, Math.floor(room * 0.62))) },
  { when: () => true, of: (t, room, n) => ({ checklist: Math.min(n.checklist + 2, Math.floor(room * 0.6)), current: Math.min(n.current + 1, Math.floor(room * 0.15)) }) },
];

const budgetOf = (tier, room, n) => BUDGETS.find((b) => b.when(tier)).of(tier, room, n);

const plainRow = (r) => ({ ...r, label: undefined });

// ---- the tabs: each view's key and label, and what the picked view shows (0.0.2, ADR 0028) ----------------------

const TAB_GAP = 3;

const tabWidth = (id) => displayWidth(VIEW_LABELS[id]) + TAB_GAP;

const keyCells = () => PANE_VIEWS.map((id, i) => seg(`${i + 1}:`.padEnd(tabWidth(id)), "key"));

const labelCells = (picked) => PANE_VIEWS.map((id) => seg(VIEW_LABELS[id].padEnd(tabWidth(id)), id === picked ? "label" : "subtle"));

const pickedOf = (ctx) => viewOf(ctx, ctx.state.viewer.view);

const tabsWidth = () => PANE_VIEWS.reduce((n, id) => n + tabWidth(id), 0);

// The hint beside the tabs, its parts shared out over the two rows in the room the tabs leave; what does not fit is
// left out whole, never cut in a word.
const fitting = (parts, room) => parts.slice(0, [...parts.keys()].map((i) => i + 1).filter((n) => displayWidth(parts.slice(0, n).join(" · ")) <= room).at(-1) ?? 0);

function hintLines(hint, room) {
  const parts = String(hint ?? "").split(" · ").filter(Boolean);
  const first = fitting(parts, room);
  return [first.join(" · "), fitting(parts.slice(first.length), room).join(" · ")];
}

// The hint's room on a tab row is what the tabs leave of the width.
const hintRoom = (ctx, width) => Math.max(0, ctx.width - width - 1);

const tabRow = (cells, hint, ctx, width = tabsWidth()) => row(cells, [dim(hint)], { band: "tabs", rightShare: hintRoom(ctx, width) / ctx.width });

const stackedTabs = (ctx) => ((h) => [tabRow(keyCells(), h[0], ctx), tabRow(labelCells(pickedOf(ctx).id), h[1], ctx)])(hintLines(pickedOf(ctx).hint, hintRoom(ctx, tabsWidth())));

// One row where the six fit with the widest hint a view says beside them (`1: Events  2: Tests …`).
const INLINE_GAP = "  ";

// The widest hint a view says -- the Events view's four parts (events-view.mjs) -- and a cell before it.
const HINT_ROOM = 48;

const inlineCells = (picked) => PANE_VIEWS.flatMap((id, i) => [seg(`${i + 1}:`, "key"), seg(` ${VIEW_LABELS[id]}`, id === picked ? "label" : "subtle"), seg(INLINE_GAP)]);

const inlineWidth = () => PANE_VIEWS.reduce((n, id, i) => n + displayWidth(`${i + 1}: ${VIEW_LABELS[id]}${INLINE_GAP}`), 0);

const inlineTabs = (ctx) => [tabRow(inlineCells(pickedOf(ctx).id), fitting(String(pickedOf(ctx).hint ?? "").split(" · ").filter(Boolean), hintRoom(ctx, inlineWidth())).join(" · "), ctx, inlineWidth())];

// Two rows of three where neither fits (0.0.3, a pane of 40 to 55 columns): each key before its label, the columns
// lined up, so no label is ever cut -- `6: Timeline` was, at 44.
const HALVES = Object.freeze([PANE_VIEWS.slice(0, 3), PANE_VIEWS.slice(3)]);

const keyOf = (id) => `${PANE_VIEWS.indexOf(id) + 1}:`;

const columnWidth = (col) => Math.max(...HALVES.map((ids) => (ids[col] ? displayWidth(`${keyOf(ids[col])} ${VIEW_LABELS[ids[col]]}`) : 0)));

const pairedCells = (ids, picked) => ids.flatMap((id, col) => [seg(keyOf(id), "key"), seg(` ${VIEW_LABELS[id]}`.padEnd(columnWidth(col) - keyOf(id).length), id === picked ? "label" : "subtle"), seg(INLINE_GAP)]);

const pairedWidth = () => HALVES[0].reduce((n, _, col) => n + columnWidth(col) + INLINE_GAP.length, 0);

const pairedTabs = (ctx) => ((h) => HALVES.map((ids, i) => tabRow(pairedCells(ids, pickedOf(ctx).id), h[i], ctx, pairedWidth())))(hintLines(pickedOf(ctx).hint, hintRoom(ctx, pairedWidth())));

// How the tabs are laid out, the first row that holds: one row where it all fits; each key over its label with the hint
// over the two rows beside them, as Orbit Live's look draws them beside an AI CLI; two rows of three in a narrow pane;
// else each key over its label, cut.
const TABS = Object.freeze([
  { when: (ctx) => inlineWidth() + HINT_ROOM <= ctx.width, rows: inlineTabs },
  { when: (ctx) => tabsWidth() < ctx.width, rows: stackedTabs },
  { when: (ctx) => pairedWidth() <= ctx.width, rows: pairedTabs },
  { when: () => true, rows: stackedTabs },
]);

const tabsRows = (ctx) => TABS.find((t) => t.when(ctx)).rows(ctx);

// ---- TASK EXECUTION and NOW -------------------------------------------------------------------------------------

// A card's border round the rows that share its `box` (0.0.2): its corners, its sides beside every row, its status
// words kept inside the right side.
const edge = (width, l, r) => row([dim(`${l}${"─".repeat(Math.max(0, width - 2))}${r}`)]);

const inCard = (r) => ({ ...r, left: [dim("│ "), ...r.left], right: [...r.right, dim(r.right.length ? " │" : "│")], rightShare: 0.6 });

// Inside its border a card starts at its own head's depth: the border is the indent.
const outdented = (r, base) => ({ ...r, left: r.left.map((s, i) => (i === 0 && /^ *$/.test(s.text) ? { ...s, text: "  ".repeat(Math.max(0, (r.depth ?? 0) - base)) } : s)) });

const cardOf = (rows, width) => [edge(width, "╭", "╮"), ...rows.map((r) => inCard(outdented(r, rows[0].depth ?? 0))), edge(width, "╰", "╯")];

// Consecutive rows of one card become one group; every other row stands alone.
const grouped = (out, r) => (r.box && out.at(-1)?.box === r.box ? [...out.slice(0, -1), { box: r.box, rows: [...out.at(-1).rows, r] }] : [...out, r.box ? { box: r.box, rows: [r] } : { rows: null, row: r }]);

const carded = (rows, width) => rows.reduce(grouped, []).flatMap((x) => (x.rows ? cardOf(x.rows.map(plainRow), width) : [plainRow(x.row)]));

const nowTitle = () => [seg(PANE_TITLES.current, "success")];

// Medium and below: the checklist under its title, NOW said on the title's right; NOW's own rows under it.
const stacked = (ctx, p, b) => [...(b.checklist > 0 ? [row([seg(PANE_TITLES.checklist, "title")], nowTitle()), rule(ctx.width), ...carded(p.checklist, ctx.width).slice(0, b.checklist - 2)] : []), ...(b.current > 0 ? [rule(ctx.width), ...p.current.slice(0, b.current - 1).map(plainRow)] : [])];

// Wide: two columns -- the checklist on the left, NOW on the right -- each row drawn at its column's width by the frame.
const SPLIT = 0.6;

const pair = (left, right, split) => ({ columns: [left ?? row([]), right ?? row([])], split });

function sideBySide(ctx, p, b) {
  const split = Math.floor(ctx.width * SPLIT);
  const left = carded(p.checklist, split);
  const pairs = Array.from({ length: Math.min(b.checklist - 2, Math.max(left.length, p.current.length)) }, (_, i) => pair(left[i], p.current[i] && plainRow(p.current[i]), split));
  return [pair(row([seg(PANE_TITLES.checklist, "title")]), row([], nowTitle()), split), rule(ctx.width), ...pairs];
}

const LAYOUTS = { wide: sideBySide };

const topOf = (ctx, tier, p, b) => (LAYOUTS[tier] ?? stacked)(ctx, p, b);

// Every view puts what matters most on top -- Events, Tests and the Timeline are newest on top, the Timeline's
// revisions first -- so a view cut to its room keeps its top rows, as a docked pane does.
const fitted = (view, n) => view.rows.slice(0, n).map(plainRow);

const viewLines = (ctx, n) => (n > 0 ? [rule(ctx.width), ...fitted(pickedOf(ctx), n - 1)] : []);

// ---- a viewer with no task to show (0.0.3) --------------------------------------------------------------------------
// In either layout: the orbit, expanded, in the middle of the body where it has the room -- turning while the viewer
// waits, so the viewer is plainly alive -- over what it waits for: this session's task, or a person's pick. The words
// are wrapped at a word, never cut, and centred with the orbit; nothing here says the task moved.

const sentenceOf = (viewer) => (viewer.waiting ? "waiting for this session's task: /orbit or /orbit-help starts or picks one up · t shows another" : "no task is shown: press t to pick one");

const widthOf = (segs) => displayWidth(segs.map((s) => s.text).join(""));

const centred = (ctx, segs) => [seg(" ".repeat(Math.max(0, Math.floor((ctx.width - widthOf(segs)) / 2)))), ...segs];

const wrappedOnto = (lines, word, width) => (lines.length && displayWidth(`${lines.at(-1)} ${word}`) <= width ? [...lines.slice(0, -1), `${lines.at(-1)} ${word}`] : [...lines, word]);

const wrapped = (text, width) => text.split(" ").reduce((lines, word) => wrappedOnto(lines, word, width), []);

const sentenceRows = (ctx) => wrapped(sentenceOf(ctx.state.viewer), Math.max(10, ctx.width - 2)).map((line) => row(centred(ctx, [dim(line)])));

// The expanded orbit's rows, each saying it holds an orbit (tui/regions.mjs ORBIT_PARTS), so the terminal turns them.
export const expandedOrbitRows = (ctx) => orbitRows(ctx, indicatorFor(ctx), "expanded").map((segs, k) => row(centred(ctx, segs), [], { orbit: { part: "expanded", k } }));

const ORBIT_ROOM = 8;

const blanks = (n) => Array.from({ length: Math.max(0, n) }, blank);

const withOrbit = (ctx, height) => ((words) => [...blanks(Math.floor((height - 4 - words.length) / 2)), ...expandedOrbitRows(ctx), blank(), ...words])(sentenceRows(ctx));

const EMPTY = Object.freeze([
  { when: (ctx, height) => height >= ORBIT_ROOM, rows: withOrbit },
  { when: () => true, rows: (ctx) => sentenceRows(ctx) },
]);

export const emptyRows = (ctx, height) => EMPTY.find((e) => e.when(ctx, height)).rows(ctx, height);

export const paneBody = (ctx, height) => (ctx.d.root?.view || ctx.d.focus?.view ? paneOf(ctx, height) : { lines: emptyRows(ctx, height), extents: {} });

// ---- the bottom edge: progress, then the status bar spread across the width ----------------------------------------

const SEP = "·";

const partsOfBar = (r) => [...r.left.filter((s) => s.text.trim() !== SEP), ...r.right];

const gapSeg = (g) => dim(`${" ".repeat(Math.floor((g - 1) / 2))}${SEP}${" ".repeat(Math.ceil((g - 1) / 2))}`);

const gapOf = (width, parts) => Math.floor((width - displayWidth(parts.map((s) => s.text).join(""))) / Math.max(1, parts.length - 1));

// The counts, the lifecycle and the indicator, a dot between each and the room shared out between them (0.0.2); where
// there is too little room for that, the bar as it is.
const spread = (ctx, r) => ((parts, g) => (g < 5 ? r : row(parts.flatMap((p, i) => (i ? [gapSeg(g), p] : [p])), [], { always: true })))(partsOfBar(r), gapOf(ctx.width, partsOfBar(r)));

// The progress lines and the status bar keep the bottom edge, nearest the prompt beside it; the status bar's right
// side -- the LIVE indicator -- is drawn at every width.
const bottomOf = (ctx) => [...progressRows(ctx).map((r) => ({ ...plainRow(r), band: "footer" })), { ...plainRow(spread(ctx, statusBarOf(ctx))), always: true, band: "footer" }];

const pinned = (body, bottom, height) => [...body.slice(0, Math.max(0, height - bottom.length)), ...Array.from({ length: Math.max(0, height - bottom.length - body.length) }, () => row([])), ...bottom];

// The tabs head the column (0.0.1, as Orbit Live's look draws them) wherever a view has a row left under them.
const partsOf = (ctx, tier, height) => ((bottom) => ({ bottom, tabs: height - bottom.length > 2 ? tabsRows(ctx) : [], checklist: checklistOf(ctx), current: currentRows(ctx, tier === "narrow" || tier === "tiny") }))(bottomOf(ctx));

// A pane's every row keeps its right side -- a status word, a step's detail -- at every width (0.0.2).
const drawnWhole = (r) => (r.columns ? { ...r, columns: r.columns.map(drawnWhole) } : { ...r, always: true });

function paneOf(ctx, height) {
  const tier = paneTierOf(ctx.size.columns, ctx.size.rows);
  const parts = partsOf(ctx, tier, height);
  const b = budgetOf(tier, Math.max(0, height - parts.bottom.length - parts.tabs.length), { checklist: parts.checklist.length + 2, current: parts.current.length });
  const top = [...parts.tabs, ...topOf(ctx, tier, parts, b)];
  return { lines: pinned([...top, ...viewLines(ctx, height - top.length - parts.bottom.length)], parts.bottom, height).map(drawnWhole), extents: {} };
}
