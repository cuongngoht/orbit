// The SOURCES a live task is drawn from, one per kind of file a viewer may follow. Each is a subject the
// follower registry polls (followers.mjs): `poll()` answers what is new, or null. Adding a source is one
// subject here, read through its owner's own keep-rule -- never a second reading of somebody's file.
//
//   task           the task's journal: its lines, and the task as of now
//   investigation  one investigation begun against the task: its lines as QA activity, allow-listed
//   activity       one check action's OBSERVATION (1.8.5, ADR 0020): its lines folded as they arrive into one
//                  bounded projection -- nothing of them kept but the fold, however long the run
//   tick           a timer only: a log is read by the runtime's own door at each viewer's own offset, so
//                  the shared part is the clock and nothing is buffered
//
// The live core reads no subject itself. What a task's journal looks like, how it folds and what a line
// says as activity are their OWNERS' answers, handed in by a composition root as a source:
//   task source       { live(follower, {checkout}), line, fingerprintOf, liveEvent, version }   (src/task/live.mjs)
//   qa source         { line, activityOf, investigationsOf, stampOf, MAX_FOLLOWED }            (src/investigation/live.mjs)
//   activity source   { line, open(root) -> { fileOf }, observedOf(view), empty, fold, view, fingerprintOf }
//                                                                    (src/orchestration/activity/source.mjs)
import { createFollower } from "../store/follow.mjs";

export function taskSubject(source, io, taskCtx, task) {
  const follower = createFollower(io, taskCtx.tasks.journalFile(task), { parse: source.line, keep: true });
  const live = source.live(follower, { checkout: taskCtx.checkoutSummary ?? null });
  return { live, follower, poll: () => newOrNull(live.pull()) };
}

export function investigationSubject(source, io, store, id) {
  const follower = createFollower(io, store.journalFile(id), { parse: source.line, keep: true });
  const replay = (from) => follower.items.filter((it) => it.n >= from).flatMap((it) => qaEvents(source, id, it));
  return { id, follower, replay, poll: () => newOrNull(qaBatch(source, id, follower.pull())) };
}

// An observation is folded, never kept line by line: a joining viewer is sent the projection, which a later one
// replaces whole. A file that shrank was begun again: the fold starts over and the view says how many times.
export function activitySubject(source, io, file) {
  const follower = createFollower(io, file, { parse: source.line, keep: false });
  const state = { fold: source.empty(), resets: 0 };
  return { follower, view: () => ({ ...source.view(state.fold), resets: state.resets }), poll: () => activityPolled(source, follower, state) };
}

function activityPolled(source, follower, state) {
  const got = follower.pull();
  if (got.reset) Object.assign(state, { fold: source.empty(), resets: state.resets + 1 });
  got.items.forEach((it) => source.fold(state.fold, it.record));
  return got.items.length > 0 || got.reset ? { events: [], reset: got.reset } : null;
}

export const TICK = Object.freeze({ tick: true });

export const tickSubject = () => ({ poll: () => TICK });

// One investigation line as a viewer receives it: whose it is, its index, and what it says as activity.
export const qaEvents = (source, id, it) => source.activityOf(it.record).map((event) => ({ source: id, n: it.n, ...event }));

const qaBatch = (source, id, got) => ({ events: got.items.flatMap((it) => qaEvents(source, id, it)), reset: got.reset });

const newOrNull = (batch) => (batch.events.length > 0 || batch.reset ? batch : null);
