// Reading one checkout's tasks: the list, one task as the page shows it, and its journal from a
// position on. Through the SAME command table cli/task.mjs runs, so a page and a terminal read one
// answer. A read writes nothing, probes nothing and starts nothing.
import { TASK_COMMANDS } from "../core.mjs";
import { guarded } from "../errors.mjs";
import { taskIdOf, tasksOf } from "./project.mjs";

const CODE = "TASK_READ_FAILED";

export const listTasks = (ctx, ids) => guarded(CODE, () => ({ tasks: TASK_COMMANDS.list.run(tasksOf(ctx, ids), []).tasks }));

export const readTask = (ctx, ids) => guarded(CODE, () => ({ task: TASK_COMMANDS.show.run(tasksOf(ctx, ids), [taskIdOf(ids[2])]) }));

// `?since=<n>`: only the lines a page does not hold yet. Anything that is not a whole number reads
// from the start.
const sinceOf = (query) => (/^\d{1,9}$/.test(String(query?.since ?? "")) ? `--since=${query.since}` : "--since=0");

export const taskEvents = (ctx, ids, query) => guarded(CODE, () => TASK_COMMANDS.events.run(tasksOf(ctx, ids), [taskIdOf(ids[2]), sinceOf(query)]));
