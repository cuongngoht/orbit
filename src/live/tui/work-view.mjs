// THE WORK A SESSION TRACKS, in a pane (1.8.8): the rows a viewer draws above the raw tool list, from the ONE view a
// tracked work has (`workViewOf`, src/work/track/view.mjs -- handed in as data by the composition root, so the live core
// imports no work). Every row says what stands behind it: the lifecycle word is where the work STANDS, the evidence level
// says whether anything beyond the host's own word agrees, files are the paths an edit tool was seen writing (a path another
// session also wrote is flagged `shared`), and a check is a command named like one, with how it ended and whether a later
// edit has superseded it. No row is a percentage, and a row with nothing to say is not drawn. Pure.
//
//   workOf(ctx) -> view | null
//   workNowRows(ctx, narrow) -> [row]      WORK · ref · mode · state · files · checks · blocker · note
import { dim, joined, labelled, row, seg } from "./sections/parts.mjs";

export const WORK_NOW_ITEMS = 3;

export const workOf = (ctx) => ctx.state.work ?? null;

const listed = (items, n) => `${items.slice(0, n).join(", ")}${items.length > n ? ` +${items.length - n} more` : ""}`;

const fileWords = (f) => `${f.path}${f.attribution === "shared" ? " (shared)" : ""}`;

const checkWords = (c) => `${c.what} · ${c.result}${c.current ? "" : " · superseded by a later edit"}`;

const routeWords = (w) => (w.route?.to ? ` · routed to ${w.route.to}` : "");

const blockerOf = (w) => (["BLOCKED", "WAITING", "PAUSED"].includes(w.lifecycle?.state) ? w.lifecycle.why : null);

const stateSegs = (w) => joined([seg(`${w.lifecycle.glyph} ${w.lifecycle.word}`, w.lifecycle.tone), seg(`evidence ${w.evidence.level}`, w.evidence.level === "verified" ? "success" : undefined), dim(`session ${String(w.liveness ?? "NONE").toLowerCase()}`)]);

const filesSegs = (w) => (w.activity.files.length ? [seg(`${w.activity.files.length} observed`), dim(` · ${listed(w.activity.files.map(fileWords), WORK_NOW_ITEMS)}`)] : null);

const checksSegs = (w) => (w.activity.checks.length ? [seg(listed(w.activity.checks.map(checkWords), 2))] : null);

const FIELDS = [
  { label: "WORK", narrow: true, segs: (w) => [seg(w.work, "label"), dim(w.title ? ` · ${w.title}` : "")] },
  { label: "ref", narrow: false, segs: (w) => (w.ref ? [seg(w.ref)] : null) },
  { label: "mode", narrow: false, segs: (w) => [seg(w.mode), dim(routeWords(w))] },
  { label: "state", narrow: true, segs: stateSegs },
  { label: "files", narrow: false, segs: filesSegs },
  { label: "checks", narrow: false, segs: checksSegs },
  { label: "blocker", narrow: true, segs: (w) => (blockerOf(w) ? [seg(blockerOf(w), "warning")] : null) },
  { label: "note", narrow: false, segs: (w) => (w.warnings?.length ? [dim(w.warnings[0])] : null) },
];

export function workNowRows(ctx, narrow = false) {
  const w = workOf(ctx);
  if (!w) return [];
  return FIELDS.filter((f) => !narrow || f.narrow).map((f) => ({ f, segs: f.segs(w) })).filter((x) => x.segs?.length).map((x) => labelled(x.f.label, x.segs));
}
