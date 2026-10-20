// What the rest of the engine reaches for. The registry is registry.mjs, the
// engine's own behaviours are core.mjs, and this is the door.
//
// EXECUTORS is the CORE registry over the CORE vocabulary, and it exists for the
// same reason dsl/verbs.mjs does: rendering a step out of a run-log (src/report/)
// or printing a plan asks a verb for its own `label` and `tail`, has no run in
// hand, and is always talking about the engine's own verbs. A run asks
// `ctx.executors`, which is that plus whatever this project registered.
import { CORE } from "../../dsl/registry.mjs";
import { coreExecutors } from "./core.mjs";
import { agree } from "./registry.mjs";

export { createExecutorRegistry, agree } from "./registry.mjs";
export { CORE_EXECUTORS, coreExecutors } from "./core.mjs";
export { SKIP } from "./skip-if.mjs";

export const EXECUTORS = agree(CORE, coreExecutors(CORE));
