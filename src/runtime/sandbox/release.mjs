// RELEASING a sandbox: ending what a task owns of it, and nothing else.
//
// What a sandbox owns is what its OWN ownership proof says: the sessions whose receipt, pid and start time agree
// (src/runtime/ownership.mjs), the port leases written in its name, and the containers carrying its labels. A
// developer's server on the same port, another task's sandbox, a service somebody else runs, and anything that
// cannot be PROVEN Orbit's are not here and are not touched. A session that would not stop is said, and the rest
// still goes: refusing to release because one thing would not stop would leave the leases and the containers.
import { Refused } from "../../errors.mjs";
import { moved } from "../instances.mjs";
import { operationsRoom, sandboxLiveRoom } from "../rooms.mjs";
import { providerOf } from "../providers/index.mjs";
import { stop } from "../lifecycle/stop.mjs";
import { leasesOf } from "./held.mjs";
import { createOperations } from "./operations.mjs";
import { teardown } from "./supervise.mjs";

const opsOf = (ctx) => createOperations(operationsRoom(sandboxLiveRoom(ctx.rooms.live, ctx.envId)), ctx.io, ctx.now);

// The containers this sandbox brought up, by its labels. Only asked when it placed something on one.
const containersOf = (ctx, deps) => (Object.values(ctx.sandboxDoc().placements ?? {}).includes("devcontainer") ? providerOf("devcontainer", ctx.providers).down({ checkout: ctx.checkout, envId: ctx.envId }, deps) : null);

// -> { released, environment, why?, stopped, gone, refused, leases, containers }
export async function released(ctx, deps, hooks = {}) {
  const doc = ctx.sandboxes.read(ctx.envId);
  if (!doc) return { released: false, environment: ctx.envId, reason: "NONE", why: "this task has no sandbox here: there is nothing to release", stopped: [], gone: [], refused: [], leases: [], containers: null };
  if (doc.state === "RELEASED") return { released: false, environment: ctx.envId, reason: "RELEASED", why: "it was released already", stopped: [], gone: [], refused: [], leases: [], containers: null };
  if (doc.state === "QUARANTINED" && ctx.door !== "control") throw new Refused("this sandbox is QUARANTINED: its teardown could not be proven, and only a person releases it, in Orbit Control, after looking at what was left");
  return doc.isolation?.mode === "required" ? isolatedReleased(ctx, deps, hooks) : ended(ctx, deps, opsOf(ctx));
}

// An ISOLATED sandbox is torn down in the one order that keeps evidence and takes nothing that is not proven its own
// (src/runtime/sandbox/supervise.mjs TEARDOWN). What could not be proven leaves it QUARANTINED -- and when a person
// releases a quarantined one from Control, it is RELEASED with what was left said, for the person to deal with.
async function isolatedReleased(ctx, deps, hooks) {
  const ops = opsOf(ctx);
  const op = ops.begin("teardown");
  const done = await teardown(ctx, deps, hooks);
  ops.settle(op, done.state === "RELEASED" ? "DONE" : "FAILED", done.left.map((l) => `${l.step}: ${l.because}`).join("; ") || null);
  return done.state === "QUARANTINED" && ctx.door === "control" ? personReleased(ctx, done) : { released: done.state === "RELEASED", environment: ctx.envId, reason: done.state, why: done.left.map((l) => `${l.step}: ${l.because}`).join("; ") || null, stopped: [], gone: [], refused: done.left, leases: [], containers: null, teardown: done.steps.map((s) => ({ step: s.id, ok: s.ok, say: s.say })) };
}

function personReleased(ctx, done) {
  ctx.sandboxes.write(moved(ctx.sandboxes.read(ctx.envId), "RELEASED", ctx.now(), { endpoints: [], blocked: null, lastActiveAt: ctx.now() }));
  return { released: true, environment: ctx.envId, reason: "RELEASED_BY_PERSON", why: `released by a person in Orbit Control; left as it was: ${done.left.map((l) => `${l.step}: ${l.because}`).join("; ")}`, stopped: [], gone: [], refused: done.left, leases: [], containers: null, teardown: done.steps.map((s) => ({ step: s.id, ok: s.ok, say: s.say })) };
}

async function ended(ctx, deps, ops) {
  const op = ops.begin("release");
  const sessions = await stop(ctx, {});
  return sessions.refused.length ? kept(ctx, ops, op, sessions) : everything(ctx, deps, ops, op, sessions);
}

async function everything(ctx, deps, ops, op, sessions) {
  const letGo = await freed(ctx, deps);
  ops.settle(op, "DONE");
  return { released: true, environment: ctx.envId, stopped: sessions.stopped, gone: sessions.gone, refused: [], ...letGo };
}

// Something this sandbox started would not stop (or cannot be PROVEN its own, so it is never stopped): the port it
// listens on is still held, and a lease or a container let go now would hand the port, and the machine, to whatever
// asks next. So nothing else is let go, the sandbox is not released, and who has to act is said -- a person closes a
// receipt that cannot be proven with `runtime stop --release=<session> --human`, which kills nothing, and releases then.
function kept(ctx, ops, op, sessions) {
  ops.settle(op, "FAILED", `${sessions.refused.length} session(s) would not stop`);
  return { released: false, reason: "REFUSED", environment: ctx.envId, why: `${sessions.refused.map((r) => `${r.component}: ${r.why}`).join("; ")} — nothing else was let go while it holds its port`, stopped: sessions.stopped, gone: sessions.gone, refused: sessions.refused, leases: [], containers: null };
}

// After its sessions: the leases in its name, the containers with its labels, and the document, which is kept (the
// room stays: what was understood of the workspace is memory, and a person may want to see why it was stale).
async function freed(ctx, deps) {
  const leases = await leasesOf(ctx).release({ env: ctx.envId, owner: ctx.owner });
  const containers = containersOf(ctx, deps);
  ctx.sandboxes.write(moved(ctx.sandboxes.read(ctx.envId), "RELEASED", ctx.now(), { endpoints: [], blocked: null, lastActiveAt: ctx.now() }));
  return { leases: leases.map((l) => l.port), containers };
}
