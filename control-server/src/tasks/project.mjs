// One checkout's TASKS, named in the path by project and checkout -- found in the registry, the
// way every project page finds its checkout, and opened in the project's machine store.
//
// Unlike a runtime page, a task needs nothing of the checkout's folder: its journal lives in the
// store, so a task of a checkout whose folder is gone can still be read, paused or cancelled.
// No git runs and no binding is written: a checkout that is listed was bound already. The task
// context names its checkout, so a task id from another checkout -- even of the same project --
// is unknown here (src/task/load.mjs). It also names its DOOR: a change reaches an operation only
// after security.mjs checked the page's mutation token and origin, which is the one proof of a
// person Orbit has -- so here, and only here, a decision that allows something may be written.
import { createTasks, guardedIo, projectStoreRoot } from "../core.mjs";
import { invalid, missing } from "../errors.mjs";
import { registryOf } from "../projects/read.mjs";

const TASK_ID = /^tsk-[a-f0-9]{12}$/;
const APPROVAL_ID = /^apr-[0-9]{1,6}$/;

export function tasksOf(ctx, [key, checkout]) {
  const found = registryOf(ctx).find(key, checkout);
  if (!found) throw missing("PROJECT_UNKNOWN", "no project and checkout like that is known on this machine");
  const root = projectStoreRoot(ctx.world.storeBase, found.project.key);
  return { root, tasks: createTasks(root, guardedIo(root, ctx.world.io)), project: found.project.key, checkout: found.checkout.id, checkoutSummary: found.checkout, session: null, door: "control", now: () => ctx.now().toISOString() };
}

export function taskIdOf(id) {
  if (!TASK_ID.test(String(id ?? ""))) throw invalid("INVALID_TASK_ID", "a task id is tsk- followed by twelve hex characters");
  return id;
}

export function approvalIdOf(id) {
  if (!APPROVAL_ID.test(String(id ?? ""))) throw invalid("INVALID_APPROVAL_ID", "an approval id is apr- followed by a number");
  return id;
}
