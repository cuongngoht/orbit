// Binding the REQUIREMENTS room to a real store, with nothing else handed in.
//
// Requirement intelligence needs no source tree, no git and no registry: what a
// requirement should be is not something a checkout can be measured against, and
// nothing here may look. The composition roots bind sources, connections and the
// resolver around this; none of them is imported here.
//
// What the store noticed while reading -- an unreadable fact, a torn document -- is kept
// for a view to print, never written: reading must not write.
import { machineContext } from "../store/context.mjs";
import { createRequirements } from "./store.mjs";

export function requirementsContext(ctx, env = process.env, deps = {}) {
  const { store, io, sink } = machineContext(ctx, env, deps);
  const requirements = createRequirements(store.root, io);
  return { ...ctx, requirements, store, io, notes: collected(sink) };
}

function collected(sink) {
  const notes = [];
  sink.note = (f) => notes.push(f);
  return notes;
}
