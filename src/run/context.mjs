// The composition root's product: every port the runner talks through, bound
// once. cli/*.mjs build it against the real project and real adapters; tests
// build it with fakes. Nothing below this file reaches for process.env,
// process.cwd or a child process on its own.
import { createBrowser } from "../browser/index.mjs";
import { createCapabilityRegistry } from "../capability/registry.mjs";
import { createDslRegistry } from "../dsl/registry.mjs";
import { createValidatorRegistry } from "../dsl/validators.mjs";
import { createProcess } from "../process/index.mjs";
import { coreExecutors } from "./verbs/core.mjs";
import { agree } from "./verbs/registry.mjs";
import { fromEnv } from "../project/env.mjs";
import { Refused, seconds } from "./errors.mjs";
import { createDatabase } from "../database/index.mjs";
import { createKnowledgeParts } from "../extensions/knowledge-parts.mjs";
import { createReportingParts } from "../extensions/reporting-parts.mjs";
import { createFrontend } from "../frontend/index.mjs";
import { loadGraph } from "../graph/index.mjs";
import { createIdentity } from "../identity/index.mjs";
import { createMemory } from "../memory/index.mjs";
import { loadProject } from "../project/index.mjs";
import { createTools } from "../tools/index.mjs";
import { machineContext } from "../store/context.mjs";
import { runtimePath, runtimeSession } from "../project/runtime.mjs";
import { baseEnv } from "../process/env.mjs";
import { realIo } from "../store/io.mjs";
import { pluginRoot } from "../version.mjs";
import { localLauncher } from "./worker.mjs";

// `overrides.runDir` is a TASK-SCOPED run directory (a sandbox's): its own browser session by name, its
// own driving lock, and no profile -- a blank browser that shares nothing with the person's.
export function createContext(overrides = {}, env = process.env, cwd = process.cwd()) {
  const project = overrides.project ?? loadProject(env, cwd);
  const config = usable(project.config);
  const browser = overrides.browser ?? createBrowser(overrides.runDir ?? config.runDir, { signInHosts: config.signIn.hosts, timeoutMs: ms(env, "CLI_TIMEOUT", 30), isolate: Boolean(overrides.runDir) || project.layout === 3 || project.isolated, guard: (dir) => runtimeSession(project, dir) });
  return finish({ project, config, graph: overrides.graph ?? loadGraph(project.graphDir), browser, env, ...overrides }, config);
}

// A project.json nobody can read is bad USAGE, not a broken product: refuse
// before a port is bound to a value that was never validated.
function usable(config) {
  const found = config.findings ?? [];
  if (found.length) throw new Refused(`ui-tests/project.json is invalid — fix it before running:\n  ${found.join("\n  ")}`);
  return config;
}

// A budget for one child process, decided in the one place that reads the
// environment. No port reaches for it itself.
const ms = (env, name, fallbackSec) => seconds(fromEnv(env, name), fallbackSec, name) * 1000;

// WHERE this project's store is, asked once and only when something is about to
// be kept there. Resolving it touches the filesystem and can end in Blocked, and
// `query dsl` prints a table out of two .mjs files: a command that reads nothing
// must not learn to fail because a home directory is read-only. The commands
// that write -- a run keeping its evidence, the ledger, a note -- are the ones
// that find out where it goes, and they are the ones a Blocked is honest about.
function machineRoot(ctx, config) {
  let machine = null;
  return (write = false) => {
    machine ??= machineContext({ config, project: ctx.project }, ctx.env);
    if (write) machine.prepare();
    return machine.store.root;
  };
}

function finish(ctx, config) {
  const store = ctx.store ?? machineRoot(ctx, config);
  const dsl = ctx.dsl ?? createDslRegistry();
  return { ...ports(ctx, config, store), ...ctx, dsl, executors: ctx.executors ?? runtimeOver(dsl) };
}

// This project's EFFECTIVE vocabulary and the behaviours over it, bound to EACH
// OTHER: the executor registry registers against the same vocabulary the schema
// and the validator are working from, so a verb nothing can run is refused here
// rather than at step 14 of a live run.
//
// A registry per CONTEXT rather than one per process, because two projects in
// one process -- the suite, an agent driving two checkouts -- must not be able to
// see each other's words, and a global would make that a matter of load order.
const runtimeOver = (dsl) => agree(dsl, coreExecutors(dsl));

const ports = (ctx, config, store) => ({
  db: createDatabase(config.sql.command, { timeoutMs: ms(ctx.env, "DB_TIMEOUT", config.sql.timeoutSec ?? 120) }),
  identity: createIdentity(ctx.browser, ctx.env, config.identity, ctx.project),
  frontend: createFrontend(config.frontend.roots),
  tools: createTools(undefined, ctx.env),
  process: createProcess({ timeoutMs: ms(ctx.env, "PROCESS_TIMEOUT", 60) }),
  capabilities: createCapabilityRegistry(),
  validators: createValidatorRegistry(),
  // What a project's extensions teach project knowledge (src/knowledge/). Bound
  // for EVERY context, because the loader refuses one without it rather than
  // skip validating what an extension declares.
  knowledge: createKnowledgeParts(),
  // What a project's extensions declare for the project report: data rows
  // naming scripts, parsed by the loader and never imported (1.6.0).
  reporting: createReportingParts(),
  store,
  memory: createMemory(store),
  // How a capability's helper is started (ADR 0036): a pack's program, under this Node and the
  // minimal environment a child needs -- never the rest of this one. A binder is NOT bound here:
  // a logical ref is resolved only where a task's sandbox resolved it (a worker's sealed table),
  // and a run with none says so instead of guessing an address.
  helpers: localLauncher(pluginRoot(), realIo(), { node: process.execPath, env: baseEnv(ctx.env ?? {}) }),
  now: Date.now,
  warn: (m) => console.error(m),
});
