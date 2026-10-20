// One checkout's TRACKED WORKS (1.8.8), named in the path by project and checkout -- found in the registry the way the tasks are,
// and opened in the project's machine store. The work journal is in the store, so a checkout whose folder is gone can still be
// read. A work is a checkout's only when it was tracked there: another checkout's work, even of the same project, is unknown here.
// This context carries no door of any kind: a work is READ in Control, and nothing in it writes, resumes, approves or runs.
import { createTasks, createWorks, guardedIo, projectStoreRoot, sessionActivityOf, sessionLinesOf, TASK_COMMANDS, WORKING_SET_CHECKS, workingSetOf, workingSetRoom } from "../core.mjs";
import { invalid, missing } from "../errors.mjs";
import { registryOf } from "../projects/read.mjs";

const WORK_ID = /^w-[0-9a-f]{12}$/;

const IDLE_AFTER_MS = 120_000;

const taskViewOf = (tasks, found, now) => (id) => TASK_COMMANDS.show.run({ tasks, checkout: found.checkout.id, checkoutSummary: found.checkout, now }, [id]);

function foundIn(ctx, [key, checkout]) {
  const found = registryOf(ctx).find(key, checkout);
  if (!found) throw missing("PROJECT_UNKNOWN", "no project and checkout like that is known on this machine");
  return found;
}

const portsOf = (ctx, found, root, io) => ({ now: () => ctx.now().toISOString(), nowMs: ctx.now().getTime(), idleAfterMs: IDLE_AFTER_MS, host: null, workingSet: workingSetOf(ctx.world.io, workingSetRoom(root, ctx.world.io.host, found.checkout.id), "ok"), activity: { linesOf: sessionLinesOf, activityOf: sessionActivityOf, checks: WORKING_SET_CHECKS }, taskView: taskViewOf(createTasks(root, io), found, () => ctx.now().toISOString()) });

export function worksOf(ctx, ids) {
  const found = foundIn(ctx, ids);
  const root = projectStoreRoot(ctx.world.storeBase, found.project.key);
  const io = guardedIo(root, ctx.world.io);
  return { works: createWorks(root, io), checkout: found.checkout.id, ...portsOf(ctx, found, root, io) };
}

export function workIdOf(id) {
  if (!WORK_ID.test(String(id ?? ""))) throw invalid("INVALID_WORK_ID", "a work id is w- followed by twelve hex characters");
  return id;
}
