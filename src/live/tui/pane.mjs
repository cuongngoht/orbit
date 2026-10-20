// THE PANE a host docks beside its session (1.8.5): the full-screen viewer's own sections, laid out for a column the
// way a person reads a docked panel -- ONE header line on top (which task, how the viewer reads it, the clock), the
// overview under it (the stage, a workflow's steps, the checks, what the change is held to, QA, the milestones, the
// notices), and what the task is doing NOW pinned at the bottom, nearest the prompt, never scrolled away: when the
// pane is short the overview gives way first, in the order the full-screen viewer lets its sections go. And the
// WORKSPACE parts (workspace.mjs): the checklist of the steps the work took, the task worked on now, a status bar and
// the views a person switches between, with the pane's own tier. Pure, like the rest of tui/: the same rows the
// terminal draws, as segments of text and a tone, so a host's drawer adds no word.
//
//   paneOf(state, d?) -> { header: [seg], headerParts: { left, badge, right },                            (0.0.2)
//                          overview: [[seg]], now: [[seg]],
//                          tier, checklist: [prow], current: [prow], statusBar: prow, views: [{ id, label, rows: [prow] }],
//                          indicator, progress: { task, tests, rows: [prow] }, plan, timeline,       (1.8.6)
//                          lifecycle: [{ label, mark, text }],                                         (1.8.9)
//                          orbit: { moving, revMs, variant, rings: [{ size, parked, frames }] } }      (0.0.3)
//     seg: { text, tone }    prow: { left: [seg], right: [seg], depth, status, label, box }   view: + hint (0.0.2)
//     state.viewer.size is the pane's: its columns pick the tier (labels, detail rows), its rows the budget
//
// What 1.8.6 adds is DATA as well as rows: the LIVE indicator (indicator.mjs), task and test progress over the
// denominators their owners recorded (progress.mjs), the plan as a graph (plan-view.mjs) and the normalized timeline
// (timeline.mjs) -- each bounded, every string in it cleaned the way a row's text is, so a drawer that shows the data
// instead of the rows never shows what a terminal would not.
import { clean } from "../render/ansi.mjs";
import { orbitTrackOf } from "../orbit.mjs";
import { derivedOf } from "./derive.mjs";
import { contextOf } from "./frame.mjs";
import { LABELS, budgetOf } from "./layout.mjs";
import { SECTIONS } from "./sections/index.mjs";
import { headerParts, headerRow } from "./sections/top.mjs";
import { checklistOf, currentRows, indicatorFor, paneTierOf, sessionShown, statusBarOf, timelineRowsWanted, viewsOf } from "./workspace.mjs";
import { lifecycleOf } from "./lifecycle-view.mjs";
import { planOf } from "./plan-view.mjs";
import { progressRows, taskProgressOf, testProgressOf } from "./progress.mjs";
import { timelineFor } from "./timeline-view.mjs";
import { PANE_TITLES } from "../words.mjs";

export const NOW_MAX = 7;

// What the overview shows of the dashboard: everything but the sandbox's console, which needs its own terminal.
const OVERVIEW = Object.freeze(["stage", "workflow", "engineer", "verify", "qa", "recent", "notices"]);

const segOf = (s) => ({ text: clean(s.text), tone: s.tone ?? null });

// A row as segments: its left cells, then -- a column apart -- its right ones; nothing that says nothing.
export const segsOf = (r) => [...r.left, ...(r.right?.length ? [{ text: "   ", tone: null }, ...r.right] : [])].map(segOf).filter((s) => s.text !== "");

const labelRow = (name) => [{ text: LABELS[name][0], tone: "label" }];

// A section's head keeps what it says and drops the full-screen viewer's key hints: a pane has none of those keys.
const rowsOf = (ctx, s, n) => [labelRow(s.name), ...[...(s.head ? [{ ...s.head, right: [] }] : []), ...s.rows.filter((r) => ctx.tier.detail || !r.detail)].slice(0, n).map(segsOf)];

