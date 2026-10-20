// A task as it stands, read from its journal: the one read the write door judges against and
// every view renders from.
//
// A task belongs to ONE checkout, recorded on its first line. A context bound to a checkout --
// the CLI in a checkout, Orbit Control on a path that names one -- sees only that checkout's
// tasks, so an id from one checkout can never address a task of another, even in the same
// project. A journal whose first line cannot be read has no owner and is not a task anyone may
// drive.
import { Refused } from "../errors.mjs";
import { modelOf, stateOf } from "./model.mjs";
import { CODES } from "./vocab.mjs";

export const unknownTask = (id) => Object.assign(new Refused(`no task ${id} in this checkout`), { code: CODES.TASK_UNKNOWN });

const ownedBy = (model, ctx) => model.meta?.kind === "created" && (!ctx.checkout || model.meta.checkout === ctx.checkout);

// -> { model, now, state }, or TASK_UNKNOWN.
export function loadTask(ctx, id) {
  const records = ctx.tasks.read(id);
  const model = records === null ? null : modelOf(records);
  if (!model || !ownedBy(model, ctx)) throw unknownTask(id);
  const now = ctx.now();
  return { model, now, state: stateOf(model, now) };
}
