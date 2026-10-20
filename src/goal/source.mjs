// A goal's plan and fold as a LIVE SOURCE (1.9.0, ADR 0023): read by goal id from the store room.
//
//   GOAL_SOURCE
//     open(storeRoot, io) -> { read(goalId) }
//     projectionOf(model) -> { id, title, lifecycle, units, acceptance, currentTask }
import { join } from "node:path";
import { goalProjection } from "./live.mjs";
import { modelOf } from "./model.mjs";
import { createGoals } from "./store.mjs";

const GOAL = /^goal-[a-f0-9]{12}$/;

export const projectionOf = (model, currentTask = null) => goalProjection(model, currentTask);

export const GOAL_SOURCE = Object.freeze({
  version: 1,
  open: (storeRoot, io) => ({ read: (goalId) => readGoal(storeRoot, io, goalId) }),
  projectionOf,
});

function readGoal(storeRoot, io, goalId) {
  if (!GOAL.test(String(goalId))) return null;
  const goals = createGoals(storeRoot, io);
  const records = goals.read(goalId);
  if (!records.length) return null;
  return projectionOf(modelOf(records));
}

export function goalJournalFile(storeRoot, goalId) {
  return join(storeRoot, "goals", goalId, "journal.jsonl");
}