function overviewOf(ctx, sections, height) {
  const budget = budgetOf(sections, Math.max(0, height - sections.length));
  return budget.sections.flatMap((s) => rowsOf(ctx, s, budget.rows.get(s.name)));
}

// The header in its three parts (0.0.2), so a docked pane can put the badge in a border and the rest on the right edge.
const partsOfHeader = (ctx) => ((h) => ({ left: h.left.map(segOf).filter(nonEmpty), badge: h.badge.filter((s) => !s.edge).map(segOf).filter(nonEmpty), right: h.rest.map(segOf).filter(nonEmpty) }))(headerParts({ ...ctx, clock: false }));

const nowOf = (all) => (all.find((s) => s.name === "activity")?.rows ?? []).slice(0, NOW_MAX).map(segsOf);

export function paneOf(state, d = derivedOf(state)) {
  const ctx = contextOf(state, d);
  const all = SECTIONS.map((f) => f(ctx)).filter(Boolean);
  const now = nowOf(all);
  return { header: segsOf(headerRow({ ...ctx, clock: false })), headerParts: partsOfHeader(ctx), overview: overviewOf(ctx, all.filter((s) => OVERVIEW.includes(s.name)), ctx.size.rows - 2 - now.length), now, ...workspaceOf(ctx) };
}

// ---- the workspace parts, bounded: a pane is asked again every few seconds --------------------------------------

export const VIEW_ROWS = 40;

const CHECKLIST_ROWS = 60;

const nonEmpty = (s) => s.text !== "";

// 0.0.2: `box` names the card a row is drawn in (the baseline's).
const prowOf = (r) => ({ left: r.left.map(segOf).filter(nonEmpty), right: r.right.map(segOf).filter(nonEmpty), depth: r.depth ?? 0, status: r.status ?? null, label: r.label ?? null, box: r.box ?? null });

function workspaceOf(ctx) {
  const tier = paneTierOf(ctx.size.columns, ctx.size.rows);
  const checklist = checklistOf(ctx);
  return { tier, titles: PANE_TITLES, checklist: checklist.slice(0, CHECKLIST_ROWS).map(prowOf), current: currentRows(ctx, tier === "narrow" || tier === "tiny").map(prowOf), statusBar: prowOf(statusBarOf(ctx, checklist)), views: viewsOf(ctx).map((v) => ({ id: v.id, label: v.label, hint: v.hint ? clean(v.hint) : null, rows: v.rows.slice(0, VIEW_ROWS).map(prowOf) })), ...inspectorsOf(ctx) };
}

// ---- 1.8.6: what the pane shows, as data -------------------------------------------------------------------------

// What changes on every ask whether or not anything happened is left out of the answer (1.8.6): the wall clock (the
// host shows its own; a docked pane's header leaves it out) and how long ago the last evidence was -- so a quiet task's
// answer is the same answer, and a drawer that skips a picture it already drew redraws nothing. The header's orbit is
// therefore parked in it (orbit.mjs): `orbit` hands the pane what turning it takes (0.0.3, ADR 0029) -- whether it turns
// at all, one revolution's length and, for each of the header's two orbits, the parked text and every frame -- and the
// pane turns both on its own clock, at one angle. It holds no time, so it is the same answer however often it is asked.
const steady = (indicator) => Object.fromEntries(Object.entries(indicator).filter(([k]) => k !== "since"));

// Every string of a value, cleaned as a row's text is; numbers, booleans and nulls as they are.
const plain = (v) => (typeof v === "string" ? clean(v) : Array.isArray(v) ? v.map(plain) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);

const inspectorsOf = (ctx) => plain({ indicator: steady(indicatorFor(ctx)), orbit: orbitTrackOf(indicatorFor(ctx), { ascii: ctx.state.viewer.ascii === true, settings: ctx.state.viewer.settings, track: true }), progress: { task: taskProgressOf(ctx), tests: testProgressOf(ctx), rows: sessionShown(ctx) ? [] : progressRows(ctx).map(prowOf) }, plan: planOf(ctx), timeline: timelineFor(ctx, timelineRowsWanted(ctx)), lifecycle: lifecycleOf(ctx) });
