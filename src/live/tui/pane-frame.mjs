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
import { dim, row, seg } from "./sections/parts.mjs";
import { checklistOf, currentRows, paneTierOf, statusBarOf, viewOf } from "./workspace.mjs";
import { PANE_TITLES } from "../words.mjs";
import { displayWidth } from "../render/width.mjs";

const VIEW_LABELS = { events: "Events", tests: "Tests", changes: "Changes", notices: "Notices", plan: "Plan", timeline: "Timeline" };

// How many rows each block may have, by the pane's tier -- the docked pane's own budget (hooks/live-pane.tsx).
const BUDGETS = [
  { when: (t) => t === "tiny", of: () => ({ checklist: 0, current: 0 }) },
  { when: (t) => t === "narrow", of: (t, room) => ({ checklist: 0, current: room }) },
  { when: () => true, of: (t, room, n) => ({ checklist: Math.min(n.checklist + 1, Math.floor(room * 0.4)), current: Math.min(n.current + 1, Math.floor(room * 0.3)) }) },
];

const budgetOf = (tier, room, n) => BUDGETS.find((b) => b.when(tier)).of(tier, room, n);

const plainRow = (r) => ({ ...r, label: undefined });

// A block's title in the brand's tone, and a rule to the row's end.
const titleRow = (ctx, title) => row([seg(title, "title"), dim(` ${"─".repeat(Math.max(0, ctx.width - displayWidth(title) - 1))}`)]);

const titled = (ctx, title, rows, n) => (n > 0 ? [titleRow(ctx, title), ...rows.slice(0, n - 1).map(plainRow)] : []);

// A tab: its key in the brand's tone and its label quiet, or -- the one picked -- the two on a chip.
const tabSegs = (id, i, picked) => (id === picked ? [seg(` ${i + 1} ${VIEW_LABELS[id]} `, "selected")] : [seg(` ${i + 1}`, "key"), seg(` ${VIEW_LABELS[id]} `, "subtle")]);

const tabsRow = (picked) => row(PANE_VIEWS.flatMap((id, i) => [...tabSegs(id, i, picked), seg(" ")]), [], { band: "tabs" });

// Every view puts what matters most on top -- Events, Tests and the Timeline are newest on top, the Timeline's
// revisions first -- so a view cut to its room keeps its top rows, as a docked pane does.
const fitted = (view, n) => view.rows.slice(0, n).map(plainRow);

const viewLines = (ctx, n) => (n > 0 ? fitted(viewOf(ctx, ctx.state.viewer.view), n) : []);

// What a viewer with no task to show says, in either layout: waiting for this session's, or how to pick one.
export const emptyRow = (viewer) => row([dim(viewer.waiting ? "waiting for this session's task: /orbit or /orbit-help starts or picks one up · t shows another" : "no task is shown: press t to pick one")], [], { label: "" });

export const paneBody = (ctx, height) => (ctx.d.root?.view || ctx.d.focus?.view ? paneOf(ctx, height) : { lines: [emptyRow(ctx.state.viewer)], extents: {} });

// The progress lines and the status bar keep the bottom edge, nearest the prompt beside it; the status bar's right
// side -- the LIVE indicator -- is drawn at every width.
const bottomOf = (ctx) => [...progressRows(ctx).map((r) => ({ ...plainRow(r), band: "footer" })), { ...plainRow(statusBarOf(ctx)), always: true, band: "footer" }];

const pinned = (body, bottom, height) => [...body.slice(0, Math.max(0, height - bottom.length)), ...Array.from({ length: Math.max(0, height - bottom.length - body.length) }, () => row([])), ...bottom];

// The tabs head the column (0.0.1, as Orbit Live's look draws them) wherever a view has a row left under them.
const partsOf = (ctx, tier, height) => ((bottom) => ({ bottom, tabs: height - bottom.length > 1 ? [tabsRow(ctx.state.viewer.view)] : [], checklist: checklistOf(ctx), current: currentRows(ctx, tier === "narrow" || tier === "tiny") }))(bottomOf(ctx));

function paneOf(ctx, height) {
  const tier = paneTierOf(ctx.size.columns, ctx.size.rows);
  const parts = partsOf(ctx, tier, height);
  const b = budgetOf(tier, Math.max(0, height - parts.bottom.length - parts.tabs.length), { checklist: parts.checklist.length, current: parts.current.length });
  const top = [...parts.tabs, ...titled(ctx, PANE_TITLES.checklist, parts.checklist, b.checklist), ...titled(ctx, PANE_TITLES.current, parts.current, b.current)];
  return { lines: pinned([...top, ...viewLines(ctx, height - top.length - parts.bottom.length)], parts.bottom, height), extents: {} };
}
