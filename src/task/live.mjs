// A task as a LIVE page reads it: the lines appended since it last looked, and the task as of now --
// the SAME fold and the SAME view every other reader uses (model.mjs, views.mjs), over a follower
// (src/store/follow.mjs) instead of a whole-file read. Nothing here owns a timer or decides WHEN to
// look; the live core does (src/live/followers.mjs), for whichever viewer holds a lease. Nothing here
// writes: the journal is the task's only state, and a live view is one more reader of it.
//
//   createTaskLive(follower, { checkout }) -> { pull(), model(), viewOf(now), count }
//
// FINGERPRINT is what a person watching cares about. A page is sent the whole view again only when
// one of these moved -- a stage, a lifecycle, an approval's state -- never because a receipt landed
// or a minute passed. It is a table, so what makes a snapshot worth sending is said in one place and
// a test holds each row. Time is in it on purpose through `approvals`: an approval EXPIRES with no new
// line written, and the fingerprint is what notices.
import { modelOf } from "./model.mjs";
import { journalLine } from "./store.mjs";
import { taskView } from "./views.mjs";

export const LIVE_VERSION = 1;

export const FINGERPRINT = [
  ["lifecycle", (v) => v.lifecycle],
  ["terminal", (v) => v.terminal],
  ["stage", (v) => v.stage],
  ["revision", (v) => v.revision],
  ["stop", (v) => v.stopReason],
  ["attempt", (v) => v.attempt.current],
  ["paused", (v) => v.paused?.at ?? null],
  ["blocked", (v) => (v.blocked ? `${v.blocked.at}:${v.blocked.stop}` : null)],
  ["approvals", (v) => v.approvals.map((a) => `${a.id}=${a.state}`).join(",")],
  ["ended", (v) => v.ended?.kind ?? null],
];

export const fingerprintOf = (view) => FINGERPRINT.map(([key, of]) => `${key}:${of(view) ?? ""}`).join("|");

// One journal line as the page receives it: where it came from, its index, and the line as the
// journal kept it (already allow-listed and scrubbed by the write door).
export const liveEvent = (n, record) => ({ source: "task", n, ...record });

export function createTaskLive(follower, opts = {}) {
  const memo = { count: -1, model: null };
  const model = () => folded(follower, memo);
  return { pull: () => pulledEvents(follower), model, viewOf: (now) => taskView(model(), now, opts.checkout ?? null), get count() { return follower.count; } };
}

function pulledEvents(follower) {
  const got = follower.pull();
  return { events: got.items.map((it) => liveEvent(it.n, it.record)), reset: got.reset };
}

// The fold is cheap, but a heartbeat asks for the view with nothing new: fold again only when a line
// was added.
function folded(follower, memo) {
  if (memo.count === follower.count) return memo.model;
  Object.assign(memo, { count: follower.count, model: modelOf(follower.items.map((it) => it.record)) });
  return memo.model;
}

// The task as a live SOURCE, as the task subject itself answers it: the live core (src/live/) imports no
// subject, so a composition root hands it this. How a line is kept, how it folds and what makes a view
// worth sending again stay the task's own.
// The kinds whose first line ENDS a task (model.mjs FOLDS: `ended ??=`). A viewer choosing among many tasks
// looks for one near a journal's end instead of folding every journal: after an end, only how something already
// running ended may still be written (rules.mjs ENDED), so the ending line is never far from the end.
export const ENDING_KINDS = Object.freeze(["completed", "failed", "cancelled"]);

export const TASK_SOURCE = Object.freeze({ live: createTaskLive, line: journalLine, fingerprintOf, liveEvent, version: LIVE_VERSION, ends: ENDING_KINDS });
