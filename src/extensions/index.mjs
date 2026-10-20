// The composition step that turns a core-only context into THIS project's.
//
// It is separate from createContext for one reason: importing a module is async
// and everything else in this engine is not. Keeping the async in one named call
// the entry points await means no port, no verb and no rule ever became a
// promise, which is the change that would have rippled through every file.
//
// After it, `ctx.dsl`, `ctx.executors`, `ctx.capabilities`, `ctx.validators` and
// `ctx.knowledge` hold core plus whatever the project registered, and
// `ctx.extensions` says what loaded, what did not, and why -- because the
// likeliest cause of the NEXT confusing error is an extension that quietly
// failed to load before it.
import { agree } from "../run/verbs/index.mjs";
import { loadExtensions } from "./loader.mjs";

export { loadExtensions } from "./loader.mjs";
export { createQcTools, qcToolPaths } from "./store.mjs";
export { manifestFindings, isLoadable } from "./manifest.mjs";
export { EXTENSION_API, CAPABILITY_API, LOADABLE, MANIFEST_FILE } from "./contract.mjs";
export { createKnowledgeParts } from "./knowledge-parts.mjs";
export { emptyRegistries } from "./registries.mjs";

export async function withExtensions(ctx, deps = {}) {
  const extensions = await loadExtensions(ctx, deps);
  agree(ctx.dsl, ctx.executors);
  return { ...ctx, extensions };
}
