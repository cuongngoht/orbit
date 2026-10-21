// Binding the RUNTIME subject to a real checkout, a real store and whatever ports
// the composition root hands in -- and nothing it does not.
//
// The same shape src/architecture/context.mjs and src/requirements/context.mjs
// have: this reads no process.env, spawns nothing and opens no socket on its own.
// The Process port, the probe, the machine, the source tree, the working tree, the
// ecosystem registry and the catalog all arrive in `deps`, built by cli/runtime.mjs
// (and by Orbit Control for a checkout a person chose), so a test binds the same
// thing to fakes and the engine never learns which it is holding.
//
// A checkout needs no ui-tests/ to be understood. A repository nobody ran `init` in
// is still a project, keyed by its Git identity exactly as `init` would key it
// (src/project/repository.mjs) -- so `runtime discover` is read-only in the repository
// from the first command, and a project that is set up later keeps the room it
// already has. Outside a Git checkout there is no project, and it says so.
import { basename } from "node:path";
import { Refused } from "../errors.mjs";
import { loadProject } from "../project/index.mjs";
import { repositoryPaths } from "../project/repository.mjs";
import { machineContext } from "../store/context.mjs";
import { stateRooms } from "../store/control.mjs";
import { createRegistry } from "../store/registry.mjs";
import { createInstances, instanceId } from "./instances.mjs";
import { createProposals } from "./proposal.mjs";
import { PROVIDERS } from "./providers/index.mjs";
import { durableRoom, instancesRoom, liveRoom, proposalsRoom, sandboxesRoom, settingsFile, understandingRoom } from "./rooms.mjs";
import { createSessions } from "./sessions.mjs";
import { createObservations } from "./connectivity/observations.mjs";
import { readSettings, writeSettings } from "./settings.mjs";
import { createRuntimeStore } from "./store.mjs";

// -> { paths, config } for the checkout `cwd` is in. `config` is null when it has
// no ui-tests/project.json, which is a valid state and not an error.
export function runtimeProject(env, cwd) {
  const initialized = unlessRefused(() => loadProject(env, cwd));
  if (initialized) return { paths: initialized, config: initialized.config };
  const paths = repositoryPaths(cwd, env);
  if (!paths) throw new Refused(`${cwd} is not inside a Git checkout; run it from the project's checkout, where its source is`);
  return { paths, config: null };
}

function unlessRefused(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Refused) return null;
    throw e;
  }
}

// `deps`: { source, tree, process, probe, reach, machine, ecosystems, catalog, raw, capabilities?, read?, sleep?, clock?, host?, machineDeps? }
export function runtimeContext(found, env, deps) {
  const { paths } = found;
  if (paths.layout !== 3 || !paths.checkoutId) throw new Refused("the runtime subject works from a Git checkout, which a loose ui-tests/ directory is not");
  const machine = machineContext({ project: paths, config: found.config ?? {} }, env, deps.machineDeps ?? {});
  return assembled({ found, paths, machine, env, deps });
}

function assembled({ found, paths, machine, env, deps }) {
  const host = deps.host ?? machine.io.host;
  const rooms = roomsOf(paths, host);
  const stores = storesOf(machine.io, rooms, paths);
  const clock = deps.clock ?? (() => Date.now());
  return { ...stores, ...ports(deps), workspaces: workspacesOf(deps, machine.io, paths, host), io: machine.io, raw: deps.raw, rooms, prepare: machine.prepare, notes: machine.sink, providers: deps.providers ?? PROVIDERS, registry: createRegistry(stateRooms(paths.storeBase), deps.raw), pluginRoot: deps.pluginRoot ?? null, isolation: deps.isolation ?? null, supervisorArgv: deps.supervisorArgv ?? null, storeBase: paths.storeBase, storeRoot: paths.storeRoot, checkout: paths.checkoutId, host, root: paths.root, name: found.config?.name ?? basename(paths.root), envId: instanceId({ checkout: paths.checkoutId, kind: "human", name: "native" }), owner: { kind: "human" }, env, clock, now: () => new Date(clock()).toISOString(), sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))), project: paths, config: found.config, ...settingsOf(machine.io, rooms, host, clock), read: deps.read, capabilities: deps.capabilities ?? (() => ({})) };
}

// The WORKSPACES a task owns, as a port: `found(task)` (its id and path, or null), `tree(task)` (its source
// tree as it is now), `sourceOf(path)` (a source port that reads what the workspace HOLDS, not HEAD) and
// `treeOf(path)` (its working tree). The workspace owner is src/orchestration/workspace.mjs, which this
// subject may not import, so the composition root hands in a factory and the context binds it to this
// checkout's io and host. No factory is no workspaces: a sandbox then has nothing to run, and says so.
const workspacesOf = (deps, io, paths, host) => deps.workspaces?.({ io, paths, host }) ?? null;

const ports = (deps) => ({ source: deps.source, tree: deps.tree, process: deps.process, probe: deps.probe, reach: deps.reach, machine: deps.machine, ecosystems: deps.ecosystems, catalog: deps.catalog, browserTool: deps.browserTool ?? null });

function roomsOf(paths, host) {
  return { durable: durableRoom(paths.storeRoot, paths.checkoutId), sandboxes: sandboxesRoom(paths.storeRoot, paths.checkoutId), instances: instancesRoom(paths.storeRoot, paths.checkoutId), proposals: proposalsRoom(paths.storeRoot, paths.checkoutId), live: liveRoom(paths.storeRoot, host, paths.checkoutId), settings: settingsFile(paths.storeRoot, paths.checkoutId), understanding: understandingRoom(paths.storeRoot, paths.checkoutId) };
}

const storesOf = (io, rooms) => ({ store: createRuntimeStore(rooms.understanding, io), instances: createInstances(rooms.instances, io), sandboxes: createInstances(rooms.sandboxes, io), proposals: createProposals(rooms.proposals, io), sessions: createSessions(rooms.live, io), observations: createObservations(rooms.live, io) });

const settingsOf = (io, rooms, host, clock) => ({ readSettings: () => readSettings(rooms.settings, io, host), writeSettings: (w) => writeSettings(rooms.settings, io, { host, now: new Date(clock()).toISOString(), ...w }) });
