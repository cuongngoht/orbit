// The ONE real binding of the runtime subject: every port bound to the machine in front
// of it, for cli/runtime.mjs and for Orbit Control choosing a checkout.
//
// src/runtime/ reads no environment variable, spawns nothing and opens no socket: it is
// handed the Process port, the probe, the Reach port, the machine, the source tree and the
// working tree. This is where they are made -- the same adapters every other command uses
// (createProcess, createSourceTree, the tool detection and state), pointed at ONE
// checkout -- so the CLI and Control cannot bind two different machines to the one
// subject, and a test binds the same thing to fakes (test/fakes/runtime-ctx.mjs).
//
// What it adds is nothing a rule needs: no policy, no default, no fallback. A
// checkout that is not a Git checkout is Refused by the context, and a store that
// cannot be written is Blocked by it.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { builtinEcosystems } from "../../src/ecosystems/builtin.mjs";
import { Blocked, Refused } from "../../src/errors.mjs";
import { entryOf, isolatedSandbox } from "../../src/investigation/sandbox.mjs";
import { createSourceTree } from "../../src/frontend/composite.mjs";
import { createLocalClones } from "../../src/frontend/local-clones.mjs";
import { createWorktree } from "../../src/frontend/worktree.mjs";
import { createWorkspaces } from "../../src/orchestration/workspace.mjs";
import { capabilitiesOf } from "../../src/qa/capability.mjs";
import { catalogFile, readCatalog } from "../../src/catalog.mjs";
import { createProcess } from "../../src/process/index.mjs";
import { createProbe } from "../../src/probe/index.mjs";
import { createReach } from "../../src/probe/reach.mjs";
import { runtimeCatalog } from "../../src/runtime/catalog.mjs";
import { ISOLATION_PROVIDERS, boundIsolation } from "../../src/runtime/isolation/index.mjs";
import { runtimeContext, runtimeProject } from "../../src/runtime/context.mjs";
import { runtimeSandboxContext } from "../../src/runtime/sandbox/context.mjs";
import { loopbackPort, originOf } from "../../src/runtime/origin.mjs";
import { look } from "../../src/runtime/understanding.mjs";
import { DETECTORS, createMachine } from "../../src/runtime/machine.mjs";
import { stateRooms } from "../../src/store/control.mjs";
import { realIo } from "../../src/store/io.mjs";
import { detectionContext } from "../../src/tools/context.mjs";
import { toolCatalog } from "../../src/tools/catalog.mjs";
import { createToolState } from "../../src/tools/state.mjs";

// `read(path)` is what `runtime record` reads candidates through: a file, or stdin.
export function readInput(path) {
  try {
    return readFileSync(path ?? 0, "utf8");
  } catch (e) {
    throw new Refused(`cannot read ${path ?? "stdin"}: ${e.message}`);
  }
}

// -> the runtime context for the checkout `cwd` is in.
export function bindRuntime({ pluginRoot, env, cwd, read = readInput, host }) {
  const found = runtimeProject(env, cwd);
  const raw = realIo();
  const portsOf = ports(found, raw, { pluginRoot, env });
  return runtimeContext(found, env, { raw, read, host, ...portsOf, pluginRoot, isolation: boundIsolation(ISOLATION_PROVIDERS), supervisorArgv: [process.execPath, join(pluginRoot, "cli", "sandbox-supervisor.mjs")], workspaces: workspacesOf(portsOf.process, env), capabilities: () => (found.config ? capabilitiesOf(found.config) : {}) });
}

// -> the runtime context of the SANDBOX `task` owns in the checkout `cwd` is in: the checkout's own context,
// re-rooted on the task's workspace (src/runtime/sandbox/context.mjs). The workspace itself is the workspace
// owner's -- prepared by the orchestrator's `prepare-workspace` -- so a task with none is Refused here.
export function bindSandbox({ pluginRoot, env, cwd, task, read = readInput, host }) {
  return runtimeSandboxContext(bindRuntime({ pluginRoot, env, cwd, read, host }), { task });
}

// The workspaces a task owns, as the runtime's port (src/runtime/context.mjs): the workspace owner (found
// and its tree), a source port that reads what a workspace HOLDS, and its working tree. A workspace whose
// tree git cannot name is a tree of null -- the sandbox reads that as stale, never as an error.
const workspacesOf = (proc, env) => ({ io, paths, host }) => portOf(createWorkspaces({ root: paths.storeRoot, io, trees: createLocalClones(paths.root, proc, { noHooks: join(paths.storeRoot, "workspaces", ".no-hooks"), inherit: env }), host, now: () => new Date().toISOString() }));

