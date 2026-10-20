// The HEADER (where the viewer stands, which task, the viewer's own state), the STAGE section (what the task
// shown is doing, in the journal's words) and the FOOTER (the keys this layer has). Every word is a field of
// a task's view, a journal line, or the viewer's own state, said as such.
import { activityOf, attemptOf, failureLine } from "../../render/compact.mjs";
import { orbitOf } from "../../orbit.mjs";
import { LIFECYCLE_WORDS, PRESENTATION_WORDS } from "../../words.mjs";
import { isCoordinator } from "../model.mjs";
import { layerOf } from "../keys.mjs";
import { indicatorFor } from "../workspace.mjs";
import { ABSENT, between, dim, joined, row, seg, since, str } from "./parts.mjs";

// ---- header ---------------------------------------------------------------------------------------------
// 0.0.1 (ADR 0027): the orbit and the ORBIT LIVE chip, where the viewer stands and which task -- then, on the right,
// the indicator as a pill (indicator.mjs, the one table ADR 0022 names: the header and the status bar never disagree)
// and what the task is, where it runs and how old it is. No wall clock: a viewer's own clock is not evidence.

const placeWords = (place) => (place ? `${place.project ?? place.key} → ${place.branch ?? `checkout ${place.checkoutId.slice(0, 8)}`}` : "no checkout");

const roleWord = (ctx) => (ctx.state.focus === "child" ? "engineering task" : isCoordinator(ctx.d.root?.view) ? "workflow" : null);

// How old the task is. A docked pane's header (no clock, 1.8.6) says how long a FINISHED task took instead: a number
// that no longer moves, so a quiet task's answer is the same answer however often a pane asks.
const ageOf = (ctx, v) => (ctx.clock === false && v?.ended?.at ? between(v.task?.createdAt, v.ended.at, ctx.nowMs) : since(v?.task?.createdAt, ctx.nowMs));

// No task, and the host's hooks observed this session's tools at work (1.8.7, src/live/session.mjs).
const sessionWorks = (a) => Boolean(a) && (a.observed > 0 || a.running?.length > 0);

const taskId = (ctx, snap) => snap?.view?.task?.id ?? ctx.state.root ?? null;

// 0.0.2: beside an AI CLI the task's id is NOW's first line, so the pane's header names only where the viewer stands;
// the dashboard, where `c` moves between a workflow and its engineering task, keeps naming which one it shows.
const idWords = (ctx, snap) => (ctx.state.viewer.layout === "pane" ? [] : [dim(taskId(ctx, snap))]);

const whoWords = (ctx, snap) => (taskId(ctx, snap) ? idWords(ctx, snap) : [dim(sessionWorks(ctx.state.session) ? "no task · this session's activity" : "no task selected")]);

function taskWords(ctx, snap) {
  const v = snap?.view;
  return taskId(ctx, snap) ? joined([roleWord(ctx) ? dim(roleWord(ctx)) : str(v?.task?.provider) && dim(v.task.provider), ageOf(ctx, v) && dim(ageOf(ctx, v))]) : [];
}

const held = (ctx) => ctx.state.viewer.frozen || ctx.state.viewer.hold.recent !== null || ctx.state.viewer.hold.sandbox !== null;

// The orbit turns on the view's clock only while the indicator is ACTIVE (orbit.mjs); a docked pane's header has no
// clock, so it is parked there and the pane turns it itself.
const orbitSeg = (ctx, i) => ((o) => seg(o.text, o.tone))(orbitOf(i, { ascii: ctx.state.viewer.ascii === true, nowMs: ctx.clock === false ? null : ctx.nowMs }));

// The pill (0.0.2, ADR 0028): a badge holding the orbit, a dot in the indicator's tone and its word -- ORBITING's word
// in the brand's. A terminal draws it on a chip; a docked pane draws a border round it (`pill` on the row).
const PILL_WORD_TONE = Object.freeze({ ACTIVE: "chip" });

