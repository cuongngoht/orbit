// One start at a time per checkout.
//
// Starting is "look for what is running, then launch what is not". Two of them at once -- two
// terminals, a person and an agent, two clicks in Orbit Control -- would both look, both find nothing,
// and both launch: two of everything, on one port. So the look and the launch are one step, taken in
// turn, in two ways at once because there are two kinds of "at once":
//
//   in this process   a queue. Control answers many requests in one process, and a lock that waits by
//                     sleeping would stop the very work it is waiting for
//   between processes a lock in the checkout's live room, the way every merged file here is guarded
//
// What the lock covers is the launch and its receipt -- seconds -- and never the wait for a server to
// answer, which can be minutes and is nobody else's business.
import { withLockAsync } from "../store/lock.mjs";

const tails = new Map();

// The work of one key, after every earlier piece of work on it has finished (and whether or not it
// succeeded: one failed start must not wedge the next).
function queued(key, work) {
  const before = tails.get(key) ?? Promise.resolve();
  const run = before.catch(() => {}).then(work);
  const tail = run.catch(() => {}).then(() => (tails.get(key) === tail ? tails.delete(key) : null));
  tails.set(key, tail);
  return run;
}

const BUSY = "another start of this checkout is in progress: try again in a moment";

// `fn` runs alone for this checkout, here and in any other process.
export function exclusively(ctx, fn) {
  return queued(ctx.rooms.live, () => {
    ctx.io.ensureDir(ctx.rooms.live);
    return withLockAsync(ctx.rooms.live, fn, ctx.io, BUSY);
  });
}
