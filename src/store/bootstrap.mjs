// The store's half of seating a project (src/seat.mjs): bind the checkout and label the store -- a context's
// prepare(), the same first write every store gets -- then write each seat file that is ABSENT, under the store's
// lock. Two sessions seating one project at once write each file once and never half of one, a repeated call
// writes nothing, and a file a person already has is never overwritten, however different it is from what a seat
// would have written. Every path is held inside the store, through links too; nothing here can reach a checkout.
import { dirname, join } from "node:path";
import { machineContext } from "./context.mjs";
import { writeAtomic } from "./atomic.mjs";
import { withLock } from "./lock.mjs";
import { storePath } from "./guard.mjs";

const BUSY = "another session is preparing this project's store — try again in a moment";

// `files`: [{ rel, make }] -- a path inside the test data and how its bytes are made, asked only when it is absent.
// -> the relative paths written, in the order given; [] when every one was already there.
export function ensureSeat(paths, files, env, deps = {}) {
  const machine = machineContext({ project: paths, config: {} }, env, deps);
  machine.prepare();
  return withLock(paths.storeRoot, () => absentWritten(paths, files, machine.io), machine.io, BUSY);
}

// Bind and label only: what an explicit invocation gives a checkout whose test data lives in the checkout.
export function ensureBound(paths, env, deps = {}) {
  machineContext({ project: paths, config: {} }, env, deps).prepare();
  return [];
}

const absentWritten = (paths, files, io) => files.filter((f) => !io.exists(join(paths.dataRoot, f.rel))).map((f) => written(paths, f, io));

function written(paths, f, io) {
  const target = storePath(paths.storeRoot, join(paths.dataRoot, f.rel));
  io.ensureDir(dirname(target));
  writeAtomic(target, f.make(), io, false);
  return f.rel;
}
