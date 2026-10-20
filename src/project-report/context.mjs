// WHICH project a report is for, and what of its store a report reads -- the
// pure-ish half the composition roots (cli/project-report.mjs, Orbit Control)
// share, taking env, cwd and io as parameters.
//
// A report does not need the UI-test setup: a checkout nobody ran `init` in is
// still a project, keyed by its Git identity exactly as `init` would key it, so
// the report room it gets today is the room it keeps after an `init`. Outside
// any Git checkout there is no project to report on, and it says so.
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { Refused } from "../errors.mjs";
import { loadExtensions } from "../extensions/loader.mjs";
import { emptyRegistries } from "../extensions/registries.mjs";
import { createQcTools } from "../extensions/store.mjs";
import { loadProject } from "../project/index.mjs";
import { repositoryPaths } from "../project/repository.mjs";
import { machineContext } from "../store/context.mjs";
import { reportRoom } from "./store.mjs";

// -> { project { name, key, root, reportsDir, initialized }, store, io, room }
export function reportProject(env, cwd, deps = {}) {
  const found = initialized(env, cwd) ?? bare(env, cwd);
  const machine = machineContext({ project: found.paths, config: found.config }, env, deps);
  const project = { name: found.config?.name ?? basename(found.paths.root), key: found.paths.storeKey ?? machine.store.key, root: found.paths.root, reportsDir: found.config?.reports ?? found.paths.reportsDir ?? `${found.paths.root}/ui-tests/reports`, initialized: configured(found.paths) };
  return { project, store: machine.store, io: machine.io, prepare: machine.prepare, room: reportRoom(machine.store.root) };
}

// Whether the UI-test setup exists: a project.json where this project's test data lives (the store or the
// checkout, src/project/data-home.mjs). Every checkout resolves to a project since 1.8.9, so a config having been
// loaded no longer says that anything was set up.
const configured = (paths) => Boolean(paths.dataRoot) && existsSync(join(paths.dataRoot, "project.json"));

function initialized(env, cwd) {
  const p = unlessRefused(() => loadProject(env, cwd));
  return p ? { paths: p, config: p.config } : null;
}

function unlessRefused(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Refused) return null;
    throw e;
  }
}

function bare(env, cwd) {
  const paths = repositoryPaths(cwd, env);
  if (!paths) throw new Refused(`${cwd} is not inside a Git checkout; run the report from the project's checkout, where its source and its settings belong`);
  return { paths, config: null };
}

// What the project's extensions declare for reports, read as DATA: none of
// their code is imported (src/extensions/loader.mjs `dataOnly`).
// -> { parts, states: { id: { status, dir, version, createdFor } }, contested, refused }
export async function reportExtensions(storeRoot, io) {
  const ctx = { ...emptyRegistries(), store: () => storeRoot };
  const out = await loadExtensions(ctx, { io, dataOnly: true });
  const tools = createQcTools(storeRoot, io);
  const states = Object.fromEntries(out.loaded.filter((e) => e.reportParts?.length).map((e) => [e.id, { status: e.status, dir: tools.dirOf(e.id), version: e.version, createdFor: tools.entry(e.id)?.createdFor ?? null }]));
  return { parts: ctx.reporting.parts(), states, contested: ctx.reporting.contested(), refused: out.refused, room: out.room };
}
