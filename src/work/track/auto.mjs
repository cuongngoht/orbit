// A TASK THAT STARTS BESIDE A TRACKED WORK joins it (1.8.8): `autonomous-engineering start`, `automation start` and
// `task create --work` hand the task they created here, and it is linked to the session's CURRENT work, with a handover
// (developer -> autonomous) the first time. Nothing is created: a session with no tracked work -- or one whose work was
// closed -- gets nothing, because a task nobody asked about by name is not a request to track one. Tracking never
// blocks the task: the caller reads `attached` and prints a warning when it could not write.
import { handoff } from "./write.mjs";
import { currentOf, scanOf } from "./resolve.mjs";
import { trackOf } from "./fold.mjs";

const joined = (ctx, work, spec) => ((h) => ({ work, linked: h.linked, handedOver: h.changed }))(handoff(ctx, { work, to: "autonomous", task: spec.task, what: spec.what, because: spec.because }));

// spec: { task, what: "task" | "workflow", because? } -> { work, linked, handedOver } | null
export function attach(ctx, spec) {
  const current = currentOf(scanOf(ctx.works), ctx.session, ctx.checkout);
  return current && current.fold.closed === null ? joined(ctx, current.id, spec) : null;
}

// A task that NAMES its work (`task create --work=w-…`): joined only when that work is a tracked one.
export function attachNamed(ctx, work, spec) {
  const records = ctx.works.exists(work) ? ctx.works.read(work) : null;
  return records && trackOf(records).tracked && trackOf(records).closed === null ? joined(ctx, work, spec) : null;
}

const failed = (e) => ({ warning: `the task was not added to its tracked work: ${String(e?.message ?? e).slice(0, 160)}` });

// Tracking is beside the task, never in its way: a refusal or a lock another session holds is a warning.
export function attached(run) {
  try {
    return run();
  } catch (e) {
    return failed(e);
  }
}

export const attachedLine = (a) => (a?.work ? `WORK       ${a.work} — this task is linked${a.handedOver ? " and the work is with the autonomous task" : ""}` : a?.warning ? `WORK       ${a.warning}` : null);
