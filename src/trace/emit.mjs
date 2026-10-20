// EMIT a trail event -- the one way anything writes to the session trail.
//
// A producer says WHAT happened (a type from src/trace/events.mjs and its data)
// and nothing else: when, which session, which project and a unique id are
// stamped here, from what the composition root bound. Switched off -- the plugin
// option `trace`, or ORBIT_TRACE=off -- it is a function that does nothing, so a
// producer never has to ask whether anybody is listening.
//
// In-process LISTENERS are the second half of the Observer: each is isolated,
// so one that throws costs only itself, and none of them can stop the append.
// Across processes -- a hook, a command, Orbit Control -- the log is the only
// channel, which is the point of an append-only log.
import { randomBytes } from "node:crypto";
import { sha } from "../hash.mjs";
import { eventOf } from "./events.mjs";

// deps: { log, now, session?, project?, on?, listeners? }
export function createEmitter(deps) {
  if (deps.on === false) return () => null;
  return (type, data = {}, meta = {}) => emitted(deps, type, data, meta);
}

function emitted(deps, type, data, meta) {
  const event = eventOf(type, data, { ...deps.meta, ...meta, id: deliveryId(deps, type, meta), at: deps.now(), session: meta.session ?? deps.session ?? null, project: meta.project ?? deps.project ?? null });
  if (!event) return null;
  deps.log.append(event);
  for (const listener of deps.listeners ?? []) isolated(() => listener(event));
  return event;
}

// Time-ordered and unique across processes on one machine: two hooks in the
// same millisecond still get two ids.
const idOf = (deps) => `e-${Date.parse(deps.now()).toString(36)}-${randomBytes(4).toString("hex")}`;

function isolated(fn) {
  try { fn(); }
  catch { /* a listener's failure is its own; the event is already kept */ }
}

const deliveryId = (deps, type, meta) => meta.delivery ? `h-${sha(JSON.stringify([meta.session ?? deps.session, meta.turn, meta.delivery, type, meta.slot ?? 0]))}` : idOf(deps);