const portOf = (owner) => ({ found: (task) => owner.found(task), tree: (task) => treeOrNull(owner, task), sourceOf: (path) => createSourceTree([path], undefined, { staged: true }), treeOf: (path) => createWorktree(path, realIo()) });

function treeOrNull(owner, task) {
  try { return owner.treeOf(task) || null; }
  catch { return null; }
}

function ports(found, raw, { pluginRoot, env }) {
  const root = found.paths.root;
  const tools = toolCatalog(readCatalog(raw, catalogFile(pluginRoot, "tools")));
  const catalog = runtimeCatalog(readCatalog(raw, catalogFile(pluginRoot, "runtimes")));
  return { source: createSourceTree([root], undefined, { submodules: true }), tree: createWorktree(root, raw), process: createProcess(), probe: createProbe(), reach: createReach(), ecosystems: builtinEcosystems(), catalog, machine: machineOf(found, raw, { tools, env, root }), browserTool: tools.find((t) => t.provides.includes("browser.automation"))?.id ?? null };
}

function machineOf(found, raw, { tools, env, root }) {
  const rooms = stateRooms(found.paths.storeBase);
  const detection = detectionContext({ env, projectRoot: root, rooms, detectors: DETECTORS, home: homedir() });
  return createMachine({ catalog: tools, state: createToolState(rooms, raw), detection, now: () => new Date().toISOString(), platform: process.platform, arch: process.arch });
}

// Whether the application an approved environment names is one THIS checkout's runtime
// declares, and whether anything answers there: the one question an investigation asks of the
// runtime (src/runtime/origin.mjs). Silence (null) for an origin elsewhere, for a checkout
// nobody has understood and for a machine that cannot answer -- never a stop of its own.
export async function originAnswer(where, origin) {
  if (!loopbackPort(origin)) return null;
  return asked(where, origin).catch(() => null);
}

async function asked({ pluginRoot, env, cwd }, origin) {
  const ctx = bindRuntime({ pluginRoot, env, cwd });
  return originOf({ view: look(ctx).view, probe: ctx.probe }, origin);
}

// What an investigation asks of a TASK'S SANDBOX (`autonomous-qa plan --sandbox=<env>`): the sandbox's view and
// whether anything answers on the port the browser would open. The environment must be one of THIS checkout's:
// another checkout's sandbox is never verified from here. Silence is not an answer here -- a sandbox the person
// named and nobody can find is Refused, where `originAnswer` says nothing about an origin it does not know.
//
// `deps` are the runtime's own pieces, taken as parameters so a test binds fakes: `commands()` (the runtime's
// COMMANDS, read lazily so a binding that never asks about a sandbox never loads them), `bind(where)` (a
// person's context) and `bindOwned({ ...where, task })` (the sandbox's).
export async function sandboxAnswer(where, envId, deps = {}) {
  const { commands = runtimeCommands, bind = bindRuntime, bindOwned = bindSandbox } = deps;
  const table = await commands();
  const ctx = bindOwned({ ...where, task: await ownerOfSandbox(table, personal(bind, where), envId) });
  const view = await table.sandbox.run(ctx, []);
  return { view, served: isolatedSandbox(view) ? view.state === "READY" : await entryServed(ctx, view) };
}

// A checkout the runtime cannot be bound to (a loose ui-tests/, not a Git checkout) has no sandboxes: say so, typed.
function personal(bind, where) {
  try {
    return bind(where);
  } catch (e) {
    if (e instanceof Refused || e instanceof Blocked) throw e;
    throw new Refused(`no runtime can be bound to this checkout, so it has no sandbox (${e.message})`);
  }
}

const runtimeCommands = async () => (await import("../../src/runtime/index.mjs")).COMMANDS;

async function ownerOfSandbox(table, ctx, envId) {
  if (!table.sandboxes || !table.sandbox) throw new Refused("this engine's runtime has no sandbox commands, so no sandbox can be verified from here");
  const { sandboxes } = await table.sandboxes.run(ctx, []);
  const found = sandboxes.find((s) => s.id === envId);
  if (!found) throw new Refused(`no sandbox ${envId} is known in this checkout; another checkout's sandbox is never verified from here`);
  return found.owner?.id ?? found.owner;
}

// Whether anything answers on the entry port NOW. A probe that cannot say is "not served", never a throw.
async function entryServed(ctx, view) {
  try {
    return (await ctx.probe.tcp(entryOf(view).port))?.ok === true;
  } catch (e) {
    if (e instanceof Refused) throw e;
    return false;
  }
}
