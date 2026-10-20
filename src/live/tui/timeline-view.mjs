// The TIMELINE a pane shows (1.8.6, ADR 0022): the normalized events of the task -- and, for a coordinated workflow,
// of the engineering task it started -- each with its time, where it comes from and how far it can be trusted
// (observed, reported, inferred), and, for a case that failed, what it expected and what it got.
//
//   timelineFor(ctx, limit) -> [event]        the data (src/live/timeline.mjs), bounded, in time order, newest last
//   timelineRows(ctx, limit) -> [row]         the Timeline view: the plan's revisions first, then newest on top
import { replansOf } from "../plan.mjs";
import { timelineOf } from "../timeline.mjs";
import { PROVENANCE_WORDS } from "../words.mjs";
import { chosen } from "./sections/activity.mjs";
import { clock, dim, row, seg } from "./sections/parts.mjs";

const sourceOf = (snap) => (snap?.view ? { task: snap.view.task?.id ?? null, events: snap.events ?? [], observations: snap.observations ?? {} } : null);

const rootOf = (ctx) => ctx.d.root ?? chosen(ctx);

export const timelineFor = (ctx, limit) => ((root) => timelineOf({ sources: [sourceOf(root), ctx.d.child !== root ? sourceOf(ctx.d.child) : null].filter(Boolean), replans: replansOf(root?.plan, root?.view), plan: root?.plan ?? null, view: root?.view ?? null, limit }))(rootOf(ctx));

const TONES = { failed: "danger", violated: "danger", FAILED: "danger", aborted: "warning", blocked: "warning", completed: "success", succeeded: "success", satisfied: "success", SUCCEEDED: "success" };

const eventRow = (e) => row([dim(`${clock(e.at)} `), seg(`${PROVENANCE_WORDS[e.provenance]?.word.padEnd(9) ?? "observed "}`, PROVENANCE_WORDS[e.provenance]?.tone ?? "subtle"), seg(e.title)], e.status ? [seg(String(e.status), TONES[e.status] ?? "subtle")] : []);

const valuesRow = (e) => (e.expected || e.actual ? [row([dim("           expected "), seg(e.expected ?? "?"), dim("  actual "), seg(e.actual ?? "?", "danger")], [], { depth: 1 })] : []);

// The VIEW reads like every other view a pane clips from the top (Events and Tests are newest on top): a plan's
// revisions first -- never scrolled out (ADR 0022) -- then the rest newest on top. The data (`timelineFor`) stays in
// time order, newest last.
const isRevision = (e) => e.type === "plan.revised";

const viewOrder = (events) => [...events.filter(isRevision).reverse(), ...events.filter((e) => !isRevision(e)).reverse()];

export const timelineRows = (ctx, limit) => ((events) => (events.length ? viewOrder(events).flatMap((e) => [eventRow(e), ...valuesRow(e)]) : [row([dim("nothing recorded yet")])]))(timelineFor(ctx, limit));
