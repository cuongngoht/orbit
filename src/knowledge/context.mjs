// Binding the KNOWLEDGE room to a real store, with everything else handed IN.
//
// src/intelligence/context.mjs's rule, for its reason: which trees a project's
// code lives in is asked ONCE (src/architecture/context.mjs `scanRoots`) by the
// composition root, which hands the source port in -- so there is no second
// definition of that question here, and no lateral edge into architecture.
// The same goes for everything knowledge reasons over that another subsystem
// owns: the gates, the tracked listing, the working set, the cases, the
// resource registry, the host's memory. cli/knowledge.mjs binds them; nothing
// under src/knowledge/ imports architecture, engineering, intelligence, qa or
// learn.
//
// What the store noticed while reading -- an unreadable claim, a torn state
// file -- is kept for a view to print, never written: reading must not write.
import { Refused } from "../errors.mjs";
import { machineContext } from "../store/context.mjs";
import { createKnowledge } from "./store.mjs";

export function knowledgeContext(ctx, env = process.env, deps = {}) {
  if (!deps.source) throw new Refused("knowledge needs a source tree handed in — the composition root decides which checkouts a project spans");
  const { store, io, sink } = machineContext(ctx, env, deps);
  const know = createKnowledge(store.root, io);
  return { ...ctx, know, store, io, notes: collected(sink), source: deps.source };
}

function collected(sink) {
  const notes = [];
  sink.note = (f) => notes.push(f);
  return notes;
}
