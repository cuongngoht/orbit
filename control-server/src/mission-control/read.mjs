// MISSION CONTROL: every task execution on this machine, across every project Orbit knows -- a
// projection over the registry and the task journals, rebuilt on each look and stored nowhere.
//
// It reads one directory listing per project and one small file per task: no git, no runtime, no
// probe, no write, no index. "Today" begins at this machine's midnight. A project or a task that
// cannot be read is said to be so, and costs the rest of the machine nothing.
import { localDayStart, machineApprovals, machineView, projectStoreRoot } from "../core.mjs";
import { registryOf } from "../projects/read.mjs";

function machineOf(ctx) {
  const now = ctx.now().toISOString();
  return { registry: registryOf(ctx), rootOf: (key) => projectStoreRoot(ctx.world.storeBase, key), io: ctx.world.io, now, since: localDayStart(now) };
}

export const missionControl = (ctx) => machineView(machineOf(ctx));

export const missionApprovals = (ctx) => machineApprovals(machineOf(ctx));
