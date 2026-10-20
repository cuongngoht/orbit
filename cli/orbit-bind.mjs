import { createGoals } from "../src/goal/store.mjs";
import { runtimeProject } from "../src/runtime/context.mjs";
import { machineContext } from "../src/store/context.mjs";
import { createTasks } from "../src/task/store.mjs";
import { summariesOf } from "./orbit-summaries.mjs";

export function orbitPorts(env, pluginRoot, automationStart) {
  const { paths, config } = runtimeProject(env, process.cwd());
  const machine = machineContext({ project: paths, config: config ?? {} }, env);
  return bindOrbit(paths, machine, env, pluginRoot, automationStart);
}

function bindOrbit(paths, machine, env, pluginRoot, automationStart) {
  const storeRoot = machine.store.root;
  const goals = createGoals(storeRoot, machine.io);
  const tasks = createTasks(storeRoot, machine.io);
  const ctx = goalCtx(paths, env);
  return { ctx, io: machine.io, goals, tasks, automation: { start: (spec) => automationStart(spec, paths.root, env, pluginRoot) }, taskSummaries: () => summariesOf(tasks) };
}

function goalCtx(paths, env) {
  return { project: paths.storeKey ?? configName(paths), checkout: paths.checkoutId ?? "co-orbit000000", session: env.ORBIT_SESSION ?? "orbit", host: env.ORBIT_HOST ?? "cli" };
}

function configName(paths) {
  return paths.config?.name ?? "project";
}
