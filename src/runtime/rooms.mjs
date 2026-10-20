// WHERE the runtime subject keeps what it keeps, as pure functions of the store
// root, the checkout and the host -- so the registry, the ports a second project
// is asked about, and a test all spell a path one way.
//
// Two rooms per checkout, split by how long they last and who they are about:
//
//   <storeRoot>/checkouts/<checkout>/             DURABLE: what the checkout needs (the
//                                                 understanding), what was proposed for
//                                                 it, the environments it has, and what a
//                                                 person set. Shared by every host that
//                                                 keeps this store.
//   <storeRoot>/runtime/<host>/checkouts/<checkout>/   LIVE: what is running or was, on THIS
//                                                 host -- a session per started process,
//                                                 its logs, the last probe. Per host
//                                                 because a pid means nothing on another
//                                                 machine.
//
// Neither is inside the repository, and nothing here reads a checkout: every
// function takes values and returns a path, containment being the guarded io's
// job (src/store/guard.mjs).
import { join } from "node:path";
import { safeName } from "../project/paths.mjs";

export const durableRoom = (storeRoot, checkout) => join(storeRoot, "checkouts", checkout);

export const liveRoom = (storeRoot, host, checkout) => join(storeRoot, "runtime", safeName(host), "checkouts", checkout);

export const understandingRoom = (storeRoot, checkout) => join(durableRoom(storeRoot, checkout), "understanding");

export const proposalsRoom = (storeRoot, checkout) => join(durableRoom(storeRoot, checkout), "proposals");

export const instancesRoom = (storeRoot, checkout) => join(durableRoom(storeRoot, checkout), "instances");

export const settingsFile = (storeRoot, checkout) => join(durableRoom(storeRoot, checkout), "settings.json");

export const sessionsRoom = (live) => join(live, "sessions");

export const logsRoom = (live) => join(live, "logs");

// What was last observed of each connectivity target, from each location: per host, because a
// network is this machine's, and in a room of its own with its own lock, so a check that waits
// between attempts never holds up a start (src/runtime/exclusive.mjs locks the live room).
export const connectivityRoom = (live) => join(live, "connectivity");

export const probesFile = (live) => join(connectivityRoom(live), "probes.json");

// ---- sandboxes: a task's own environment ---------------------------------------------------------
//
// A sandbox is a CHECKOUT-scoped fact (it inherits the checkout's identity and store) with a room of its
// own, so releasing one removes one directory and nothing else. Its document is not in the instances room:
// every reader of a person's dev container asks that room for "the first devcontainer instance".

export const sandboxesRoom = (storeRoot, checkout) => join(durableRoom(storeRoot, checkout), "sandboxes");

export const sandboxRoom = (storeRoot, checkout, id) => join(sandboxesRoom(storeRoot, checkout), id);

// What Orbit understood of THE TASK'S WORKSPACE: its own room, because a task may change a manifest, a
// launch profile or a definition file that the checkout's understanding still reads the old way.
export const sandboxUnderstandingRoom = (storeRoot, checkout, id) => join(sandboxRoom(storeRoot, checkout, id), "understanding");

// Live, per host: a sandbox's connectivity answers and its operations journal.
export const sandboxLiveRoom = (live, id) => join(live, "sandboxes", id);

export const operationsRoom = (sandboxLive) => join(sandboxLive, "operations");

// Port leases are the MACHINE's, not a project's: two projects both want 42000, and only one may have it.
// Per host (a port means nothing on another machine), in a room with its own lock so a lease never waits on
// a start's lock.
export const leasesRoom = (hostsRoom, host) => join(hostsRoom, safeName(host), "ports");

export const leasesFile = (room) => join(room, "leases.json");
