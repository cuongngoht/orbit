// Binding the INTELLIGENCE store, the registry and the source tree.
//
// Two things are handed IN rather than built here, and each for the reason the
// rest of this engine hands such things in:
//
//   the REGISTRY  -- what this engine recognises. The core registers nothing of
//                    its own; the caller composes the built-in ecosystems, the
//                    shipped packs and a project's own descriptors. That is
//                    what keeps every ecosystem and every product out of
//                    src/intelligence/.
//   the SOURCE    -- which trees a project's code lives in is asked ONCE, by
//                    src/architecture/context.mjs `scanRoots`. The composition
//                    root asks it and hands the port in, so no second
//                    definition of the question appears here -- and no new
//                    lateral edge into architecture either.
import { Refused } from "../errors.mjs";
import { machineContext } from "../store/context.mjs";
import { loadProjectDescriptors } from "./descriptors.mjs";
import { createIntelligence } from "./store.mjs";

export function intelligenceContext(ctx, registry, env = process.env, deps = {}) {
  if (!deps.source) throw new Refused("intelligence needs a source tree handed in — the composition root decides which checkouts a project spans");
  const { store, io, sink } = machineContext(ctx, env, deps);
  const intel = createIntelligence(store.root, io);
  return { ...ctx, intel, store, io, registry, notes: collected(sink), descriptors: loadProjectDescriptors(intel, registry), source: deps.source };
}

// What the store noticed while reading -- an unreadable fact, a torn state
// file -- kept for a view to print rather than dropped.
function collected(sink) {
  const notes = [];
  sink.note = (f) => notes.push(f);
  return notes;
}
