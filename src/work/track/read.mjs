// READING A WORK: the one assembly of its view, for the terminal, Orbit Live and Orbit Control alike (1.8.8).
//
// It joins what the work's journal says with what its owners say, on every read and without keeping any of it:
// each bound session's working-set tail (inside the intervals the work was bound to that session -- observe.mjs), the
// linked tasks' own views, and the other sessions' edits (to flag a shared path). The composition roots hand every
// effect in as a port, so this imports no task, no live core and no host:
//
//   ctx.works          the work store
//   ctx.checkout       the checkout id · ctx.host the host the viewer runs under, when it knows
//   ctx.nowMs · ctx.idleAfterMs
//   ctx.workingSet     { source, tail(mark) -> { text, cut, partial } | null, sessions() -> [mark] newest first }
//                      `source` is the working set's own word (src/live/session.mjs SOURCES): why there may be nothing
//   ctx.activity       { linesOf, activityOf, checks }  src/live/session.mjs, handed in by the root
//   ctx.taskView(id)   a task's view (src/task/views.mjs) or null -- the owner's, read back, never copied
// A port that throws is a part that is unreadable, and never a reason for the view to fail.
import { Refused } from "../../errors.mjs";
import { coverageOf } from "./coverage.mjs";
import { sessionsOf, trackOf } from "./fold.mjs";
import { contestedBy, intervalsOf, lastEditAt, windowed } from "./observe.mjs";
import { scanOf, timelineOf } from "./resolve.mjs";
import { workViewOf } from "./view.mjs";

const MAX_OTHERS = 16;

const quietly = (fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};

const hostOf = (fold, mark) => fold.bindings.filter((b) => b.session === mark).at(-1)?.host ?? null;

const windowOf = (ctx, tail, intervals) => (tail ? windowed(ctx.activity.linesOf(tail.text, tail.cut), intervals) : null);

// One bound session's lines, inside the intervals the work was bound to it.
function sliceOf(ctx, scan, id, fold, mark) {
  const tail = quietly(() => ctx.workingSet.tail(mark));
  const intervals = intervalsOf(timelineOf(scan, mark), id);
  return { session: mark, host: hostOf(fold, mark), lines: windowOf(ctx, tail, intervals), partial: tail?.partial === true };
}

const activityOf = (ctx, slice) => (slice.lines === null ? null : ctx.activity.activityOf(slice.lines, { nowMs: ctx.nowMs, idleAfterMs: ctx.idleAfterMs, checks: ctx.activity.checks, partial: slice.partial, source: "ok" }));

const newestOf = (times) => times.filter(Boolean).sort().at(-1) ?? null;

const othersOf = (ctx, mine) => (quietly(() => ctx.workingSet.sessions()) ?? []).filter((m) => !mine.includes(m)).slice(0, MAX_OTHERS).map((session) => ({ session, tail: quietly(() => ctx.workingSet.tail(session)) })).filter((o) => o.tail).map((o) => ({ session: o.session, lines: ctx.activity.linesOf(o.tail.text, o.tail.cut) }));

// Other sessions are read only to flag a shared path, so only when this work has an edit to flag.
const edited = (slices) => slices.some((s) => s.lines !== null && lastEditAt(s.lines) !== null);

const contestedIn = (ctx, slices, fold) => (edited(slices) ? contestedBy(othersOf(ctx, slices.map((s) => s.session)), startedAt(fold)) : new Set());

const startedAt = (fold) => fold.bindings[0]?.at ?? fold.meta?.at ?? null;

const tasksOf = (ctx, fold) => Object.fromEntries(fold.links.filter((l) => l.what !== "investigation").map((l) => [l.target, quietly(() => ctx.taskView?.(l.target)) ?? null]));

const adoptedOf = (records) => records.filter((r) => r.kind === "snapshot").at(-1)?.snapshot ?? null;

// Why there may be no activity: the working set's own word, or that one of its files could not be read.
const sourceOf = (ctx, slices) => (ctx.workingSet.source !== "ok" ? ctx.workingSet.source : slices.some((s) => s.lines === null) ? "unreadable" : "ok");

const inputOf = (ctx, { id, records, fold, slices }) => ({ id, fold, sessions: slices.map((s) => ({ session: s.session, host: s.host, activity: activityOf(ctx, s) })), editedAt: newestOf(slices.map((s) => (s.lines ? lastEditAt(s.lines) : null))), contested: contestedIn(ctx, slices, fold), tasks: tasksOf(ctx, fold), snapshot: adoptedOf(records), checks: ctx.activity.checks, coverage: coverageOf(fold.bindings.at(-1)?.host ?? ctx.host ?? null), source: sourceOf(ctx, slices) });

function unknown(id) {
  throw new Refused(`no work ${id} is kept here`);
}

export function readView(ctx, id, scan = scanOf(ctx.works)) {
  const records = ctx.works.read(id) ?? unknown(id);
  const fold = trackOf(records);
  const slices = sessionsOf(fold).map((mark) => sliceOf(ctx, scan, id, fold, mark));
  return workViewOf(inputOf(ctx, { id, records, fold, slices }));
}

// What a report snapshots: the files and checks the engine observed, never typed by the caller.
export function observeOf(ctx, id) {
  const view = readView(ctx, id);
  return { files: view.activity.files, checks: view.activity.checks };
}
