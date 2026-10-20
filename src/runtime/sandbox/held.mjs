// The lease room, as THIS context sees it: the machine's file of port leases, with what this checkout can say about a lease
// so that one nobody can need any more is let go (src/runtime/sandbox/ports.mjs STALE_LEASES).
import { stateRooms } from "../../store/control.mjs";
import { runningEverywhere } from "../ports.mjs";
import { leasesRoom } from "../rooms.mjs";
import { createLeases } from "./ports.mjs";

// What this context can tell of one lease: when it is one of THIS checkout's sandboxes, that sandbox's state
// (null when no document is kept for it any more); for any other checkout's, nothing -- `undefined`.
const judging = (ctx, running) => (lease) => ({ own: lease.checkout === ctx.checkout ? (ctx.sandboxes.read(lease.env)?.state ?? null) : undefined, running: running.has(lease.port) });

const portsRunning = (ctx) => new Set(runningEverywhere({ registry: ctx.registry, storeBase: ctx.storeBase, host: ctx.host, io: ctx.raw, process: ctx.process }).flatMap((r) => r.ports));

export const leasesOf = (ctx) => createLeases(leasesRoom(stateRooms(ctx.storeBase).hosts, ctx.host), ctx.raw, { host: ctx.host, now: ctx.now, judge: judging(ctx, portsRunning(ctx)) });
