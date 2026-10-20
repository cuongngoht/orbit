// The REACH port: can THIS machine resolve a name a PERSON configured, and open one TCP
// connection to it?
//
// Not the readiness probe (./index.mjs), which is LOOPBACK ONLY on purpose: that one is handed a
// setting a person types for a server Orbit started here, and must never become a way to make this
// machine knock on another. This one exists for the servers a checkout needs that are NOT its own
// -- a database behind a VPN, an internal API -- and its trust boundary is different and explicit:
// it is only ever handed a connectivity TARGET a person saved (src/runtime/settings.mjs: a host
// name or an address, no scheme, no credential, no path), never a host a request body named. The
// runtime asks it with a target it read from settings, and nothing else reaches it.
//
// What it does is the least that answers the question: a name lookup, and one connection that is
// closed the moment it is accepted. Nothing is sent and nothing a server says is read -- so whether
// a database would LET anybody in is not asked here, and not answered. An accept is the answer, with
// no hold: the hold in ./index.mjs exists for a container runtime on THIS machine that accepts a
// published port and closes it when nothing is behind it, and a remote host's accept is its own
// kernel completing the handshake, which is exactly what reachability is.
//
// Like the probe it never throws: a name that does not resolve, a refusal, a deadline spent and a
// socket that could not be made are `{ ok: false, error }`, and a spent deadline also says
// `timedOut`, because "nothing answered in time" and "it said no" send a person to different places.
import { lookup as dnsLookup } from "node:dns/promises";
import { connect as netConnect } from "node:net";
import { once } from "./index.mjs";

export const DEFAULT_REACH_TIMEOUT_MS = 3000;

export function createReach(deps = {}) {
  const io = { lookup: deps.lookup ?? dnsLookup, connect: deps.connect ?? netConnect, timeoutMs: deps.timeoutMs ?? DEFAULT_REACH_TIMEOUT_MS };
  return { resolve: (host, opts = {}) => resolved(io, String(host), opts.timeoutMs ?? io.timeoutMs), tcp: (host, port, opts = {}) => connected(io, String(host), port, opts.timeoutMs ?? io.timeoutMs) };
}

// -> { ok, addresses } | { ok: false, error, timedOut? }. A resolver that never answers is a spent
// deadline, never a hang.
function resolved(io, host, timeoutMs) {
  return new Promise((resolve) => {
    const done = once(resolve);
    const timer = setTimeout(() => done({ ok: false, timedOut: true, error: `${host} did not resolve within ${timeoutMs / 1000}s` }), timeoutMs);
    looked(io, host).then((answer) => (clearTimeout(timer), done(answer)));
  });
}

async function looked(io, host) {
  try {
    const all = await io.lookup(host, { all: true });
    return { ok: true, addresses: Array.isArray(all) ? all.length : 1 };
  } catch (e) {
    return { ok: false, error: `${host} did not resolve (${e?.code ?? e?.message ?? e})` };
  }
}

// -> { ok } | { ok: false, error, timedOut? }
function connected(io, host, port, timeoutMs) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.resolve({ ok: false, error: `${port} is not a port` });
  return new Promise((resolve) => opened(io, host, port, timeoutMs, resolve));
}

function opened(io, host, port, timeoutMs, resolve) {
  const where = `${host}:${port}`;
  const made = attempted(() => io.connect({ host, port }));
  if (made.error) return resolve({ ok: false, error: `${where} could not be asked (${made.error})` });
  const done = once((answer) => (made.socket.destroy(), resolve(answer)));
  watched(made.socket, done, where, timeoutMs);
}

function attempted(make) {
  try {
    return { socket: make() };
  } catch (e) {
    return { error: e?.message ?? String(e) };
  }
}

// Connected is the answer, and the socket is closed at once: nothing is written, and no `data`
// listener is ever attached.
function watched(socket, done, where, timeoutMs) {
  socket.setTimeout?.(timeoutMs);
  socket.on("connect", () => done({ ok: true }));
  socket.on("timeout", () => done({ ok: false, timedOut: true, error: `nothing answered on ${where} within ${timeoutMs / 1000}s` }));
  socket.on("error", (e) => done({ ok: false, error: `${where} could not be reached (${e?.code ?? e?.message ?? e})` }));
}
