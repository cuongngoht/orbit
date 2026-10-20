// Binding the ARCHITECTURE store, and the source tree it reasons about.
//
// The same containment rule src/learn/context.mjs follows, and for the same
// reason: resolving the machine store touches the filesystem and can end in
// Blocked, so a laptop with an unwritable home must not gain the ability to stop
// `run-case`. Only the commands that need architecture build this.
//
// The source port is built HERE rather than taken from ctx, because the roots
// differ. `ctx.frontend` is bound to whatever the project declared as its
// frontend checkout, and its `commit()` is what dates a map record -- changing
// which root that picks would change what `query check` calls drift. Architecture
// asks about a wider tree, so it builds its own instance of the same port over
// its own roots. One port, two bindings, one definition of `commit()`.
import { createSourceTree } from "../frontend/composite.mjs";
import { createArchitecture } from "./store.mjs";
import { machineContext } from "../store/context.mjs";
import { withStoredConfig } from "./source.mjs";

export function architectureContext(ctx, env = process.env, deps = {}) {
  const { store, io, sink } = machineContext(ctx, env, deps);
  const arch = createArchitecture(store.root, io);
  sink.note = (f) => arch.addFinding(f);
  return { ...ctx, arch, store, io, source: withStoredConfig(deps.source ?? createSourceTree(scanRoots(ctx)), ctx.project) };
}

// The repository that holds ui-tests/, plus any frontend checkout the project
// declared -- deduped, and with any root that lives INSIDE another dropped.
//
// That last part is what keeps the common case simple: a project whose
// ui-tests/ sits in the product repo, with `frontend.roots` pointing at a
// subdirectory of the same checkout, is ONE tree and gets one set of scope keys.
// Only a genuinely separate checkout survives as a second root -- and it is
// READ, through src/frontend/composite.mjs, with its paths namespaced
// `<alias>::`. Before that existed a second root was returned here and then
// silently dropped by a port that kept only the first.
export function scanRoots(ctx) {
  const all = [ctx.project.root, ...(ctx.config.frontend.roots ?? [])].filter(Boolean);
  return [...new Set(all)].filter((r, _, list) => !list.some((other) => other !== r && within(r, other)));
}

const within = (dir, outer) => dir.startsWith(outer.endsWith("/") ? outer : `${outer}/`);
