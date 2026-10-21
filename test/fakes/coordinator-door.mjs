// One line written into a task THROUGH THE COORDINATOR'S DOOR, as cli/automation.mjs writes it -- for a test that
// stands in for the coordinator's engine in a real checkout (a coordinated workflow's journal is its engine's alone:
// src/task/rules.mjs ENGINE_OWNED_TASK). Run from the checkout, with the store the test set up in the environment.
//
//   node coordinator-door.mjs <task> <op> '<given as JSON>'
import { runtimeProject } from "../../src/runtime/context.mjs";
import { machineContext } from "../../src/store/context.mjs";
import { apply } from "../../src/task/ops.mjs";
import { createTasks } from "../../src/task/store.mjs";

const [task, op, given] = process.argv.slice(2);

// The test runner loads every module under test/; run without its arguments, this writes nothing.
if (!task || !op) process.exit(0);

const { paths, config } = runtimeProject(process.env, process.cwd());
const io = machineContext({ project: paths, config: config ?? {} }, process.env).io;
const ctx = { tasks: createTasks(paths.storeRoot, io), project: paths.storeKey, checkout: paths.checkoutId, session: process.env.ORBIT_SESSION ?? null, now: () => new Date().toISOString(), door: "coordinator" };
console.log(JSON.stringify(apply(ctx, task, op, JSON.parse(given ?? "{}"))));
