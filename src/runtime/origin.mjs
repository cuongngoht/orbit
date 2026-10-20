// WHERE an approved environment says its application answers, and whether THIS checkout's
// runtime is what is meant to answer there.
//
// An investigation approves an environment by its origin (`http://localhost:5173`). When that
// origin is on this machine and a component this checkout's own files declare listens on its
// port, then "nothing answers there" is the runtime's news and not the product's: the
// application was never started. That is a BLOCKED for the person -- never a finding about the
// product -- and the sentence says which component, and what starts it.
//
// When the origin is somewhere else, or no component declares the port, this says nothing at
// all: an environment Orbit does not run is none of its business, and a project nobody has
// understood yet is silence, not a stop.
//
// It is handed what the memory already holds (the understanding's view) and the probe port.
// It reads no file, starts nothing and decides no verdict.
import { isLoopback } from "../probe/index.mjs";

const parsed = (origin) => {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
};

const DEFAULTS = { "http:": 80, "https:": 443 };

// Where an origin that is on THIS machine is -- its host and its port -- or null for anywhere else,
// and for what is no origin.
export function loopbackWhere(origin) {
  const url = parsed(origin);
  const port = url ? Number(url.port) || DEFAULTS[url.protocol] || null : null;
  return url && port && isLoopback(url.hostname) ? { host: url.hostname.replace(/^\[|\]$/g, ""), port } : null;
}

export const loopbackPort = (origin) => loopbackWhere(origin)?.port ?? null;

// `localhost` could be either family and is asked as both; an address is asked as itself.
const hostOption = (host) => (host.toLowerCase() === "localhost" ? {} : { host });

// The component a FILE says listens on this port, or null. A port that is only possible -- a
// container's exposed port, a hypothesis an agent recorded -- is not enough to say that nothing
// is where this checkout's runtime means it to be.
const declared = (p, port) => p.port === port && p.confidence !== "possible";

export const declaring = (view, port) => view.components.find((c) => c.ports.some((p) => declared(p, port))) ?? null;

const next = (key) => `start it with \`runtime start --component=${key}\`, or start it yourself, then act again`;

// -> null (nothing to say) | { component, port, served, next }
export async function originOf({ view, probe }, origin) {
  const where = loopbackWhere(origin);
  const component = where ? declaring(view, where.port) : null;
  if (!component) return null;
  const answered = await probe.tcp(where.port, hostOption(where.host));
  return { component: component.key, port: where.port, served: answered.ok === true, next: next(component.key) };
}
