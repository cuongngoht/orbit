// The capabilities ONE project registered, listed -- through the real loader
// into a throwaway context, the way `verifyTool` holds a candidate to the real
// contract. There is no second registry and no second reading of a manifest:
// what this lists is exactly what `{"do":"call"}` would resolve in a run.
//
// Asked by composition roots that only want to KNOW what is there (the prompt
// router, Orbit Control), so it is cheap when there is nothing: a project whose
// store room holds no QC tool answers [] without importing a single module.
// It never throws: a project that cannot be resolved, a store that cannot be
// read, an extension that refuses to load -- each leaves fewer capabilities,
// never an error in somebody's prompt.
import { agree } from "../run/verbs/registry.mjs";
import { machineContext } from "../store/context.mjs";
import { realIo } from "../store/io.mjs";
import { loadExtensions } from "./loader.mjs";
import { emptyRegistries } from "./registries.mjs";
import { createQcTools } from "./store.mjs";

export async function projectCapabilities(project, env) {
  try { return await listed(project, env); }
  catch { return []; }
}

async function listed(project, env) {
  const root = machineContext({ config: project.config, project }, env).store.root;
  if (!createQcTools(root, realIo()).ids().length) return [];
  const ctx = { store: () => root, ...emptyRegistries() };
  agree(ctx.dsl, ctx.executors);
  return (await loadExtensions(ctx), ctx.capabilities.list());
}
