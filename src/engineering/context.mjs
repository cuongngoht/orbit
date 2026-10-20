// Binding the ENGINEERING store, over the same source tree architecture
// already resolves.
//
// "How this project tends to build code" is asked of the same roots "what it
// structurally looks like" is asked of, so the WHICH TREES question is asked
// once, in src/architecture/context.mjs, and reused here rather than
// re-derived -- the same "reuse it, reference it, never a second definition"
// rule AGENTS.md holds architecture and engineering to.
import { createSourceTree } from "../frontend/composite.mjs";
import { createEngineering } from "./store.mjs";
import { machineContext } from "../store/context.mjs";
import { scanRoots } from "../architecture/context.mjs";
import { withStoredConfig } from "../architecture/source.mjs";

export function engineeringContext(ctx, env = process.env, deps = {}) {
  const { store, io, sink } = machineContext(ctx, env, deps);
  const eng = createEngineering(store.root, io);
  sink.note = (f) => eng.addFinding(f);
  return { ...ctx, eng, store, io, source: withStoredConfig(deps.source ?? createSourceTree(scanRoots(ctx)), ctx.project) };
}
