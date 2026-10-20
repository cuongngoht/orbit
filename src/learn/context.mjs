// Binding the LESSON store: the machine store, plus the room lessons keep in it.
//
// Where that store is and whether it can be written at all is
// src/store/context.mjs -- the same question architecture asks, answered once.
// All that is left here is the part that is about lessons.
import { fromEnv } from "../project/env.mjs";
import { createLessons } from "./lessons.mjs";
import { machineContext } from "../store/context.mjs";

export { insideRepo, writable } from "../store/context.mjs";

export function learnContext(ctx, env = process.env, deps = {}) {
  const { store, io, sink } = machineContext(ctx, env, deps);
  return { ...ctx, ...bound(store, io, sink, env) };
}

// Late-bound on purpose: the store is built FROM the io, so the io cannot hold a
// reference to the store when it is made. A finding raised while reading an
// unreadable lesson then still lands in the store, and outlives the command.
function bound(store, io, sink, env) {
  const learn = createLessons(store.root, io, { envOff: offSwitch(env) });
  sink.note = (f) => learn.addFinding(f);
  return { learn, store, io };
}

const offSwitch = (env) => (String(fromEnv(env, "LEARN") ?? "").toLowerCase() === "off" ? "ORBIT_LEARN=off" : null);
