// A WORKER'S LEASE on one action whose provider runs OUTSIDE the mission's lock (a spawned owner): written before the
// call (running/<act>.json: who holds it -- host, pid and the pid's start time -- and a random token), and checked
// again before the result is written. A worker whose lease was taken -- reconcile closed the action while it ran --
// is FENCED: it writes nothing, and never settles another worker's action.
import { randomUUID } from "node:crypto";
import { Refused } from "../../../src/errors.mjs";
import { writeAtomic } from "../../../src/store/atomic.mjs";
import { missionFile } from "../store/rooms.mjs";
import { quietly, refused } from "../store/text.mjs";

export const LEASE_SCHEMA = 1;

export const leaseFile = (rooms, id, action) => missionFile(rooms, id, "running", `${action}.json`);

export function claimLease(ports, id, action) {
  const lease = { schema: LEASE_SCHEMA, action, token: randomUUID(), host: ports.host, pid: ports.pid, pidStartedAt: ports.pidStartedAt(), session: ports.session ?? null, at: ports.now() };
  writeAtomic(leaseFile(ports.rooms, id, action), `${JSON.stringify(lease, null, 2)}\n`, ports.io, false);
  return lease;
}

export const readLease = (ports, id, action) => quietly(() => JSON.parse(ports.io.read(leaseFile(ports.rooms, id, action)) ?? "null"));

export function releaseLease(ports, id, action, token) {
  const lease = readLease(ports, id, action);
  if (lease && (token === undefined || lease.token === token)) ports.io.removeFile(leaseFile(ports.rooms, id, action));
}

export function fencedUnlessHeld(ports, id, action, token) {
  if (readLease(ports, id, action)?.token !== token) throw refused(Refused, "FENCED", `${action} was settled by another worker (reconcile) while this one ran; nothing was written`);
}
