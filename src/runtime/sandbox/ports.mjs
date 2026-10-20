// PORT LEASES: a port a sandbox may use is LEASED, never taken.
//
// Two tasks and a developer all want the port their application's files declare. The first one to start
// holds it, and the rest need another -- which only a record, kept by the one thing every project on this
// machine shares, can give without two of them being told the same one. So the record is the MACHINE's
// (`<storeBase>/control/hosts/<host>/ports/leases.json`, src/runtime/rooms.mjs `leasesRoom`), per host
// because a port means nothing on another machine, written under its own lock so that taking a port never
// waits on a start.
//
// A lease is a receipt: it names an owner (a task), the sandbox and the component, and the time. It is
// written BEFORE anything listens, so a crash between "decided" and "listening" leaves a lease nobody uses
// rather than a port two tasks were given. It is never a claim on a port something else holds: a candidate
// that answers a connection is somebody's and is passed over, and nothing here frees, moves or signals it.
//
// A lease is let go when its sandbox is RELEASED (or, for a sandbox of another checkout this cannot read,
// when it is old and nothing runs on its port) -- never because a start failed to look.
import { withLockAsync } from "../../store/lock.mjs";
import { readState, writeState } from "../../store/control.mjs";
import { leasesFile } from "../rooms.mjs";

export const LEASES_SCHEMA = 1;

// How many ports are PROBED for one lease: a range of two thousand is never walked in full.
export const MAX_CANDIDATES = 32;

// A launch that finds its leased port taken after all (something bound it between the lease and the start)
// releases it and takes the next candidate, this many times, and then is blocked.
export const RETRIES = 3;

// A lease belonging to a sandbox of ANOTHER checkout cannot be judged from here, so it is let go only when it
// has been idle this long and no running session holds its port.
export const ABANDONED_MS = 24 * 60 * 60 * 1000;

const BUSY = "another sandbox is taking a port at this moment";

const wellFormed = (l) => Number.isInteger(l?.port) && typeof l.env === "string" && typeof l.requestedAt === "string" && l.owner?.kind === "task";

// Ordered; the first row that matches decides, and the last always matches. `facts` is what the caller can say
// of ONE lease: `own` (the sandbox's state when it is a sandbox of this checkout, or undefined when this cannot
// tell), `running` (a session of Orbit's runs on the port), `age` (ms).
export const STALE_LEASES = [
  { name: "OWNER_RELEASED", when: (f) => f.own === "RELEASED" || f.own === null, stale: true, say: "its sandbox was released, or is gone" },
  { name: "ABANDONED", when: (f) => f.own === undefined && f.age > ABANDONED_MS && !f.running, stale: true, say: "nothing has run on it for a day, and its sandbox is not one this checkout can read" },
  { name: "KEPT", when: () => true, stale: false, say: "its sandbox may still use it" },
];

export const staleOf = (facts) => STALE_LEASES.find((r) => r.when(facts)).stale;

// A candidate is FREE only when the machine said, in so many words, that nothing listens there (the connection was
// refused). A connection that was denied (a host's sandbox may not let a process connect at all), that timed out, or
// that a forwarder accepted and closed says nothing of the sort -- and "I could not tell" is never "nobody's": a port
// somebody holds must not be leased because a probe was not allowed to see them.
const NOBODY = /ECONNREFUSED/;

export const nobodyListens = (answer) => answer?.ok === false && NOBODY.test(String(answer.error ?? ""));

// What is asked of one candidate port, in order.
const CANDIDATE = [
  { name: "LEASED", when: (c) => c.leased.has(c.port), takes: false, say: "another sandbox holds a lease on it" },
  { name: "HELD", when: (c) => c.answers, takes: false, say: "something answers there, or the machine would not say that nothing does: it is somebody's" },
  { name: "FREE", when: () => true, takes: true, say: "nothing holds it and nobody leased it" },
];

export const candidateRow = (c) => CANDIDATE.find((r) => r.when(c));

// `room` is the leases room, `io` the machine's raw store io, `judge(lease) -> facts` says what the caller knows.
export function createLeases(room, io, { host, now, judge = () => ({}) }) {
  const file = leasesFile(room);
  const read = () => readState(io, file, { leases: [] }, LEASES_SCHEMA).leases.filter(wellFormed);
  const write = (leases) => writeState(io, file, { leases, host }, LEASES_SCHEMA);
  const locked = (fn) => (io.ensureDir(room), withLockAsync(room, fn, io, BUSY));
  return { list: () => read(), stale: () => read().filter((l) => staleOf({ age: Date.parse(now()) - Date.parse(l.requestedAt), ...judge(l) })), acquire: (want, deps) => locked(() => acquired(read, write, want, deps, { now, judge })), release: (match) => locked(() => released(read, write, match)), file };
}

// What stays after the leases nobody can need any more are let go.
const kept = (leases, now, judge) => leases.filter((l) => !staleOf({ age: Date.parse(now()) - Date.parse(l.requestedAt), ...judge(l) }));

async function acquired(read, write, want, deps, { now, judge }) {
  const live = kept(read(), now, judge);
  const port = await firstFree(want, new Set(live.map((l) => l.port)), deps);
  return port === null ? { lease: null, because: `no port from ${want.from} to ${want.to} is free to lease on this machine (looked at ${MAX_CANDIDATES})` } : leased(write, live, leaseOf(want, port, now()));
}

const leased = (write, live, lease) => (write([...live, lease]), { lease });

const leaseOf = (want, port, requestedAt) => ({ port, owner: want.owner, env: want.env, checkout: want.checkout, project: want.project, component: want.component, requestedAt, host: want.host });

// The first candidate in the range that is neither leased nor answering, looking at no more than MAX_CANDIDATES.
async function firstFree({ from, to, exclude = [] }, leased, deps) {
  let probed = 0;
  for (let port = from; port <= to && probed < MAX_CANDIDATES; port++) {
    if (exclude.includes(port) || leased.has(port)) continue;
    probed++;
    if (candidateRow({ port, leased, answers: !nobodyListens(await deps.probe.tcp(port)) }).takes) return port;
  }
  return null;
}

// Every lease of `owner` in `env` (and one `component` when named), let go. -> the leases that were
function released(read, write, { env, owner, component }) {
  const all = read();
  const mine = (l) => l.env === env && l.owner.id === owner.id && (!component || l.component === component);
  write(all.filter((l) => !mine(l)));
  return all.filter(mine);
}
