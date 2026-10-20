// Binding the SOURCES room to a real store, with nothing else handed in.
//
// A source needs no source tree and no git: it is what somebody else's system said,
// not something a checkout can be measured against. So unlike the knowledge room
// there is nothing to refuse here, and no other subsystem is imported -- the
// composition root (cli/requirements.mjs) binds readers, connections and the
// registry around this.
//
// What the store noticed while reading -- an unreadable record, a torn document --
// is kept for a view to print, never written: reading must not write.
import { machineContext } from "../store/context.mjs";
import { createSources } from "./store.mjs";

export function sourcesContext(ctx, env = process.env, deps = {}) {
  const { store, io, sink } = machineContext(ctx, env, deps);
  const sources = createSources(store.root, io);
  return { ...ctx, sources, store, io, notes: collected(sink) };
}

function collected(sink) {
  const notes = [];
  sink.note = (f) => notes.push(f);
  return notes;
}
