// Where an observation lives, and the observation as a LIVE SOURCE (ADR 0020): the one place the file's path is
// built -- the check runner's composition root writes it, a viewer's reads it -- and what the live core needs to
// follow one: the keep-rule of a line, the fold, the view, and when a view is worth sending again.
//
//   activityFile(storeRoot, task, action) -> path      <storeRoot>/orchestration/<task>/activity/<act>.jsonl
//   ACTIVITY_SOURCE                                     handed to src/live/ by a composition root, never imported there
//     line(text) -> record | null                       the ONE reading of a line (the writer's envelope and kind)
//     open(storeRoot, io) -> { fileOf(task, action) }
//     observedOf(view) -> [action id]                   the check actions of a task, newest last, at most
//                                                       LIMITS.ACTIONS_FOLLOWED: what a viewer follows
//     empty() · fold(state, record) · view(state)       the projection (fold.mjs), the same as the runner's
//     fingerprintOf(view) -> string                     what a person watching cares about moved
import { join } from "node:path";
import { contained } from "../../project/boundary.mjs";
import { emptyObservation, foldObservation, observationView } from "./fold.mjs";
import { ACTION_ID, ACTIVITY_SCHEMA, KINDS, LIMITS, TASK_ID } from "./vocab.mjs";
import { PURPOSES } from "../vocab.mjs";

export function activityFile(storeRoot, task, action) {
  if (!TASK_ID.test(String(task)) || !ACTION_ID.test(String(action))) throw new Error("an observation is kept for a task id and an act- id");
  const room = join(storeRoot, "orchestration", task, "activity");
  return contained(room, join(room, `${action}.jsonl`));
}

const parsed = (text) => {
  try { return JSON.parse(text); }
  catch { return null; }
};

// A line this writer wrote: an object of a known kind, of this schema, with a sequence and a generation.
export const activityLine = (text) => ((r) => (r && typeof r === "object" && r.v === ACTIVITY_SCHEMA && Object.hasOwn(KINDS, r.kind) && Number.isInteger(r.seq) && Number.isInteger(r.gen) ? r : null))(parsed(text));

export const observedOf = (view) => (view?.actions ?? []).filter((a) => PURPOSES.includes(a.type) && ACTION_ID.test(String(a.id))).map((a) => a.id).slice(-LIMITS.ACTIONS_FOLLOWED);

// A view is resent when what it says moved: a case, a failure, a total, the end -- never because a clock ticked.
export const fingerprintOf = (v) => [v.state, v.seq, v.reported, v.failures.length, v.total ?? "", v.adapter?.id ?? "", v.adapter?.runner ?? "", v.gaps.length, v.output?.lines ?? 0].join("|");

export const ACTIVITY_SOURCE = Object.freeze({
  version: ACTIVITY_SCHEMA,
  line: activityLine,
  open: (storeRoot) => ({ fileOf: (task, action) => activityFile(storeRoot, task, action) }),
  observedOf,
  empty: emptyObservation,
  fold: foldObservation,
  view: observationView,
  fingerprintOf,
});