// While the task moves the orbit is the motion, so the dot stands still; any other state keeps its own glyph.
const PILL_GLYPH = Object.freeze({ ACTIVE: "●" });

const pillSegs = (ctx, i) => [seg(" ", `pill:${i.tone}`), { ...orbitSeg(ctx, i), pill: true }, seg(` ${PILL_GLYPH[i.state] ?? i.glyph} `, `pill:${i.tone}`), seg(`${i.word} `, PILL_WORD_TONE[i.state] ?? `pill:${i.tone}`)];

// The header's three parts (0.0.2): where the viewer stands, the badge, and what the task is and how old -- a docked
// pane lays them out itself, a terminal as one row.
export function headerParts(ctx) {
  const i = indicatorFor(ctx);
  const left = [orbitSeg(ctx, i), seg(" "), seg(" ORBIT LIVE ", "chip"), seg("  "), dim(placeWords(ctx.state.place)), seg("  "), ...whoWords(ctx, ctx.d.focus)];
  return { left, badge: [held(ctx) ? seg("FROZEN  ", "warning") : null, ...pillSegs(ctx, i)].filter(Boolean), rest: taskWords(ctx, ctx.d.focus) };
}

export const headerRow = (ctx) => ((h) => row(h.left, [...h.badge, seg("  "), ...h.rest], { always: true, band: "header", rightShare: 0.55 }))(headerParts(ctx));

// ---- STAGE ------------------------------------------------------------------------------------------------

const lifecycleSeg = (v) => ((w) => seg(w?.word ?? v.lifecycle ?? ABSENT.unrecorded, w?.tone ?? "info"))(LIFECYCLE_WORDS[v.lifecycle]);

const stageAt = (snap) => snap.events.filter((e) => e.source === "task" && e.kind === "stage").at(-1)?.at ?? null;

const causeOf = (v) => v.attempts?.find((a) => a.id === v.attempt?.current)?.cause ?? null;

function firstLine(ctx, snap) {
  const v = snap.view;
  const inStage = since(stageAt(snap), ctx.nowMs);
  return joined([lifecycleSeg(v), seg(v.stage ?? ABSENT.unrecorded, "label"), inStage && dim(`${inStage} in this stage`), attemptOf(v) && seg(`attempt ${attemptOf(v)}`), str(causeOf(v)) && dim(causeOf(v))]);
}

function stageRows(ctx, snap) {
  if (!snap.view) return [row([dim(PRESENTATION_WORDS[snap.presentation.state].say)])];
  const activity = activityOf(snap);
  const failure = failureLine(snap);
  return [row(firstLine(ctx, snap)), activity && row([seg(activity, "info")]), failure && row([seg(failure, "danger")])].filter(Boolean);
}

export const stageSection = (ctx) => (ctx.d.focus ? { name: "stage", rows: stageRows(ctx, ctx.d.focus) } : null);

// ---- footer -----------------------------------------------------------------------------------------------

const NORMAL_KEYS = (ctx) => ["q leave", "i activity", "t tasks", ctx.d.childId ? (ctx.state.focus === "child" ? "c workflow" : "c engineering task") : null, ctx.state.console.open ? "l hide · s out/err · tab scroll" : "l sandbox", "/ search", held(ctx) ? "space follow" : "space freeze", "a lines", "e evidence", "? keys"];

const FOOTERS = {
  normal: (ctx) => NORMAL_KEYS(ctx).filter(Boolean).join(" · "),
  search: (ctx) => `/${ctx.state.viewer.search.query}▏   enter keep · esc clear · ↑↓ previous/next match`,
  overlay: () => "↑↓ move · enter open · esc or q close · ctrl+c leave",
  help: () => "any key closes this list",
};

export function footerRow(ctx) {
  const v = ctx.state.viewer;
  const lead = held(ctx) ? [seg("FROZEN — the task keeps running · ", "warning")] : [];
  const message = v.message ? [seg(`${v.message}   `, "warning")] : [];
  return row([seg(" "), ...message, ...lead, dim(FOOTERS[layerOf(v)](ctx))]);
}
